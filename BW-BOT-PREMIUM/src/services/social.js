'use strict';

const jid = require('../whatsapp/jid');
const { fail, audit } = require('./common');
const { EVENTS } = require('../events/bus');

const MAX_FRIENDS = 50;
const MAX_REQUESTS = 20;
const VETERAN_DAYS = 30;

/** Logros: cada condición se calcula con datos REALES guardados (nada se concede a mano ni por azar). */
const ACHIEVEMENTS = Object.freeze([
  { id: 'registrado', name: 'Bienvenido', desc: 'Crear tu perfil en el bot', title: 'Recién llegado', check: () => true },
  { id: 'nivel5', name: 'Nivel 5', desc: 'Llegar al nivel 5', title: 'Aprendiz', check: (d) => d.user.level >= 5, progress: (d) => [d.user.level, 5] },
  { id: 'nivel10', name: 'Nivel 10', desc: 'Llegar al nivel 10', title: 'Veterano', check: (d) => d.user.level >= 10, progress: (d) => [d.user.level, 10] },
  { id: 'nivel25', name: 'Nivel 25', desc: 'Llegar al nivel 25', title: 'Élite', check: (d) => d.user.level >= 25, progress: (d) => [d.user.level, 25] },
  { id: 'victoria1', name: 'Primera sangre', desc: 'Ganar tu primera partida de equipo', title: 'Primera sangre', check: (d) => d.user.stats.wins >= 1, progress: (d) => [d.user.stats.wins, 1] },
  { id: 'victorias10', name: 'Competidor', desc: 'Ganar 10 partidas de equipo', title: 'Competidor', check: (d) => d.user.stats.wins >= 10, progress: (d) => [d.user.stats.wins, 10] },
  { id: 'victorias50', name: 'Dominador', desc: 'Ganar 50 partidas de equipo', title: 'Dominador', check: (d) => d.user.stats.wins >= 50, progress: (d) => [d.user.stats.wins, 50] },
  { id: 'elo1200', name: 'Estratega', desc: 'Alcanzar 1200 de ELO', title: 'Estratega', check: (d) => d.elo.peak >= 1200, progress: (d) => [d.elo.peak, 1200] },
  { id: 'elo1500', name: 'Maestro', desc: 'Alcanzar 1500 de ELO', title: 'Maestro', check: (d) => d.elo.peak >= 1500, progress: (d) => [d.elo.peak, 1500] },
  { id: 'campeon', name: 'Campeón de torneo', desc: 'Ganar un torneo con tu equipo', title: 'Campeón', check: (d) => d.titles >= 1, progress: (d) => [d.titles, 1] },
  { id: 'juegos10', name: 'Gamer', desc: 'Ganar 10 juegos interactivos', title: 'Gamer', check: (d) => d.gameWins >= 10, progress: (d) => [d.gameWins, 10] },
  { id: 'capitan', name: 'Capitán', desc: 'Ser capitán de un equipo activo', title: 'Capitán', check: (d) => d.captain },
  { id: 'verificado', name: 'Cuenta verificada', desc: 'Vincular un UID de Free Fire verificado por la API', title: 'Verificado', check: (d) => Boolean(d.user.ffVerified) },
  { id: 'amigo1', name: 'Sociable', desc: 'Tener tu primer amigo', title: 'Sociable', check: (d) => d.friends >= 1, progress: (d) => [d.friends, 1] },
  { id: 'amigos10', name: 'Popular', desc: 'Tener 10 amigos', title: 'Popular', check: (d) => d.friends >= 10, progress: (d) => [d.friends, 10] },
]);

/**
 * Sistema social: amigos (con solicitud y aceptación), logros, títulos, medallas e insignias.
 * Todo se deriva de datos reales del bot (partidas, torneos, ELO, juegos, perfil); no hay concesiones manuales.
 */
class SocialService {
  constructor({ db, users, teams, matches, tournaments, scrims = null, elo, games, bus = null, config, logger = null, now = () => Date.now() }) {
    this.db = db;
    this.users = users;
    this.teams = teams;
    this.matches = matches;
    this.tournaments = tournaments;
    this.scrims = scrims;
    this.elo = elo;
    this.games = games;
    this.bus = bus;
    this.config = config;
    this.logger = logger;
    this.now = now;
    this._wired = false;
    this.wire();
  }

  wire() {
    if (this._wired || !this.bus) return;
    this._wired = true;
    const safe = (fn) => (e) => {
      try {
        fn(e);
      } catch (err) {
        this.logger?.warn?.('Error al actualizar logros', err);
      }
    };
    this.bus.on(EVENTS.matchFinished, safe(({ match }) => {
      for (const j of [...(match.rosters?.host || []), ...(match.rosters?.guest || [])]) this.syncJid(j);
    }));
    this.bus.on(EVENTS.levelUp, safe(({ jid: j }) => this.syncJid(j)));
    this.bus.on(EVENTS.userRegistered, safe(({ jid: j }) => this.syncJid(j)));
    this.bus.on(EVENTS.tournamentFinished, safe(({ tournament }) => {
      for (const e of tournament.teams || []) {
        const t = this.teams.db.get('teams', typeof e === 'string' ? e : e.teamId || e.id);
        for (const j of t?.members || []) this.syncJid(j);
      }
    }));
  }

  _iso() {
    return new Date(this.now()).toISOString();
  }

  _s(user) {
    return (user.social ||= { friends: [], incoming: [], outgoing: [] });
  }

  // ---------- amigos ----------

  friendsOf(user) {
    return [...this._s(user).friends];
  }

  requestsOf(user) {
    return [...this._s(user).incoming];
  }

  /** Envía una solicitud; si la otra persona ya te había enviado una, os hacéis amigos al instante. */
  addFriend(user, target) {
    if (user.jid === target.jid) throw fail('SELF', 'No puedes agregarte a ti mismo.');
    const a = this._s(user);
    const b = this._s(target);
    if (a.friends.includes(target.jid)) throw fail('ALREADY_FRIENDS', 'Ya son amigos.');
    if (a.outgoing.includes(target.jid)) throw fail('ALREADY_SENT', 'Ya le enviaste una solicitud. Espera a que la acepte.');
    if (a.incoming.includes(target.jid)) {
      this.acceptFriend(user, target);
      return { status: 'friends' };
    }
    if (a.friends.length >= MAX_FRIENDS) throw fail('FRIENDS_FULL', `Ya tienes el máximo de ${MAX_FRIENDS} amigos.`);
    if (b.friends.length >= MAX_FRIENDS) throw fail('TARGET_FULL', 'Esa persona ya tiene el máximo de amigos.');
    if (b.incoming.length >= MAX_REQUESTS) throw fail('TARGET_BUSY', 'Esa persona tiene demasiadas solicitudes pendientes.');
    a.outgoing.push(target.jid);
    b.incoming.push(user.jid);
    this.db.touch();
    audit(this.db, { scope: 'social', ref: user.jid, actor: user.jid, action: 'solicitud', detail: target.jid, at: this.now() });
    return { status: 'sent' };
  }

  acceptFriend(user, target) {
    const a = this._s(user);
    const b = this._s(target);
    if (!a.incoming.includes(target.jid)) throw fail('NO_REQUEST', 'No tienes ninguna solicitud de esa persona.');
    if (a.friends.length >= MAX_FRIENDS) throw fail('FRIENDS_FULL', `Ya tienes el máximo de ${MAX_FRIENDS} amigos.`);
    if (b.friends.length >= MAX_FRIENDS) throw fail('TARGET_FULL', 'Esa persona ya tiene el máximo de amigos.');
    a.incoming = a.incoming.filter((j) => j !== target.jid);
    b.outgoing = b.outgoing.filter((j) => j !== user.jid);
    if (!a.friends.includes(target.jid)) a.friends.push(target.jid);
    if (!b.friends.includes(user.jid)) b.friends.push(user.jid);
    this.db.touch();
    audit(this.db, { scope: 'social', ref: user.jid, actor: user.jid, action: 'amistad', detail: target.jid, at: this.now() });
    this.syncJid(user.jid);
    this.syncJid(target.jid);
  }

  rejectFriend(user, target) {
    const a = this._s(user);
    if (!a.incoming.includes(target.jid)) throw fail('NO_REQUEST', 'No tienes ninguna solicitud de esa persona.');
    a.incoming = a.incoming.filter((j) => j !== target.jid);
    const b = this._s(target);
    b.outgoing = b.outgoing.filter((j) => j !== user.jid);
    this.db.touch();
  }

  removeFriend(user, target) {
    const a = this._s(user);
    const b = this._s(target);
    if (!a.friends.includes(target.jid)) throw fail('NOT_FRIENDS', 'Esa persona no está en tu lista de amigos.');
    a.friends = a.friends.filter((j) => j !== target.jid);
    b.friends = b.friends.filter((j) => j !== user.jid);
    this.db.touch();
    audit(this.db, { scope: 'social', ref: user.jid, actor: user.jid, action: 'eliminar-amigo', detail: target.jid, at: this.now() });
  }

  // ---------- datos reales para evaluar logros ----------

  _final(t) {
    const last = t.bracket?.rounds?.[t.bracket.rounds.length - 1]?.matches?.[0];
    return last?.matchId ? this.matches.get(last.matchId) : null;
  }

  /** Torneos ganados (campeón) y subcampeonatos del jugador, según las plantillas reales de la final. */
  tournamentHonors(jidValue) {
    const j = jid.normalize(jidValue);
    const out = { champion: [], runnerUp: [] };
    for (const t of this.tournaments.all()) {
      if (t.status !== 'finalizado' || !t.champion) continue;
      const final = this._final(t);
      let champ;
      let runner;
      if (final?.status === 'finalizada' && final.result && final.result.winner !== 'draw') {
        const w = final.result.winner;
        champ = final.rosters?.[w] || [];
        runner = final.rosters?.[w === 'host' ? 'guest' : 'host'] || [];
      } else {
        champ = this.teams.db.get('teams', t.champion)?.members || [];
        runner = t.runnerUp ? this.teams.db.get('teams', t.runnerUp)?.members || [] : [];
      }
      if (champ.includes(j)) out.champion.push({ id: t.id, name: t.name });
      else if (runner.includes(j)) out.runnerUp.push({ id: t.id, name: t.name });
    }
    return out;
  }

  seasonPodiums(jidValue) {
    const j = jid.normalize(jidValue);
    const out = [];
    for (const s of this.elo.seasons()) {
      const i = s.players.findIndex((p) => p.jid === j);
      if (i >= 0 && i < 3) out.push({ season: s.number, place: i + 1 });
    }
    return out;
  }

  data(user) {
    const honors = this.tournamentHonors(user.jid);
    const games = this.games.playerStats(user.jid);
    return {
      user,
      elo: this.elo.player(user.jid),
      titles: honors.champion.length,
      gameWins: games.total.wins,
      captain: this.teams.active().some((t) => t.captain === user.jid),
      friends: this._s(user).friends.length,
    };
  }

  // ---------- logros y títulos ----------

  /** Desbloquea los logros cuyas condiciones reales ya se cumplen. Devuelve los nuevos. */
  sync(user) {
    const d = this.data(user);
    const have = new Set((user.achievements || []).map((a) => a.id));
    const fresh = [];
    for (const a of ACHIEVEMENTS) {
      if (have.has(a.id) || !a.check(d)) continue;
      user.achievements.push({ id: a.id, at: this._iso() });
      fresh.push(a);
    }
    if (fresh.length) {
      this.db.touch();
      audit(this.db, { scope: 'social', ref: user.jid, actor: null, action: 'logros', detail: fresh.map((a) => a.id).join(','), at: this.now() });
    }
    return fresh;
  }

  syncJid(jidValue) {
    const u = this.users.find([jidValue]);
    return u ? this.sync(u) : [];
  }

  achievements(user) {
    this.sync(user);
    const d = this.data(user);
    const have = new Map(user.achievements.map((a) => [a.id, a.at]));
    return ACHIEVEMENTS.map((a) => ({ ...a, unlocked: have.has(a.id), at: have.get(a.id) || null, progress: a.progress ? a.progress(d) : null }));
  }

  titlesOf(user) {
    this.sync(user);
    const have = new Set(user.achievements.map((a) => a.id));
    return ACHIEVEMENTS.filter((a) => have.has(a.id)).map((a) => a.title);
  }

  equippedTitle(user) {
    const t = user.preferences?.title;
    return t && this.titlesOf(user).includes(t) ? t : null;
  }

  equipTitle(user, name) {
    const list = this.titlesOf(user);
    const found = list.find((t) => t.toLowerCase() === String(name).trim().toLowerCase());
    if (!found) throw fail('TITLE_LOCKED', 'No tienes ese título. Mira los que has desbloqueado con *.titulos*.');
    user.preferences ||= {};
    user.preferences.title = found;
    this.db.touch();
    return found;
  }

  unequipTitle(user) {
    if (!user.preferences?.title) throw fail('NO_TITLE', 'No tienes ningún título equipado.');
    delete user.preferences.title;
    this.db.touch();
  }

  // ---------- medallas e insignias ----------

  medals(user) {
    const honors = this.tournamentHonors(user.jid);
    const podiums = this.seasonPodiums(user.jid);
    const icon = ['🥇', '🥈', '🥉'];
    return [
      ...honors.champion.map((t) => ({ icon: '🏆', text: `Campeón de ${t.name} (${t.id})` })),
      ...honors.runnerUp.map((t) => ({ icon: '🥈', text: `Subcampeón de ${t.name} (${t.id})` })),
      ...podiums.map((p) => ({ icon: icon[p.place - 1], text: `Podio de la temporada ${p.season} (puesto ${p.place})` })),
    ];
  }

  badges(user) {
    const d = this.data(user);
    const days = (this.now() - Date.parse(user.registeredAt)) / 86400000;
    const out = [];
    if (user.ffVerified) out.push({ icon: '✅', text: 'Cuenta de Free Fire verificada' });
    if (d.captain) out.push({ icon: '🛡️', text: 'Capitán de equipo' });
    if (days >= VETERAN_DAYS) out.push({ icon: '📅', text: `Veterano (${Math.floor(days)} días en el bot)` });
    if ((user.streaks?.daily || 0) >= 7) out.push({ icon: '🔥', text: `Racha diaria de ${user.streaks.daily} días` });
    if (d.titles >= 1) out.push({ icon: '🏆', text: `Campeón de torneo (${d.titles})` });
    if (d.friends >= 1) out.push({ icon: '🤝', text: `${d.friends} amigos` });
    return out;
  }

  /** Resumen de estadísticas generales del jugador, todo con datos reales. */
  stats(user) {
    const d = this.data(user);
    const g = this.games.playerStats(user.jid);
    const best = Object.entries(g.byGame || {}).sort((a, b) => b[1].wins - a[1].wins)[0] || null;
    const honors = this.tournamentHonors(user.jid);
    return {
      user,
      elo: d.elo,
      position: this.elo.position(user.jid),
      games: g.total,
      bestGame: best && best[1].wins > 0 ? { type: best[0], wins: best[1].wins, played: best[1].played } : null,
      champion: honors.champion.length,
      runnerUp: honors.runnerUp.length,
      teams: this.teams.teamsOf(user.jid),
      friends: d.friends,
      achievements: (user.achievements || []).length,
      achievementsTotal: ACHIEVEMENTS.length,
    };
  }
}

module.exports = { SocialService, ACHIEVEMENTS, MAX_FRIENDS };
