'use strict';

const jid = require('../whatsapp/jid');
const { EVENTS } = require('../events/bus');
const { nextId, audit, fail } = require('./common');

const COLLECTION = 'scrims';
const JOB_REMIND = 'scrim.remind';
const JOB_EXPIRE = 'scrim.expire';
const ST = Object.freeze({ OPEN: 'abierto', FULL: 'lleno', RUNNING: 'en_curso', FINISHED: 'finalizado', CANCELLED: 'cancelado' });
const LIVE = new Set([ST.OPEN, ST.FULL, ST.RUNNING]);
const LOCKED = new Set([ST.FULL, ST.RUNNING]);
const POINTS = Object.freeze({ win: 3, draw: 1 });

/**
 * Scrims: práctica programada entre DOS equipos de la misma modalidad.
 *   abierto (espera rival) → lleno (con rival) → en_curso (ambos hicieron check-in: se crea la partida real) → finalizado.
 * El resultado lo reportan los capitanes (deben coincidir) o lo fija un administrador, exactamente como en las partidas.
 */
class ScrimService {
  constructor({ db, teams, matches, scheduler, wa = null, bus = null, config, logger = null, now = () => Date.now() }) {
    this.db = db;
    this.teams = teams;
    this.matches = matches;
    this.scheduler = scheduler;
    this.wa = wa;
    this.bus = bus;
    this.config = config;
    this.cfg = config.scrims;
    this.logger = logger;
    this.now = now;
    teams.addGuard((team, action) => {
      const s = this.liveFor(team.id).find((x) => LOCKED.has(x.status) || action === 'disolución');
      return s ? `El equipo ${team.name} tiene un scrim (${s.id}, ${s.status.replace('_', ' ')}): no se puede hacer un ${action} ahora.` : null;
    });
  }

  register() {
    this.scheduler?.register(JOB_REMIND, (job) => this.onRemind(job));
    this.scheduler?.register(JOB_EXPIRE, (job) => this.onExpire(job));
    this.bus?.on(EVENTS.matchFinished, ({ match }) => this.onMatchFinished(match));
    return this;
  }

  _iso() {
    return new Date(this.now()).toISOString();
  }

  // ---------- consulta ----------

  get(ref) {
    const m = String(ref ?? '').trim().match(/^(?:scr-?)?(\d{1,6})$/i);
    return m ? this.db.get(COLLECTION, `SCR-${m[1].padStart(3, '0')}`) || null : null;
  }

  require(ref) {
    const s = this.get(ref);
    if (!s) throw fail('NO_SCRIM', `No encontré el scrim "${String(ref ?? '').slice(0, 20)}". Usa su ID, por ejemplo SCR-001.`);
    return s;
  }

  all() {
    return this.db.values(COLLECTION);
  }

  liveFor(teamId) {
    return this.all().filter((s) => LIVE.has(s.status) && (s.host === teamId || s.guest === teamId));
  }

  upcoming() {
    return this.all().filter((s) => LIVE.has(s.status)).sort((a, b) => a.scheduledAt - b.scheduledAt);
  }

  sideOf(s, teamId) {
    return s.host === teamId ? 'host' : s.guest === teamId ? 'guest' : null;
  }

  leaderSide(s, user) {
    for (const side of ['host', 'guest']) {
      const t = s[side] ? this.teams.db.get('teams', s[side]) : null;
      if (t && this.teams.isLeader(t, user.jid)) return side;
    }
    return null;
  }

  _rank() {
    return this.db.ensure('rankings', 'scrims', () => ({ teams: {}, applied: {} }));
  }

  ranking(limit = 10) {
    return Object.entries(this._rank().teams)
      .map(([id, r]) => ({ id, ...r }))
      .sort((a, b) => b.points - a.points || b.wins - a.wins || a.played - b.played || a.id.localeCompare(b.id))
      .slice(0, limit);
  }

  teamStats(teamId) {
    return this._rank().teams[teamId] || null;
  }

  history(teamId = null, limit = 10) {
    return this.all()
      .filter((s) => (s.status === ST.FINISHED || s.status === ST.CANCELLED) && (!teamId || s.host === teamId || s.guest === teamId))
      .sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)))
      .slice(0, limit);
  }

  // ---------- ciclo de vida ----------

  create({ user, team, whenMs, groupJid = null }) {
    this.teams._requireLeader(team, user);
    if (!this.teams.isFull(team)) throw fail('TEAM_NOT_FULL', `Tu equipo debe estar completo (${team.members.length}/${team.size}).`);
    if (this.liveFor(team.id).length) throw fail('BUSY', 'Tu equipo ya tiene un scrim sin terminar.');
    const id = nextId(this.db, 'scrim', 'SCR', 3);
    const s = {
      id,
      mode: team.mode,
      status: ST.OPEN,
      host: team.id,
      guest: null,
      scheduledAt: whenMs,
      groupJid: groupJid ? jid.normalize(groupJid) : null,
      createdBy: user.jid,
      createdAt: this._iso(),
      checkins: { host: false, guest: false },
      matchId: null,
      result: null,
      cancelReason: null,
      notified: {},
      finishedAt: null,
    };
    this.db.set(COLLECTION, id, s);
    this.syncOne(s);
    audit(this.db, { scope: 'scrim', ref: id, actor: user.jid, action: 'crear', detail: `${team.id} ${team.mode}`, at: this.now() });
    return s;
  }

  _need(s, allowed, verb) {
    if (!allowed.includes(s.status)) throw fail('BAD_STATE', `El scrim ${s.id} está ${s.status.replace('_', ' ')}: no se puede ${verb}.`);
  }

  join(s, user, team) {
    this._need(s, [ST.OPEN], 'unirse a');
    this.teams._requireLeader(team, user);
    if (team.id === s.host) throw fail('SAME_TEAM', 'Tu equipo ya es el anfitrión del scrim.');
    if (team.mode !== s.mode) throw fail('MODE_MISMATCH', `El scrim es ${s.mode} y tu equipo ${team.mode}.`);
    if (!this.teams.isFull(team)) throw fail('TEAM_NOT_FULL', `Tu equipo debe estar completo (${team.members.length}/${team.size}).`);
    if (this.liveFor(team.id).length) throw fail('BUSY', 'Tu equipo ya tiene un scrim sin terminar.');
    const host = this.teams.db.get('teams', s.host);
    if (host.members.some((m) => team.members.includes(m))) throw fail('DUPLICATE_PLAYERS', 'Hay jugadores repetidos en los dos equipos.');
    s.guest = team.id;
    s.status = ST.FULL;
    this.db.touch();
    audit(this.db, { scope: 'scrim', ref: s.id, actor: user.jid, action: 'unirse', detail: team.id, at: this.now() });
    return s;
  }

  leave(s, user) {
    this._need(s, [ST.FULL], 'retirar al rival de');
    if (this.leaderSide(s, user) !== 'guest') throw fail('NOT_GUEST', 'Solo el capitán o subcapitán del equipo rival puede retirarse.');
    const g = s.guest;
    s.guest = null;
    s.checkins = { host: false, guest: false };
    s.status = ST.OPEN;
    this.db.touch();
    audit(this.db, { scope: 'scrim', ref: s.id, actor: user.jid, action: 'salir', detail: g, at: this.now() });
    return s;
  }

  checkinWindow(s) {
    return { from: s.scheduledAt - this.cfg.checkinMinutes * 60000, to: s.scheduledAt + this.cfg.expireHours * 3600000 };
  }

  /** Check-in de un equipo. Cuando los dos lo hicieron se crea la partida real y el scrim pasa a en_curso. */
  checkin(s, user) {
    this._need(s, [ST.FULL], 'hacer check-in en');
    const side = this.leaderSide(s, user);
    if (!side) throw fail('NOT_LEADER', 'Solo el capitán o subcapitán de un equipo del scrim puede hacer check-in.');
    const w = this.checkinWindow(s);
    if (this.now() < w.from) throw fail('TOO_EARLY', `El check-in abre ${this.cfg.checkinMinutes} minutos antes de la hora.`);
    if (this.now() > w.to) throw fail('TOO_LATE', 'El scrim ya venció.');
    if (s.checkins[side]) throw fail('ALREADY', 'Tu equipo ya hizo check-in.');
    s.checkins[side] = true;
    audit(this.db, { scope: 'scrim', ref: s.id, actor: user.jid, action: 'checkin', detail: side, at: this.now() });
    let started = false;
    if (s.checkins.host && s.checkins.guest) {
      const match = this.matches.createForContext({
        host: this.teams.db.get('teams', s.host),
        guest: this.teams.db.get('teams', s.guest),
        context: { type: 'scrim', id: s.id },
        groupJid: s.groupJid,
        by: user.jid,
      });
      s.matchId = match.id;
      s.status = ST.RUNNING;
      started = true;
    }
    this.db.touch();
    return { scrim: s, started };
  }

  /** Reporta el resultado a través de la partida real asociada. */
  report(s, user, outcome) {
    this._need(s, [ST.RUNNING], 'reportar el resultado de');
    return this.matches.report(this.matches.require(s.matchId), user, outcome);
  }

  resolve(s, admin, winner) {
    this._need(s, [ST.RUNNING], 'resolver');
    return this.matches.resolve(this.matches.require(s.matchId), admin, winner);
  }

  cancel(s, user, { isAdmin = false, reason = '' } = {}) {
    this._need(s, [ST.OPEN, ST.FULL, ST.RUNNING], 'cancelar');
    if (!isAdmin && this.leaderSide(s, user) !== 'host') throw fail('NOT_HOST', 'Solo el capitán o subcapitán del anfitrión (o un administrador) puede cancelar el scrim.');
    if (s.status === ST.RUNNING && !isAdmin) throw fail('ADMIN_ONLY', 'Un scrim en curso solo lo cancela un administrador.');
    this._cancel(s, reason || 'cancelado', user.jid);
    return s;
  }

  _cancel(s, reason, by = null) {
    if (s.matchId) {
      const m = this.matches.get(s.matchId);
      if (m) this.matches.cancelContext(m, 'scrim cancelado', by);
    }
    s.status = ST.CANCELLED;
    s.cancelReason = String(reason).slice(0, 100);
    s.finishedAt = this._iso();
    this.syncOne(s);
    this.db.touch();
    audit(this.db, { scope: 'scrim', ref: s.id, actor: by, action: 'cancelar', detail: s.cancelReason, at: this.now() });
  }

  onMatchFinished(match) {
    const ctx = match.context;
    if (!ctx || ctx.type !== 'scrim') return;
    const s = this.get(ctx.id);
    if (!s || s.status !== ST.RUNNING || s.matchId !== match.id) return; // idempotente
    s.status = ST.FINISHED;
    s.finishedAt = this._iso();
    s.result = { winner: match.result.winner, source: match.result.source };
    const doc = this._rank();
    if (!doc.applied[s.id]) {
      doc.applied[s.id] = true;
      for (const side of ['host', 'guest']) {
        const id = s[side];
        const team = this.teams.db.get('teams', id);
        const r = (doc.teams[id] ||= { name: team?.name || id, played: 0, wins: 0, losses: 0, draws: 0, points: 0 });
        r.name = team?.name || r.name;
        r.played += 1;
        if (match.result.winner === 'draw') {
          r.draws += 1;
          r.points += POINTS.draw;
        } else if (match.result.winner === side) {
          r.wins += 1;
          r.points += POINTS.win;
        } else r.losses += 1;
      }
    }
    this.syncOne(s);
    this.db.touch();
    audit(this.db, { scope: 'scrim', ref: s.id, actor: null, action: 'finalizar', detail: match.result.winner, at: this.now() });
    this.bus?.emit(EVENTS.scrimFinished, { scrim: s });
  }

  // ---------- scheduler ----------

  syncOne(s) {
    if (!this.scheduler) return { created: 0, cancelled: 0 };
    const desired = new Map();
    if (LIVE.has(s.status)) {
      const remind = s.scheduledAt - this.cfg.remindMinutes * 60000;
      if (remind > this.now() - 60000 && s.status !== ST.RUNNING) desired.set(`SCR_REM_${s.id}_${s.scheduledAt}`, { type: JOB_REMIND, runAt: remind, grace: 10 * 60000 });
      desired.set(`SCR_EXP_${s.id}_${s.scheduledAt}`, { type: JOB_EXPIRE, runAt: s.scheduledAt + this.cfg.expireHours * 3600000, grace: 24 * 3600000 });
    }
    let cancelled = 0;
    for (const j of this.scheduler.pending()) {
      if (String(j.type).startsWith('scrim.') && j.payload.scrimId === s.id && !desired.has(j.id)) {
        this.scheduler.cancel(j.id);
        cancelled++;
      }
    }
    let created = 0;
    for (const [id, d] of desired) if (this.scheduler.schedule({ id, type: d.type, runAt: d.runAt, payload: { scrimId: s.id }, graceMs: d.grace }).created) created++;
    return { created, cancelled };
  }

  syncAll() {
    let created = 0;
    let cancelled = 0;
    for (const s of this.all()) {
      const r = this.syncOne(s);
      created += r.created;
      cancelled += r.cancelled;
    }
    return { created, cancelled };
  }

  async onRemind(job) {
    const s = this.get(job.payload.scrimId);
    if (!s || ![ST.OPEN, ST.FULL].includes(s.status) || s.notified.remind || !s.groupJid || !this.wa) return;
    const caps = [s.host, s.guest].map((id) => (id ? this.teams.db.get('teams', id)?.captain : null)).filter(Boolean);
    const text = s.status === ST.FULL
      ? `⏰ *Scrim ${s.id}* empieza en ${this.cfg.remindMinutes} minutos. Los capitanes hagan *.scrim checkin ${s.id}*.`
      : `⏰ *Scrim ${s.id}* empieza en ${this.cfg.remindMinutes} minutos y todavía no tiene rival. Únete con *.scrim unirse ${s.id}*.`;
    await this.wa.sendText(s.groupJid, text, { mentions: caps });
    s.notified.remind = true;
    this.db.touch();
  }

  async onExpire(job) {
    const s = this.get(job.payload.scrimId);
    if (!s || !LIVE.has(s.status)) return;
    this._cancel(s, 'vencido sin terminar');
    if (s.groupJid && this.wa) {
      try {
        await this.wa.sendText(s.groupJid, `⌛ El scrim ${s.id} venció sin terminar y se canceló.`);
      } catch (err) {
        this.logger?.warn('No se pudo avisar el vencimiento del scrim', err);
      }
    }
  }
}

module.exports = { ScrimService, ST, LIVE, POINTS };
