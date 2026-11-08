'use strict';

const jid = require('../whatsapp/jid');
const { audit, fail } = require('./common');
const { EVENTS } = require('../events/bus');

const START = 1000;
const FLOOR = 100;
const HISTORY_MAX = 30;
const APPLIED_MAX = 5000;
const DAY_MS = 24 * 3600 * 1000;
const SEASONS_KEEP = 50;

const expected = (a, b) => 1 / (1 + 10 ** ((b - a) / 400));
const fresh = () => ({ elo: START, peak: START, matches: 0, wins: 0, losses: 0, draws: 0, season: { matches: 0, wins: 0, losses: 0, draws: 0, gain: 0 }, history: [] });

/**
 * ELO real (sistema Elo con K variable) calculado SOLO a partir de partidas finalizadas con resultado real.
 *  - Jugadores: cada jugador de la plantilla congelada de la partida compara el ELO medio de su equipo con el del rival.
 *  - Equipos: ELO propio por equipo.
 *  - Idempotente: cada partida (id único) se aplica una sola vez, aunque el evento se repita o el bot se reinicie.
 *  - Antiabuso: tras N partidas entre los mismos dos equipos en 24 h, las siguientes se registran pero no puntúan.
 *  - Temporadas: se cierran manualmente; guardan el top, reparten monedas virtuales y aplican un reinicio suave.
 */
class EloService {
  constructor({ db, teams, matches, users, clans = null, games = null, bus = null, config, logger = null, now = () => Date.now() }) {
    this.db = db;
    this.teams = teams;
    this.matches = matches;
    this.users = users;
    this.clans = clans;
    this.games = games;
    this.bus = bus;
    this.cfg = config.elo;
    this.logger = logger;
    this.now = now;
  }

  register() {
    this.bus?.on(EVENTS.matchFinished, ({ match }) => this.onMatchFinished(match));
    return this;
  }

  _iso() {
    return new Date(this.now()).toISOString();
  }

  doc() {
    const d = this.db.ensure('rankings', 'elo', () => ({ season: { number: 1, startedAt: this._iso() }, players: {}, teams: {}, applied: {}, pairs: {}, seasons: [] }));
    if (!d.pairs) d.pairs = {};
    return d;
  }

  // ---------- cálculo ----------

  _k(rec) {
    return rec.matches < this.cfg.provisionalMatches ? this.cfg.kProvisional : this.cfg.k;
  }

  _record(map, key) {
    return (map[key] ||= fresh());
  }

  _apply(rec, { delta, matchId, opp, result, rated }) {
    rec.elo = Math.max(FLOOR, rec.elo + delta);
    rec.peak = Math.max(rec.peak, rec.elo);
    rec.matches++;
    rec.season.matches++;
    const key = result === 'win' ? 'wins' : result === 'loss' ? 'losses' : 'draws';
    rec[key]++;
    rec.season[key]++;
    rec.season.gain += delta;
    rec.history.push({ match: matchId, at: this._iso(), delta, elo: rec.elo, opp, result, rated });
    if (rec.history.length > HISTORY_MAX) rec.history.splice(0, rec.history.length - HISTORY_MAX);
  }

  /** Aplica una partida finalizada. Devuelve el resumen aplicado, o null si ya estaba aplicada / no es válida. */
  onMatchFinished(match) {
    try {
      return this.applyMatch(match);
    } catch (err) {
      this.logger?.error?.('Error aplicando ELO', err);
      return null;
    }
  }

  applyMatch(match) {
    if (!match || match.status !== 'finalizada' || !match.result || !match.guest) return null;
    const d = this.doc();
    if (d.applied[match.id]) return null; // idempotencia
    const winner = match.result.winner;
    if (!['host', 'guest', 'draw'].includes(winner)) return null;
    const rosters = match.rosters || {};
    if (!Array.isArray(rosters.host) || !Array.isArray(rosters.guest)) return null;

    const now = this.now();
    const key = [match.host, match.guest].sort().join('|');
    const recent = (d.pairs[key] || []).filter((t) => now - t < DAY_MS);
    const rated = recent.length < this.cfg.maxPerPairDay;
    if (rated) recent.push(now);
    d.pairs[key] = recent;

    const score = { host: winner === 'host' ? 1 : winner === 'draw' ? 0.5 : 0, guest: winner === 'guest' ? 1 : winner === 'draw' ? 0.5 : 0 };
    const resultOf = (side) => (winner === 'draw' ? 'draw' : winner === side ? 'win' : 'loss');
    const teamId = { host: match.host, guest: match.guest };
    const other = { host: 'guest', guest: 'host' };

    // ELO previo de todos (antes de modificar nada)
    const tRec = { host: this._record(d.teams, match.host), guest: this._record(d.teams, match.guest) };
    const tPre = { host: tRec.host.elo, guest: tRec.guest.elo };
    const tK = { host: this._k(tRec.host), guest: this._k(tRec.guest) };
    const pRec = {};
    const pPre = {};
    const pK = {};
    const avg = {};
    for (const side of ['host', 'guest']) {
      pRec[side] = rosters[side].map((j) => this._record(d.players, j));
      pPre[side] = pRec[side].map((r) => r.elo);
      pK[side] = pRec[side].map((r) => this._k(r));
      avg[side] = pPre[side].reduce((a, b) => a + b, 0) / Math.max(1, pPre[side].length);
    }

    const deltas = { teams: {}, players: {} };
    for (const side of ['host', 'guest']) {
      const o = other[side];
      const tDelta = rated ? Math.round(tK[side] * (score[side] - expected(tPre[side], tPre[o]))) : 0;
      deltas.teams[teamId[side]] = tDelta;
      this._apply(tRec[side], { delta: tDelta, matchId: match.id, opp: teamId[o], result: resultOf(side), rated });
      const e = expected(avg[side], avg[o]);
      rosters[side].forEach((j, i) => {
        const delta = rated ? Math.round(pK[side][i] * (score[side] - e)) : 0;
        deltas.players[j] = delta;
        const rec = pRec[side][i];
        this._apply(rec, { delta, matchId: match.id, opp: teamId[o], result: resultOf(side), rated });
        rec.vs ||= {};
        const v = (rec.vs[teamId[o]] ||= { w: 0, l: 0, d: 0 });
        if (resultOf(side) === 'win') v.w++;
        else if (resultOf(side) === 'loss') v.l++;
        else v.d++;
      });
    }

    d.applied[match.id] = { at: this._iso(), rated, season: d.season.number };
    const ids = Object.keys(d.applied);
    if (ids.length > APPLIED_MAX) for (const id of ids.slice(0, ids.length - APPLIED_MAX)) delete d.applied[id];
    this.db.touch();
    audit(this.db, { scope: 'elo', ref: match.id, actor: null, action: rated ? 'aplicar' : 'sin-puntos', detail: `${match.host} vs ${match.guest} → ${winner}`, at: now });
    return { rated, deltas };
  }

  // ---------- consultas ----------

  player(jidValue) {
    const j = jid.normalize(jidValue);
    const r = this.doc().players[j];
    return r ? { jid: j, ...r } : { jid: j, ...fresh() };
  }

  team(teamId) {
    const r = this.doc().teams[teamId];
    return r ? { id: teamId, ...r } : { id: teamId, ...fresh() };
  }

  /** Ranking de jugadores por ELO (solo con partidas jugadas y registrados en el bot). */
  rankPlayers(limit = 10, { seasonOnly = false } = {}) {
    return Object.entries(this.doc().players)
      .filter(([j, r]) => (seasonOnly ? r.season.matches : r.matches) > 0 && this.users.find([j]))
      .map(([j, r]) => ({ jid: j, ...r }))
      .sort((a, b) => b.elo - a.elo || b.wins - a.wins || a.matches - b.matches || a.jid.localeCompare(b.jid))
      .slice(0, limit);
  }

  rankTeams({ mode = null, limit = 10, seasonOnly = false } = {}) {
    return Object.entries(this.doc().teams)
      .filter(([id, r]) => {
        const t = this.teams.db.get('teams', id);
        return (seasonOnly ? r.season.matches : r.matches) > 0 && t && t.status === 'activo' && (!mode || t.mode === mode);
      })
      .map(([id, r]) => ({ id, ...r, name: this.teams.db.get('teams', id).name, mode: this.teams.db.get('teams', id).mode }))
      .sort((a, b) => b.elo - a.elo || b.wins - a.wins || a.matches - b.matches || a.id.localeCompare(b.id))
      .slice(0, limit);
  }

  /** Ranking de clanes: media del ELO de sus equipos activos con partidas (los equipos guardan el clan del grupo donde se crearon). */
  rankClans(limit = 10) {
    const byClan = new Map();
    for (const [id, r] of Object.entries(this.doc().teams)) {
      const t = this.teams.db.get('teams', id);
      if (!t || t.status !== 'activo' || !t.clanId || r.matches === 0) continue;
      const c = byClan.get(t.clanId) || { clanId: t.clanId, elo: 0, teams: 0, wins: 0, losses: 0, matches: 0 };
      c.elo += r.elo;
      c.teams++;
      c.wins += r.wins;
      c.losses += r.losses;
      c.matches += r.matches;
      byClan.set(t.clanId, c);
    }
    return [...byClan.values()]
      .map((c) => ({ ...c, elo: Math.round(c.elo / c.teams), name: this.clans?.get(c.clanId)?.name || c.clanId }))
      .sort((a, b) => b.elo - a.elo || b.wins - a.wins || a.clanId.localeCompare(b.clanId))
      .slice(0, limit);
  }

  /** Posición (1 = mejor) de un jugador en el ranking de ELO, o null si no está clasificado. */
  position(jidValue) {
    const j = jid.normalize(jidValue);
    const i = this.rankPlayers(Number.MAX_SAFE_INTEGER).findIndex((p) => p.jid === j);
    return i < 0 ? null : i + 1;
  }

  /** Rivales de un jugador a partir de sus partidas reales: el más enfrentado y el que más derrotas le ha dado. */
  rivals(jidValue) {
    const rec = this.player(jidValue);
    const list = Object.entries(rec.vs || {})
      .map(([teamId, v]) => ({ teamId, ...v, played: v.w + v.l + v.d, team: this.teams.db.get('teams', teamId) }))
      .filter((r) => r.team);
    return {
      mostPlayed: [...list].sort((a, b) => b.played - a.played || a.teamId.localeCompare(b.teamId))[0] || null,
      nemesis: [...list].filter((r) => r.l > 0).sort((a, b) => b.l - a.l || a.teamId.localeCompare(b.teamId))[0] || null,
      victim: [...list].filter((r) => r.w > 0).sort((a, b) => b.w - a.w || a.teamId.localeCompare(b.teamId))[0] || null,
      total: list.length,
    };
  }

  // ---------- clasificaciones de usuarios y juegos ----------

  topUsers(kind, limit = 10) {
    const pick = {
      victorias: (u) => u.stats?.wins || 0,
      xp: (u) => u.xp || 0,
      niveles: (u) => u.level || 1,
      monedas: (u) => u.coins || 0,
    }[kind];
    if (!pick) throw fail('BAD_KIND', 'Clasificación desconocida.');
    return this.db
      .values('users')
      .map((u) => ({ jid: u.jid, name: u.name, value: pick(u), xp: u.xp || 0, wins: u.stats?.wins || 0, matches: u.stats?.matches || 0 }))
      .filter((u) => u.value > 0)
      .sort((a, b) => b.value - a.value || b.xp - a.xp || a.jid.localeCompare(b.jid))
      .slice(0, limit);
  }

  /** Top de juegos: por victorias totales o, con `type`, por victorias en ese juego. */
  topGames(type = null, limit = 10) {
    if (!this.games) return [];
    const players = this.db.ensure('rankings', 'games', () => ({ players: {} })).players;
    return Object.entries(players)
      .map(([j, p]) => {
        const g = type ? p.byGame?.[type] || { played: 0, wins: 0 } : p.total;
        return { jid: j, played: g.played, wins: g.wins, user: this.users.find([j]) };
      })
      .filter((r) => r.wins > 0 && r.user)
      .sort((a, b) => b.wins - a.wins || a.played - b.played || a.jid.localeCompare(b.jid))
      .slice(0, limit);
  }

  // ---------- temporadas ----------

  season() {
    return this.doc().season;
  }

  seasons() {
    return this.doc().seasons;
  }

  /**
   * Cierra la temporada actual: guarda el top, reparte monedas virtuales a los primeros jugadores,
   * aplica el reinicio suave y abre la siguiente. Se ejecuta una sola vez por número de temporada.
   */
  closeSeason(admin) {
    const d = this.doc();
    const number = d.season.number;
    if (d.seasons.some((s) => s.number === number)) throw fail('ALREADY', `La temporada ${number} ya está cerrada.`);
    const players = this.rankPlayers(10, { seasonOnly: true });
    const teams = this.rankTeams({ limit: 10, seasonOnly: true });
    const rewards = [];
    players.slice(0, this.cfg.seasonRewards.length).forEach((p, i) => {
      const coins = this.cfg.seasonRewards[i];
      if (coins > 0) {
        this.users.addCoins([p.jid], coins, `temporada ${number}`);
        rewards.push({ jid: p.jid, coins, place: i + 1 });
      }
    });
    const summary = {
      number,
      startedAt: d.season.startedAt,
      closedAt: this._iso(),
      closedBy: admin?.jid || null,
      players: players.map((p) => ({ jid: p.jid, elo: p.elo, wins: p.season.wins, losses: p.season.losses, matches: p.season.matches })),
      teams: teams.map((t) => ({ id: t.id, name: t.name, elo: t.elo, wins: t.season.wins, losses: t.season.losses })),
      rewards,
    };
    d.seasons.push(summary);
    if (d.seasons.length > SEASONS_KEEP) d.seasons.splice(0, d.seasons.length - SEASONS_KEEP);
    const keep = this.cfg.softResetPercent / 100;
    for (const rec of [...Object.values(d.players), ...Object.values(d.teams)]) {
      rec.elo = Math.max(FLOOR, START + Math.round((rec.elo - START) * keep));
      rec.season = { matches: 0, wins: 0, losses: 0, draws: 0, gain: 0 };
    }
    d.season = { number: number + 1, startedAt: this._iso() };
    this.db.touch();
    audit(this.db, { scope: 'elo', ref: `T${number}`, actor: admin?.jid || null, action: 'cerrar-temporada', detail: `${players.length} jugadores, ${rewards.length} premios`, at: this.now() });
    this.bus?.emit(EVENTS.seasonClosed, { season: summary });
    return summary;
  }
}

module.exports = { EloService, expected, START, FLOOR };
