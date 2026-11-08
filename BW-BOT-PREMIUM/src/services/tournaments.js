'use strict';

const crypto = require('node:crypto');
const jid = require('../whatsapp/jid');
const { EVENTS } = require('../events/bus');
const { nextId, audit, fail } = require('./common');

const COLLECTION = 'tournaments';
const JOB = Object.freeze({ close: 'tournament.close', remind: 'tournament.remind', start: 'tournament.start' });
const ST = Object.freeze({ DRAFT: 'borrador', OPEN: 'inscripcion', CLOSED: 'cerrado', RUNNING: 'en_curso', FINISHED: 'finalizado', CANCELLED: 'cancelado' });
const ACTIVE = new Set([ST.OPEN, ST.CLOSED, ST.RUNNING]);
const LOCKED = new Set([ST.CLOSED, ST.RUNNING]);
const MIN_TEAMS = 2;
const MAX_TEAMS = 32;
const REMIND_MIN = 15;
const BONUS = Object.freeze({ champion: 10, runnerUp: 5 });

const pow2 = (n) => { let s = 1; while (s < n) s *= 2; return s; };

function roundName(totalRounds, round) {
  const left = totalRounds - round;
  return left === 0 ? 'Final' : left === 1 ? 'Semifinal' : left === 2 ? 'Cuartos de final' : `Ronda ${round}`;
}

/**
 * Torneos de eliminación simple entre equipos de una modalidad.
 * Estados: borrador → inscripcion → cerrado (check-in) → en_curso → finalizado (o cancelado).
 * El cuadro se genera con los equipos que hicieron check-in (orden de inscripción, o sorteo con `iniciar ID sorteo`).
 * Cada partida del cuadro es una partida real (MatchService, estado iniciada): el resultado lo reportan los capitanes o lo fija
 * un administrador; el torneo avanza SOLO cuando esa partida se finaliza. Nada se simula ni se inventa.
 */
class TournamentService {
  constructor({ db, teams, matches, users, scheduler, wa = null, bus = null, config, logger = null, now = () => Date.now(), randInt = (n) => crypto.randomInt(n) }) {
    this.db = db;
    this.teams = teams;
    this.matches = matches;
    this.users = users;
    this.scheduler = scheduler;
    this.wa = wa;
    this.bus = bus;
    this.config = config;
    this.logger = logger;
    this.now = now;
    this.randInt = randInt;
    teams.addGuard((team, action) => {
      const t = this.registeredIn(team.id).find((x) => LOCKED.has(x.status) || action === 'disolución');
      return t ? `El equipo ${team.name} participa en el torneo ${t.name} (${t.status.replace('_', ' ')}): no se puede hacer un ${action} ahora.` : null;
    });
  }

  register() {
    this.scheduler?.register(JOB.close, (job) => this.onClose(job));
    this.scheduler?.register(JOB.remind, (job) => this.onRemind(job));
    this.scheduler?.register(JOB.start, (job) => this.onStart(job));
    this.bus?.on(EVENTS.matchFinished, ({ match }) => this.onMatchFinished(match));
    return this;
  }

  _iso() {
    return new Date(this.now()).toISOString();
  }

  // ---------- consulta ----------

  get(ref) {
    const m = String(ref ?? '').trim().match(/^(?:trn-?)?(\d{1,6})$/i);
    return m ? this.db.get(COLLECTION, `TRN-${m[1].padStart(3, '0')}`) || null : null;
  }

  require(ref) {
    const t = this.get(ref);
    if (!t) throw fail('NO_TOURNAMENT', `No encontré el torneo "${String(ref ?? '').slice(0, 20)}". Usa su ID, por ejemplo TRN-001.`);
    return t;
  }

  all() {
    return this.db.values(COLLECTION);
  }

  registeredIn(teamId) {
    return this.all().filter((t) => ACTIVE.has(t.status) && t.teams.some((x) => x.teamId === teamId));
  }

  entry(t, teamId) {
    return t.teams.find((x) => x.teamId === teamId) || null;
  }

  checkedIn(t) {
    return t.teams.filter((x) => x.checkedIn);
  }

  _rankingDoc() {
    return this.db.ensure('rankings', 'tournaments', () => ({ teams: {}, applied: {} }));
  }

  // ---------- creación y edición ----------

  create({ user, mode, maxTeams, name, groupJid }) {
    const m = require('./teams').parseMode(mode);
    if (!m) throw fail('BAD_MODE', 'La modalidad debe ser 2v2, 4v4 o 6v6.');
    if (!/^\d+$/.test(String(maxTeams)) || Number(maxTeams) < MIN_TEAMS || Number(maxTeams) > MAX_TEAMS) throw fail('BAD_MAX', `El máximo de equipos debe estar entre ${MIN_TEAMS} y ${MAX_TEAMS}.`);
    const clean = this._cleanName(name);
    if (this.all().some((x) => ACTIVE.has(x.status) || x.status === ST.DRAFT ? x.name.toLowerCase() === clean.toLowerCase() : false)) throw fail('NAME_TAKEN', `Ya existe un torneo activo llamado "${clean}".`);
    const id = nextId(this.db, 'tournament', 'TRN', 3);
    const t = {
      id,
      name: clean,
      mode: m,
      maxTeams: Number(maxTeams),
      status: ST.DRAFT,
      groupJid: groupJid ? jid.normalize(groupJid) : null,
      createdBy: user.jid,
      createdAt: this._iso(),
      prizeCoins: 0,
      pointsPerWin: 3,
      registerUntil: null,
      startAt: null,
      teams: [],
      bracket: null,
      champion: null,
      runnerUp: null,
      points: {},
      noShows: [],
      disqualified: [],
      notified: {},
      finishedAt: null,
      cancelReason: null,
    };
    this.db.set(COLLECTION, id, t);
    audit(this.db, { scope: 'torneo', ref: id, actor: user.jid, action: 'crear', detail: `${m} máx ${t.maxTeams} ${clean}`, at: this.now() });
    return t;
  }

  _cleanName(raw) {
    const name = String(raw ?? '').replace(/[*_~`@]/g, '').replace(/[\u0000-\u001F]/g, '').replace(/\s+/g, ' ').trim();
    if (name.length < 3 || name.length > 40) throw fail('BAD_NAME', 'El nombre del torneo debe tener entre 3 y 40 caracteres.');
    return name;
  }

  edit(t, user, field, value) {
    if (![ST.DRAFT, ST.OPEN].includes(t.status)) throw fail('BAD_STATE', `El torneo está ${t.status}: ya no se puede editar.`);
    const f = String(field || '').toLowerCase();
    if (f === 'nombre') t.name = this._cleanName(value);
    else if (f === 'max') {
      const n = Number(value);
      if (!/^\d+$/.test(String(value)) || n < MIN_TEAMS || n > MAX_TEAMS) throw fail('BAD_MAX', `El máximo de equipos debe estar entre ${MIN_TEAMS} y ${MAX_TEAMS}.`);
      if (n < t.teams.length) throw fail('BAD_MAX', `Ya hay ${t.teams.length} equipos inscritos.`);
      t.maxTeams = n;
    } else if (f === 'premio') {
      if (!/^\d+$/.test(String(value)) || Number(value) > 1000000) throw fail('BAD_PRIZE', 'El premio debe ser un número entero de monedas (0 a 1000000) por jugador del equipo campeón.');
      t.prizeCoins = Number(value);
    } else if (f === 'puntos') {
      if (!/^\d+$/.test(String(value)) || Number(value) < 1 || Number(value) > 100) throw fail('BAD_POINTS', 'Los puntos por victoria deben estar entre 1 y 100.');
      t.pointsPerWin = Number(value);
    } else if (f === 'inicio' || f === 'cierre') {
      const ms = value === 'borrar' ? null : value;
      if (ms !== null && (!Number.isFinite(ms) || ms <= this.now())) throw fail('BAD_TIME', 'La fecha debe estar en el futuro.');
      if (f === 'inicio') t.startAt = ms;
      else t.registerUntil = ms;
      this.syncOne(t);
    } else {
      throw fail('BAD_FIELD', 'Campo no editable. Usa: nombre, max, premio, puntos, inicio o cierre.');
    }
    this.db.touch();
    audit(this.db, { scope: 'torneo', ref: t.id, actor: user.jid, action: 'editar', detail: f, at: this.now() });
    return t;
  }

  // ---------- estados ----------

  _need(t, allowed, verb) {
    if (!allowed.includes(t.status)) throw fail('BAD_STATE', `El torneo ${t.id} está ${String(t.status).replace(/_/g, " ")}: no se puede ${verb}.`);
  }

  open(t, user) {
    this._need(t, [ST.DRAFT], 'abrir');
    t.status = ST.OPEN;
    this.syncOne(t);
    this.db.touch();
    audit(this.db, { scope: 'torneo', ref: t.id, actor: user.jid, action: 'abrir', at: this.now() });
    return t;
  }

  close(t, user = null) {
    this._need(t, [ST.OPEN], 'cerrar la inscripción de');
    t.status = ST.CLOSED;
    this.syncOne(t);
    this.db.touch();
    audit(this.db, { scope: 'torneo', ref: t.id, actor: user?.jid || null, action: 'cerrar', detail: `${t.teams.length} equipos`, at: this.now() });
    return t;
  }

  cancel(t, user, reason = '') {
    this._need(t, [ST.DRAFT, ST.OPEN, ST.CLOSED, ST.RUNNING], 'cancelar');
    for (const round of t.bracket?.rounds || []) {
      for (const m of round.matches) if (m.matchId) {
        const match = this.matches.get(m.matchId);
        if (match) this.matches.cancelContext(match, 'torneo cancelado', user.jid);
      }
    }
    t.status = ST.CANCELLED;
    t.cancelReason = String(reason || 'cancelado').slice(0, 100);
    t.finishedAt = this._iso();
    this.syncOne(t);
    this.db.touch();
    audit(this.db, { scope: 'torneo', ref: t.id, actor: user.jid, action: 'cancelar', detail: t.cancelReason, at: this.now() });
    return t;
  }

  remove(t, user) {
    this._need(t, [ST.DRAFT, ST.CANCELLED], 'eliminar');
    this.db.delete(COLLECTION, t.id);
    this._cancelJobs(t.id);
    audit(this.db, { scope: 'torneo', ref: t.id, actor: user.jid, action: 'eliminar', detail: t.name, at: this.now() });
    return t;
  }

  // ---------- inscripción ----------

  join(t, user, team) {
    this._need(t, [ST.OPEN], 'inscribirse en');
    this.teams._requireLeader(team, user);
    if (team.mode !== t.mode) throw fail('MODE_MISMATCH', `El torneo es ${t.mode} y tu equipo ${team.mode}.`);
    if (!this.teams.isFull(team)) throw fail('TEAM_NOT_FULL', `Tu equipo debe estar completo (${team.members.length}/${team.size}).`);
    if (t.teams.length >= t.maxTeams) throw fail('TOURNAMENT_FULL', `El torneo ya tiene los ${t.maxTeams} equipos.`);
    if (this.entry(t, team.id)) throw fail('ALREADY', 'Tu equipo ya está inscrito.');
    const other = this.registeredIn(team.id)[0];
    if (other) throw fail('BUSY', `Tu equipo ya está inscrito en ${other.name} (${other.id}).`);
    // Un jugador no puede estar en dos equipos inscritos a la vez en torneos activos.
    for (const x of this.all().filter((y) => ACTIVE.has(y.status))) {
      for (const e of x.teams) {
        const et = this.teams.db.get('teams', e.teamId);
        if (et && et.members.some((m) => team.members.includes(m))) throw fail('DUPLICATE_PLAYERS', `Hay jugadores de tu equipo que ya participan en ${x.name} con otro equipo.`);
      }
    }
    t.teams.push({ teamId: team.id, registeredAt: this._iso(), checkedIn: false });
    this.db.touch();
    audit(this.db, { scope: 'torneo', ref: t.id, actor: user.jid, action: 'inscribir', detail: team.id, at: this.now() });
    return t;
  }

  leave(t, user, team) {
    this._need(t, [ST.OPEN, ST.CLOSED], 'retirar un equipo de');
    this.teams._requireLeader(team, user);
    if (!this.entry(t, team.id)) throw fail('NOT_REGISTERED', 'Tu equipo no está inscrito en este torneo.');
    t.teams = t.teams.filter((x) => x.teamId !== team.id);
    this.db.touch();
    audit(this.db, { scope: 'torneo', ref: t.id, actor: user.jid, action: 'salir', detail: team.id, at: this.now() });
    return t;
  }

  checkin(t, user, team, value = true) {
    this._need(t, [ST.OPEN, ST.CLOSED], value ? 'hacer check-in en' : 'hacer check-out de');
    this.teams._requireLeader(team, user);
    const e = this.entry(t, team.id);
    if (!e) throw fail('NOT_REGISTERED', 'Tu equipo no está inscrito en este torneo.');
    if (value && !this.teams.isFull(team)) throw fail('TEAM_NOT_FULL', `Tu equipo debe estar completo (${team.members.length}/${team.size}) para el check-in.`);
    if (e.checkedIn === value) throw fail('ALREADY', value ? 'Tu equipo ya hizo check-in.' : 'Tu equipo no tenía check-in.');
    e.checkedIn = value;
    this.db.touch();
    audit(this.db, { scope: 'torneo', ref: t.id, actor: user.jid, action: value ? 'checkin' : 'checkout', detail: team.id, at: this.now() });
    return t;
  }

  // ---------- inicio y cuadro ----------

  start(t, user, { shuffle = false } = {}) {
    this._need(t, [ST.CLOSED, ST.OPEN], 'iniciar');
    const ready = this.checkedIn(t);
    if (ready.length < MIN_TEAMS) throw fail('FEW_TEAMS', `Hacen falta al menos ${MIN_TEAMS} equipos con check-in (hay ${ready.length}).`);
    // Los equipos sin check-in quedan fuera (no-show).
    t.noShows = t.teams.filter((x) => !x.checkedIn).map((x) => x.teamId);
    let order = ready.map((x) => x.teamId);
    // Los equipos deben seguir completos y activos.
    for (const id of order) {
      const team = this.teams.db.get('teams', id);
      if (!team || team.status !== 'activo' || !this.teams.isFull(team)) throw fail('TEAM_NOT_FULL', `El equipo ${team?.name || id} ya no está completo: debe hacer check-out o completarse.`);
    }
    if (shuffle) {
      for (let i = order.length - 1; i > 0; i--) {
        const j = this.randInt(i + 1);
        [order[i], order[j]] = [order[j], order[i]];
      }
    }
    t.bracket = this._buildBracket(order);
    t.teams = ready.map((x) => ({ ...x }));
    t.status = ST.RUNNING;
    t.startedAt = this._iso();
    t.seeding = shuffle ? 'sorteo' : 'inscripción';
    this.syncOne(t);
    this._progress(t);
    this.db.touch();
    audit(this.db, { scope: 'torneo', ref: t.id, actor: user?.jid || null, action: 'iniciar', detail: `${order.length} equipos, ${t.seeding}`, at: this.now() });
    this.bus?.emit(EVENTS.tournamentStarted, { tournament: t });
    return t;
  }

  _buildBracket(order) {
    const n = order.length;
    const size = pow2(n);
    const pairs = size / 2;
    const totalRounds = Math.log2(size);
    const rounds = [];
    for (let r = 1; r <= totalRounds; r++) {
      const count = size / 2 ** r;
      rounds.push({ round: r, name: roundName(totalRounds, r), matches: Array.from({ length: count }, (_, slot) => ({ slot, a: null, b: null, winner: null, matchId: null, state: 'esperando', how: null })) });
    }
    // Primeras (n - pairs) llaves con dos equipos; el resto con un equipo y descanso (bye).
    const twoTeam = n - pairs;
    let k = 0;
    rounds[0].matches.forEach((m, i) => {
      m.a = order[k++];
      if (i < twoTeam) m.b = order[k++];
    });
    return { size, totalRounds, rounds };
  }

  /** Avanza todo lo que se pueda: descansos, derrotas por descalificación y creación de partidas con ambos equipos conocidos. */
  _progress(t) {
    let changed = true;
    while (changed && t.status === ST.RUNNING) {
      changed = false;
      for (const round of t.bracket.rounds) {
        for (const m of round.matches) {
          if (m.winner) continue;
          const dq = (id) => id && t.disqualified.includes(id);
          if (round.round === 1 && m.a && !m.b && !m.matchId) {
            this._setWinner(t, round.round, m.slot, m.a, 'descanso');
            changed = true;
            continue;
          }
          if (!m.a || !m.b || m.matchId) continue;
          if (dq(m.a) || dq(m.b)) {
            const w = dq(m.a) && !dq(m.b) ? m.b : !dq(m.a) && dq(m.b) ? m.a : m.a;
            this._setWinner(t, round.round, m.slot, w, 'walkover');
            changed = true;
            continue;
          }
          const match = this.matches.createForContext({
            host: this.teams.db.get('teams', m.a),
            guest: this.teams.db.get('teams', m.b),
            context: { type: 'torneo', id: t.id, round: round.round, slot: m.slot },
            groupJid: t.groupJid,
            by: t.createdBy,
          });
          m.matchId = match.id;
          m.state = 'jugando';
          changed = true;
        }
      }
    }
    this.db.touch();
  }

  _setWinner(t, roundNo, slot, teamId, how) {
    const round = t.bracket.rounds[roundNo - 1];
    const m = round.matches[slot];
    if (m.winner) return;
    m.winner = teamId;
    m.how = how;
    m.state = how === 'descanso' ? 'descanso' : 'finalizada';
    if (how !== 'descanso') t.points[teamId] = (t.points[teamId] || 0) + t.pointsPerWin;
    const next = t.bracket.rounds[roundNo];
    if (!next) {
      this._finalize(t, m);
      return;
    }
    const nm = next.matches[Math.floor(slot / 2)];
    if (slot % 2 === 0) nm.a = teamId;
    else nm.b = teamId;
  }

  _finalize(t, finalMatch) {
    if (t.status === ST.FINISHED) return;
    t.status = ST.FINISHED;
    t.finishedAt = this._iso();
    t.champion = finalMatch.winner;
    t.runnerUp = finalMatch.a === finalMatch.winner ? finalMatch.b : finalMatch.a;
    t.points[t.champion] = (t.points[t.champion] || 0) + BONUS.champion;
    if (t.runnerUp) t.points[t.runnerUp] = (t.points[t.runnerUp] || 0) + BONUS.runnerUp;
    // Premios en monedas virtuales al equipo campeón (completo) y mitad al subcampeón.
    t.prizes = { champion: [], runnerUp: [] };
    if (t.prizeCoins > 0) {
      const pay = (teamId, amount, key) => {
        for (const j of this.teams.db.get('teams', teamId)?.members || []) {
          if (amount > 0 && this.users.find([j])) {
            this.users.addCoins([j], amount, `premio torneo ${t.id}`);
            t.prizes[key].push({ jid: j, coins: amount });
          }
        }
      };
      pay(t.champion, t.prizeCoins, 'champion');
      if (t.runnerUp) pay(t.runnerUp, Math.floor(t.prizeCoins / 2), 'runnerUp');
    }
    // Ranking global de torneos (una sola vez por torneo).
    const doc = this._rankingDoc();
    if (!doc.applied[t.id]) {
      doc.applied[t.id] = true;
      const played = new Set();
      for (const round of t.bracket.rounds) for (const m of round.matches) for (const id of [m.a, m.b]) if (id) played.add(id);
      for (const id of played) {
        const team = this.teams.db.get('teams', id);
        const r = (doc.teams[id] ||= { name: team?.name || id, points: 0, titles: 0, runnerUps: 0, played: 0, wins: 0 });
        r.name = team?.name || r.name;
        r.played += 1;
        r.points += t.points[id] || 0;
        r.wins += t.bracket.rounds.flatMap((x) => x.matches).filter((m) => m.winner === id && m.how !== 'descanso').length;
        if (id === t.champion) r.titles += 1;
        if (id === t.runnerUp) r.runnerUps += 1;
      }
    }
    this._cancelJobs(t.id);
    this.db.touch();
    audit(this.db, { scope: 'torneo', ref: t.id, actor: null, action: 'finalizar', detail: `campeón ${t.champion}`, at: this.now() });
    this.bus?.emit(EVENTS.tournamentFinished, { tournament: t });
  }

  /** Finalización manual: solo si el cuadro ya tiene campeón (p. ej. si una acción posterior falló). */
  finish(t, user) {
    this._need(t, [ST.RUNNING], 'finalizar');
    const final = t.bracket.rounds[t.bracket.totalRounds - 1].matches[0];
    if (!final.winner) throw fail('NOT_DONE', 'Todavía faltan partidas por jugar: la final no tiene ganador.');
    this._finalize(t, final);
    audit(this.db, { scope: 'torneo', ref: t.id, actor: user.jid, action: 'finalizar-manual', at: this.now() });
    return t;
  }

  onMatchFinished(match) {
    const ctx = match.context;
    if (!ctx || ctx.type !== 'torneo') return;
    const t = this.get(ctx.id);
    if (!t || t.status !== ST.RUNNING) return;
    const slot = t.bracket.rounds[ctx.round - 1]?.matches[ctx.slot];
    if (!slot || slot.winner || slot.matchId !== match.id) return; // idempotente
    const winnerId = match.result.winner === 'host' ? match.host : match.guest;
    this._setWinner(t, ctx.round, ctx.slot, winnerId, 'partida');
    if (t.status === ST.RUNNING) this._progress(t);
    this.db.touch();
  }

  /** Un administrador descalifica a un equipo: pierde su partida actual (si la hay) y las siguientes por walkover. */
  disqualify(t, user, team) {
    this._need(t, [ST.RUNNING], 'descalificar en');
    if (!this.entry(t, team.id)) throw fail('NOT_REGISTERED', 'Ese equipo no participa en el torneo.');
    if (t.disqualified.includes(team.id)) throw fail('ALREADY', 'Ese equipo ya está descalificado.');
    if (t.bracket.rounds.some((r) => r.matches.some((m) => m.winner === team.id && r.round === t.bracket.totalRounds))) throw fail('ALREADY', 'Ese equipo ya es campeón.');
    t.disqualified.push(team.id);
    audit(this.db, { scope: 'torneo', ref: t.id, actor: user.jid, action: 'descalificar', detail: team.id, at: this.now() });
    for (const round of t.bracket.rounds) {
      for (const m of round.matches) {
        if (m.winner || !m.matchId || (m.a !== team.id && m.b !== team.id)) continue;
        const match = this.matches.get(m.matchId);
        if (match && match.status === 'iniciada') this.matches.resolve(match, user, m.a === team.id ? 'guest' : 'host'); // dispara onMatchFinished
      }
    }
    if (t.status === ST.RUNNING) this._progress(t);
    this.db.touch();
    return t;
  }

  // ---------- consultas de presentación ----------

  /** Partidas del cuadro con su estado real (consultando la partida asociada). */
  bracketMatches(t) {
    const out = [];
    for (const round of t.bracket?.rounds || []) {
      for (const m of round.matches) {
        const match = m.matchId ? this.matches.get(m.matchId) : null;
        out.push({ round: round.round, name: round.name, slot: m.slot, a: m.a, b: m.b, winner: m.winner, how: m.how, state: m.state, matchId: m.matchId, matchStatus: match?.status || null });
      }
    }
    return out;
  }

  pendingMatches(t) {
    return this.bracketMatches(t).filter((m) => m.state === 'jugando');
  }

  pointsTable(t) {
    return Object.entries(t.points).map(([teamId, pts]) => ({ teamId, pts })).sort((a, b) => b.pts - a.pts || a.teamId.localeCompare(b.teamId));
  }

  upcoming() {
    return this.all()
      .filter((t) => ACTIVE.has(t.status) && t.startAt && t.startAt > this.now())
      .sort((a, b) => a.startAt - b.startAt);
  }

  finished(limit = 10) {
    return this.all().filter((t) => t.status === ST.FINISHED).sort((a, b) => b.finishedAt.localeCompare(a.finishedAt)).slice(0, limit);
  }

  globalRanking(limit = 10) {
    return Object.entries(this._rankingDoc().teams)
      .map(([id, r]) => ({ id, ...r }))
      .sort((a, b) => b.points - a.points || b.titles - a.titles || a.id.localeCompare(b.id))
      .slice(0, limit);
  }

  teamStats(teamId) {
    return this._rankingDoc().teams[teamId] || null;
  }

  // ---------- scheduler ----------

  _cancelJobs(id) {
    this.scheduler?.cancelWhere((j) => String(j.type).startsWith('tournament.') && j.payload.tournamentId === id);
  }

  /** Deja programados exactamente los trabajos que corresponden al estado y fechas del torneo (idempotente). */
  syncOne(t) {
    if (!this.scheduler) return { created: 0, cancelled: 0 };
    const desired = new Map();
    if (ACTIVE.has(t.status) && t.status !== ST.RUNNING) {
      if (t.registerUntil && t.status === ST.OPEN && t.registerUntil > this.now() - 60000) desired.set(`TRN_CLOSE_${t.id}_${t.registerUntil}`, { type: JOB.close, runAt: t.registerUntil });
      if (t.startAt) {
        const remind = t.startAt - REMIND_MIN * 60000;
        if (remind > this.now() - 60000) desired.set(`TRN_REM_${t.id}_${t.startAt}`, { type: JOB.remind, runAt: remind });
        if (t.startAt > this.now() - 60000) desired.set(`TRN_START_${t.id}_${t.startAt}`, { type: JOB.start, runAt: t.startAt });
      }
    }
    let cancelled = 0;
    for (const j of this.scheduler.pending()) {
      if (String(j.type).startsWith('tournament.') && j.payload.tournamentId === t.id && !desired.has(j.id)) {
        this.scheduler.cancel(j.id);
        cancelled++;
      }
    }
    let created = 0;
    for (const [id, d] of desired) {
      if (this.scheduler.schedule({ id, type: d.type, runAt: d.runAt, payload: { tournamentId: t.id }, graceMs: 15 * 60000 }).created) created++;
    }
    return { created, cancelled };
  }

  syncAll() {
    let created = 0;
    let cancelled = 0;
    for (const t of this.all()) {
      const r = this.syncOne(t);
      created += r.created;
      cancelled += r.cancelled;
    }
    return { created, cancelled };
  }

  async _announce(t, key, text, mentions = []) {
    if (!t.groupJid || !this.wa || t.notified[key]) return;
    await this.wa.sendText(t.groupJid, text, { mentions }); // si falla lanza → el scheduler reintenta
    t.notified[key] = true;
    this.db.touch();
  }

  captainsOf(t) {
    return t.teams.map((e) => this.teams.db.get('teams', e.teamId)?.captain).filter(Boolean);
  }

  async onClose(job) {
    const t = this.get(job.payload.tournamentId);
    if (!t) return;
    if (t.status === ST.OPEN) this.close(t, null);
    if (t.status === ST.CLOSED) {
      await this._announce(t, 'close', `🔒 *Inscripción cerrada — ${t.name}* (${t.id})\nEquipos inscritos: ${t.teams.length}. Los capitanes deben hacer *.torneo checkin ${t.id}*.`, this.captainsOf(t));
    }
  }

  async onRemind(job) {
    const t = this.get(job.payload.tournamentId);
    if (!t || ![ST.OPEN, ST.CLOSED].includes(t.status)) return;
    const pending = t.teams.filter((e) => !e.checkedIn).map((e) => this.teams.db.get('teams', e.teamId)?.captain).filter(Boolean);
    await this._announce(t, 'remind', `⏰ *${t.name}* empieza en ${REMIND_MIN} minutos.\nEquipos con check-in: ${this.checkedIn(t).length}/${t.teams.length}. Capitanes pendientes: haganlo con *.torneo checkin ${t.id}*.`, pending);
  }

  async onStart(job) {
    const t = this.get(job.payload.tournamentId);
    if (!t || ![ST.OPEN, ST.CLOSED].includes(t.status)) return;
    if (this.checkedIn(t).length < MIN_TEAMS) {
      await this._announce(t, 'startFail', `⚠️ *${t.name}* no pudo empezar: hacen falta ${MIN_TEAMS} equipos con check-in (hay ${this.checkedIn(t).length}). Un administrador puede iniciarlo con *.torneo iniciar ${t.id}* cuando estén listos.`);
      return;
    }
    try {
      this.start(t, null);
    } catch (err) {
      if (err.code === 'TEAM_NOT_FULL') {
        await this._announce(t, 'startFail', `⚠️ *${t.name}* no pudo empezar: ${err.message}`);
        return;
      }
      throw err;
    }
    await this._announce(t, 'start', `🏆 *¡${t.name} comienza!* ${this.checkedIn(t).length} equipos. Usa *.torneo bracket ${t.id}* para ver el cuadro.`, this.captainsOf(t));
  }
}

module.exports = { TournamentService, ST, ACTIVE, JOB, BONUS, MIN_TEAMS, MAX_TEAMS };
