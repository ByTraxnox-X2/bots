'use strict';

const { EVENTS } = require('../events/bus');
const { nextId, audit, fail } = require('./common');

const COLLECTION = 'matches';
const JOB_EXPIRE = 'match.expire';

const STATUS = Object.freeze({ PENDING: 'pendiente', OPEN: 'abierta', FULL: 'llena', STARTED: 'iniciada', FINISHED: 'finalizada', CANCELLED: 'cancelada' });
const LIVE = new Set([STATUS.PENDING, STATUS.OPEN, STATUS.FULL, STATUS.STARTED]);
const LOCKING = new Set([STATUS.FULL, STATUS.STARTED]);

/** Resultado visto desde el equipo que lo reporta → lado ganador. */
function sideFromReport(side, outcome) {
  if (outcome === 'draw') return 'draw';
  if (outcome === 'win') return side;
  return side === 'host' ? 'guest' : 'host';
}

/**
 * Partidas entre dos equipos de la misma modalidad. Estados reales:
 *   pendiente → abierta → llena → iniciada → finalizada      (y cancelada desde cualquiera salvo finalizada)
 * El resultado NUNCA se calcula ni se inventa: lo reportan los capitanes (deben coincidir) o lo fija un administrador.
 * Cada partida finalizada aplica sus estadísticas UNA sola vez y emite `matchFinished` (id único → idempotente).
 */
class MatchService {
  constructor({ db, teams, users, scheduler = null, bus = null, config, logger = null, now = () => Date.now() }) {
    this.db = db;
    this.teams = teams;
    this.users = users;
    this.scheduler = scheduler;
    this.bus = bus;
    this.cfg = config.teams;
    this.logger = logger;
    this.now = now;
    teams.addGuard((team) => (this.liveFor(team.id).some((m) => LOCKING.has(m.status)) ? `El equipo ${team.name} está en una partida llena o iniciada: no se puede cambiar la plantilla ahora.` : null));
  }

  register() {
    this.scheduler?.register(JOB_EXPIRE, (job) => this.expire(job.payload.matchId));
    return this;
  }

  _iso() {
    return new Date(this.now()).toISOString();
  }

  // ---------- consulta ----------

  get(ref) {
    const raw = String(ref ?? '').trim();
    const m = raw.match(/^(?:p-?)?(\d{1,6})$/i);
    return m ? this.db.get(COLLECTION, `P-${m[1].padStart(4, '0')}`) || null : null;
  }

  require(ref) {
    const m = this.get(ref);
    if (!m) throw fail('NO_MATCH', `No encontré la partida "${String(ref ?? '').slice(0, 20)}". Usa su ID, por ejemplo P-0001.`);
    return m;
  }

  all() {
    return this.db.values(COLLECTION);
  }

  liveFor(teamId) {
    return this.all().filter((m) => LIVE.has(m.status) && (m.host === teamId || m.guest === teamId));
  }

  open() {
    return this.all().filter((m) => m.status === STATUS.OPEN && !m.context).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  finishedOf(teamId, limit = 10) {
    return this.all()
      .filter((m) => m.status === STATUS.FINISHED && (m.host === teamId || m.guest === teamId))
      .sort((a, b) => b.finishedAt.localeCompare(a.finishedAt))
      .slice(0, limit);
  }

  sideOf(match, teamId) {
    return match.host === teamId ? 'host' : match.guest === teamId ? 'guest' : null;
  }

  /** Lado (host/guest) en el que actúa la persona como capitán o subcapitán, o null. */
  leaderSide(match, user) {
    for (const side of ['host', 'guest']) {
      const t = match[side] ? this.teams.db.get('teams', match[side]) : null;
      if (t && this.teams.isLeader(t, user.jid)) return side;
    }
    return null;
  }

  headToHead(teamA, teamB) {
    const out = { played: 0, [teamA]: 0, [teamB]: 0, draws: 0 };
    for (const m of this.all()) {
      if (m.status !== STATUS.FINISHED) continue;
      const ids = [m.host, m.guest];
      if (!ids.includes(teamA) || !ids.includes(teamB)) continue;
      out.played++;
      if (m.result.winner === 'draw') out.draws++;
      else out[m.result.winner === 'host' ? m.host : m.guest]++;
    }
    return out;
  }

  // ---------- ciclo de vida ----------

  _scheduleExpiry(match) {
    this.scheduler?.schedule({ id: `MATCH_EXP_${match.id}`, type: JOB_EXPIRE, runAt: this.now() + this.cfg.matchTtlHours * 3600000, payload: { matchId: match.id }, graceMs: 24 * 3600000 });
  }

  /** Crea una partida (estado pendiente). `rival` (opcional) reserva la plaza para ese equipo. */
  create({ user, team, rival = null, context = null, groupJid = null }) {
    this.teams._requireLeader(team, user);
    if (!this.teams.isFull(team)) throw fail('TEAM_NOT_FULL', `Tu equipo debe estar completo (${team.members.length}/${team.size}) para crear una partida.`);
    if (this.liveFor(team.id).filter((m) => !m.context).length >= 3) throw fail('TOO_MANY_MATCHES', 'Tu equipo ya tiene 3 partidas sin terminar. Cancela o termina alguna.');
    let challenged = null;
    if (rival) {
      if (rival.id === team.id) throw fail('SAME_TEAM', 'No puedes desafiar a tu propio equipo.');
      if (rival.mode !== team.mode) throw fail('MODE_MISMATCH', `Ese equipo juega ${rival.mode} y el tuyo ${team.mode}.`);
      challenged = rival.id;
    }
    const id = nextId(this.db, 'match', 'P');
    const match = {
      id,
      mode: team.mode,
      status: STATUS.PENDING,
      host: team.id,
      guest: null,
      challenged,
      context: context || null,
      groupJid: groupJid || null,
      createdBy: user.jid,
      createdAt: this._iso(),
      updatedAt: this._iso(),
      rosters: { host: null, guest: null },
      reports: { host: null, guest: null },
      disputed: false,
      result: null,
      startedAt: null,
      finishedAt: null,
      cancelReason: null,
    };
    this.db.set(COLLECTION, id, match);
    this._scheduleExpiry(match);
    audit(this.db, { scope: 'partida', ref: id, actor: user.jid, action: 'crear', detail: `${team.id} ${team.mode}${challenged ? ` vs ${challenged}` : ''}`, at: this.now() });
    return match;
  }

  /**
   * Crea una partida ya iniciada para un torneo o scrim (la organiza el módulo que la pide, no los capitanes).
   * Congela las plantillas actuales de los dos equipos. Los resultados se reportan igual que en cualquier partida.
   */
  createForContext({ host, guest, context, groupJid = null, by = null }) {
    for (const t of [host, guest]) {
      if (!t || t.status !== 'activo') throw fail('TEAM_GONE', 'Uno de los equipos ya no existe.');
      if (!this.teams.isFull(t)) throw fail('TEAM_NOT_FULL', `El equipo ${t.name} ya no está completo (${t.members.length}/${t.size}).`);
    }
    if (host.id === guest.id) throw fail('SAME_TEAM', 'Un equipo no puede jugar contra sí mismo.');
    if (host.mode !== guest.mode) throw fail('MODE_MISMATCH', 'Los equipos son de modalidades distintas.');
    if (host.members.some((m) => guest.members.includes(m))) throw fail('DUPLICATE_PLAYERS', 'Hay jugadores repetidos en los dos equipos.');
    const id = nextId(this.db, 'match', 'P');
    const match = {
      id,
      mode: host.mode,
      status: STATUS.STARTED,
      host: host.id,
      guest: guest.id,
      challenged: null,
      context,
      groupJid: groupJid || null,
      createdBy: by,
      createdAt: this._iso(),
      updatedAt: this._iso(),
      rosters: { host: [...host.members], guest: [...guest.members] },
      reports: { host: null, guest: null },
      disputed: false,
      result: null,
      startedAt: this._iso(),
      finishedAt: null,
      cancelReason: null,
    };
    this.db.set(COLLECTION, id, match);
    audit(this.db, { scope: 'partida', ref: id, actor: by, action: 'crear', detail: `${context.type} ${context.id}: ${host.id} vs ${guest.id}`, at: this.now() });
    return match;
  }

  /** Cancela una partida de torneo/scrim por decisión de su organizador. */
  cancelContext(match, reason, by = null) {
    if (!LIVE.has(match.status)) return false;
    this._cancel(match, { by, reason });
    return true;
  }

  _touch(match) {
    match.updatedAt = this._iso();
    this.db.touch();
  }

  open_(match, user) {
    this._requireStatus(match, [STATUS.PENDING], 'abrirla');
    const side = this.leaderSide(match, user);
    if (side !== 'host') throw fail('NOT_HOST', 'Solo el capitán o subcapitán del equipo anfitrión puede abrir la partida.');
    const host = this.teams.db.get('teams', match.host);
    if (!this.teams.isFull(host)) throw fail('TEAM_NOT_FULL', `Tu equipo ya no está completo (${host.members.length}/${host.size}).`);
    match.status = STATUS.OPEN;
    this._touch(match);
    audit(this.db, { scope: 'partida', ref: match.id, actor: user.jid, action: 'abrir', at: this.now() });
    return match;
  }

  _requireStatus(match, allowed, verb) {
    if (!allowed.includes(match.status)) throw fail('BAD_STATE', `La partida ${match.id} está ${match.status}: no se puede ${verb}.`);
  }

  /** ¿Alguno de estos jugadores ya está en una partida llena/iniciada? */
  _busyPlayers(jids, exceptMatchId) {
    const busy = new Set();
    for (const m of this.all()) {
      if (m.id === exceptMatchId || !LOCKING.has(m.status)) continue;
      for (const side of ['host', 'guest']) for (const p of (m.rosters[side] || [])) if (jids.includes(p)) busy.add(p);
    }
    return [...busy];
  }

  join(match, user, team) {
    this._requireStatus(match, [STATUS.OPEN], 'unirse');
    this.teams._requireLeader(team, user);
    if (team.id === match.host) throw fail('SAME_TEAM', 'Tu equipo ya es el anfitrión de esta partida.');
    if (team.mode !== match.mode) throw fail('MODE_MISMATCH', `La partida es ${match.mode} y tu equipo ${team.mode}.`);
    if (match.challenged && match.challenged !== team.id) throw fail('NOT_CHALLENGED', 'Esta partida es un desafío para otro equipo.');
    if (!this.teams.isFull(team)) throw fail('TEAM_NOT_FULL', `Tu equipo debe estar completo (${team.members.length}/${team.size}).`);
    const host = this.teams.db.get('teams', match.host);
    const dup = team.members.filter((p) => host.members.includes(p));
    if (dup.length) throw fail('DUPLICATE_PLAYERS', 'Hay jugadores que están en los dos equipos. Un jugador no puede jugar contra sí mismo.');
    const busy = this._busyPlayers([...host.members, ...team.members], match.id);
    if (busy.length) throw fail('PLAYER_BUSY', 'Hay jugadores que ya están en otra partida llena o iniciada.');
    match.guest = team.id;
    match.rosters = { host: [...host.members], guest: [...team.members] };
    match.status = STATUS.FULL;
    this._touch(match);
    audit(this.db, { scope: 'partida', ref: match.id, actor: user.jid, action: 'unirse', detail: team.id, at: this.now() });
    return match;
  }

  /** El equipo invitado se retira antes de iniciar: la partida vuelve a abierta (o cancela si era un desafío). */
  withdraw(match, user) {
    this._requireStatus(match, [STATUS.FULL], 'retirar al rival de');
    if (this.leaderSide(match, user) !== 'guest') throw fail('NOT_GUEST', 'Solo el capitán o subcapitán del equipo rival puede retirarse.');
    const g = match.guest;
    match.guest = null;
    match.rosters = { host: null, guest: null };
    match.status = STATUS.OPEN;
    this._touch(match);
    audit(this.db, { scope: 'partida', ref: match.id, actor: user.jid, action: 'retirar', detail: g, at: this.now() });
    return match;
  }

  start(match, user, { isAdmin = false } = {}) {
    this._requireStatus(match, [STATUS.FULL], 'iniciar');
    if (!isAdmin && !this.leaderSide(match, user)) throw fail('NOT_LEADER', 'Solo los capitanes (o un administrador) pueden iniciar la partida.');
    // La plantilla debe seguir completa y sin jugadores repetidos.
    const h = this.teams.db.get('teams', match.host);
    const g = this.teams.db.get('teams', match.guest);
    if (!h || !g || h.status !== 'activo' || g.status !== 'activo') throw fail('TEAM_GONE', 'Uno de los equipos ya no existe.');
    if (!this.teams.isFull(h) || !this.teams.isFull(g)) throw fail('TEAM_NOT_FULL', 'Un equipo ya no está completo.');
    match.rosters = { host: [...h.members], guest: [...g.members] };
    match.status = STATUS.STARTED;
    match.startedAt = this._iso();
    this._touch(match);
    audit(this.db, { scope: 'partida', ref: match.id, actor: user.jid, action: 'iniciar', at: this.now() });
    return match;
  }

  /** Un capitán reporta el resultado desde su equipo. Si ambos coinciden, la partida se finaliza. */
  report(match, user, outcome) {
    this._requireStatus(match, [STATUS.STARTED], 'reportar el resultado de');
    const side = this.leaderSide(match, user);
    if (!side) throw fail('NOT_LEADER', 'Solo el capitán o subcapitán de un equipo de la partida puede reportar el resultado.');
    if (!['win', 'loss', 'draw'].includes(outcome)) throw fail('BAD_OUTCOME', 'El resultado debe ser victoria, derrota o empate.');
    if (outcome === 'draw' && match.context?.type === 'torneo') throw fail('NO_DRAW', 'En un torneo de eliminación no hay empates.');
    match.reports[side] = sideFromReport(side, outcome);
    const other = match.reports[side === 'host' ? 'guest' : 'host'];
    audit(this.db, { scope: 'partida', ref: match.id, actor: user.jid, action: 'reportar', detail: `${side}: ${match.reports[side]}`, at: this.now() });
    if (other === null) {
      this._touch(match);
      return { match, state: 'waiting' };
    }
    if (other === match.reports[side]) {
      this._finalize(match, match.reports[side], { source: 'capitanes', by: user.jid });
      return { match, state: 'finished' };
    }
    match.disputed = true;
    this._touch(match);
    return { match, state: 'disputed' };
  }

  /** Un administrador fija el resultado (también resuelve una disputa). winner: host | guest | draw. */
  resolve(match, admin, winner) {
    this._requireStatus(match, [STATUS.STARTED], 'resolver');
    if (!['host', 'guest', 'draw'].includes(winner)) throw fail('BAD_OUTCOME', 'El resultado debe ser un equipo ganador o empate.');
    if (winner === 'draw' && match.context?.type === 'torneo') throw fail('NO_DRAW', 'En un torneo de eliminación no hay empates.');
    this._finalize(match, winner, { source: 'administrador', by: admin.jid });
    return match;
  }

  _finalize(match, winner, { source, by }) {
    if (match.status === STATUS.FINISHED) return; // idempotencia
    match.status = STATUS.FINISHED;
    match.finishedAt = this._iso();
    match.disputed = false;
    match.result = { winner, source, by, at: match.finishedAt };
    const outcomeFor = (side) => (winner === 'draw' ? 'draw' : winner === side ? 'win' : 'loss');
    this.teams.applyResult(match.host, match.id, outcomeFor('host'));
    this.teams.applyResult(match.guest, match.id, outcomeFor('guest'));
    for (const side of ['host', 'guest']) {
      for (const j of match.rosters[side] || []) {
        const u = this.users.find([j]);
        if (!u) continue;
        u.stats.matches += 1;
        const o = outcomeFor(side);
        if (o === 'win') u.stats.wins += 1;
        else if (o === 'loss') u.stats.losses += 1;
      }
    }
    this.db.touch();
    audit(this.db, { scope: 'partida', ref: match.id, actor: by, action: 'finalizar', detail: `${winner} (${source})`, at: this.now() });
    this.scheduler?.cancel(`MATCH_EXP_${match.id}`);
    this._prune();
    this.bus?.emit(EVENTS.matchFinished, { match });
  }

  cancel(match, user, { isAdmin = false, reason = '' } = {}) {
    if (!LIVE.has(match.status)) throw fail('BAD_STATE', `La partida ${match.id} ya está ${match.status}.`);
    const side = this.leaderSide(match, user);
    if (match.context && !isAdmin) throw fail('MANAGED', 'Esta partida pertenece a un torneo o scrim: la cancela su organizador o un administrador.');
    if (match.status === STATUS.STARTED && !isAdmin) throw fail('ADMIN_ONLY', 'Una partida iniciada solo la cancela un administrador.');
    if (!isAdmin && side !== 'host') throw fail('NOT_HOST', 'Solo el capitán o subcapitán del anfitrión (o un administrador) puede cancelar la partida.');
    this._cancel(match, { by: user.jid, reason: reason || 'cancelada' });
    return match;
  }

  _cancel(match, { by = null, reason }) {
    match.status = STATUS.CANCELLED;
    match.cancelReason = String(reason).slice(0, 100);
    match.finishedAt = this._iso();
    this._touch(match);
    this.scheduler?.cancel(`MATCH_EXP_${match.id}`);
    audit(this.db, { scope: 'partida', ref: match.id, actor: by, action: 'cancelar', detail: reason, at: this.now() });
    this._prune();
  }

  /** Vencimiento programado: cancela lo que no llegó a iniciarse. */
  expire(matchId) {
    const m = this.db.get(COLLECTION, matchId);
    if (!m || !LIVE.has(m.status) || m.status === STATUS.STARTED) return false;
    this._cancel(m, { reason: 'vencida sin iniciar' });
    return true;
  }

  /** Reprograma el vencimiento de las partidas vivas tras un arranque (idempotente por id). */
  syncAll() {
    let n = 0;
    for (const m of this.all()) {
      if (m.status === STATUS.PENDING || m.status === STATUS.OPEN || m.status === STATUS.FULL) {
        const r = this.scheduler?.schedule({ id: `MATCH_EXP_${m.id}`, type: JOB_EXPIRE, runAt: Date.parse(m.createdAt) + this.cfg.matchTtlHours * 3600000, payload: { matchId: m.id }, graceMs: 24 * 3600000 });
        if (r?.created) n++;
      }
    }
    return { rescheduled: n };
  }

  _prune() {
    const done = this.all().filter((m) => m.status === STATUS.FINISHED || m.status === STATUS.CANCELLED);
    const extra = done.length - this.cfg.historyKeep;
    if (extra > 0) {
      done.sort((a, b) => String(a.finishedAt).localeCompare(String(b.finishedAt)));
      for (const m of done.slice(0, extra)) this.db.delete(COLLECTION, m.id);
    }
  }
}

module.exports = { MatchService, STATUS, LIVE, JOB_EXPIRE };
