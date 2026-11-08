'use strict';

const jid = require('../whatsapp/jid');
const time = require('../utils/time');
const { EVENTS } = require('../events/bus');
const { UserError } = require('./users');
const { SQUAD_SIZE, NO_CLAN_GDC_TEXT, reminderText, startText, squadCounts, platesLine } = require('./gdc-messages');

const COLLECTION = 'gdc';
const AUDIT_MAX = 200;
const MAX_SQUADS = 50;
const NOTE_MAX = 200;
const OUTCOMES = Object.freeze({ victoria: 'Victoria', derrota: 'Derrota', empate: 'Empate', cancelada: 'Cancelada' });
const JOB_REMINDER = 'gdc.reminder';
const JOB_START = 'gdc.start';

const fail = (code, message) => new UserError(code, message);

/** Interpreta el resultado escrito por un administrador. */
function parseOutcome(word) {
  const w = String(word || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const map = { victoria: 'victoria', ganada: 'victoria', ganamos: 'victoria', win: 'victoria', derrota: 'derrota', perdida: 'derrota', perdimos: 'derrota', loss: 'derrota', empate: 'empate', draw: 'empate', cancelada: 'cancelada', cancelado: 'cancelada' };
  return map[w] || null;
}

/**
 * GDC: organiza escuadras, horarios, recordatorios, resultados e historial. NO controla Free Fire y NO inventa nada:
 * solo guarda lo que los usuarios y administradores registran.
 *
 * Estado por grupo en la colección `gdc`:
 *   { groupJid, clanId, platesRequired, nextSquadNumber, squads, invites, sent:{reminder,start}, result, history, audit }
 * Hora, recordatorio y honor viven en la configuración del clan (ClanService); aquí solo se leen.
 *
 * Programación: dos trabajos diarios persistentes por clan con GDC activa (recordatorio y inicio) en el scheduler.
 * Se reconcilian solos cuando cambia la configuración, se verifica o se desverifica el clan, y al arrancar.
 * Idempotencia: ids únicos del scheduler + marca `sent.reminder/start` con la fecha local de la GDC.
 */
class GdcService {
  constructor({ db, config, clans, users, scheduler, wa = null, bus = null, logger = null, now = () => Date.now() }) {
    this.db = db;
    this.config = config;
    this.cfg = config.gdc;
    this.clans = clans;
    this.users = users;
    this.scheduler = scheduler;
    this.wa = wa;
    this.bus = bus;
    this.logger = logger;
    this.now = now;
    this.tz = config.timezone;
    this._off = [];
  }

  // ---------- arranque ----------

  /** Registra los handlers del scheduler y escucha los cambios del clan. Llamar una vez, antes de scheduler.start(). */
  register() {
    this.scheduler.register(JOB_REMINDER, (job) => this.onReminder(job));
    this.scheduler.register(JOB_START, (job) => this.onStart(job));
    if (this.bus) {
      const resync = (p) => p?.groupJid && this.syncGroup(p.groupJid);
      this._off.push(this.bus.on(EVENTS.clanVerified, resync));
      this._off.push(this.bus.on(EVENTS.clanConfigChanged, resync));
      this._off.push(
        this.bus.on(EVENTS.clanUnverified, (p) => {
          if (!p?.groupJid) return;
          this.archiveSquads(p.groupJid, { reason: 'clan desverificado', by: null });
          this.syncGroup(p.groupJid);
        })
      );
    }
    return this;
  }

  // ---------- documento por grupo ----------

  _iso() {
    return new Date(this.now()).toISOString();
  }

  today() {
    return time.localDateString(this.now(), this.tz);
  }

  doc(groupJid) {
    const g = jid.normalize(groupJid);
    return this.db.ensure(COLLECTION, g, () => ({
      groupJid: g,
      clanId: null,
      platesRequired: null,
      nextSquadNumber: 1,
      squads: {},
      invites: {},
      sent: { reminder: null, start: null },
      result: null,
      history: [],
      audit: [],
      createdAt: this._iso(),
    }));
  }

  /** Clan verificado del grupo o error estándar (la GDC solo existe con clan verificado). */
  requireClan(groupJid) {
    const clan = this.clans.clanOfGroup(groupJid);
    if (!clan) throw fail('NO_CLAN', NO_CLAN_GDC_TEXT);
    const doc = this.doc(groupJid);
    doc.clanId = clan.id;
    return { clan, doc };
  }

  requireEnabled(clan) {
    if (!clan.config.gdcEnabled) throw fail('GDC_OFF', '⚠️ La GDC está desactivada en este clan. Un administrador puede activarla con *.gdc activar*.');
  }

  audit(doc, by, action, detail = '') {
    const entry = { at: this._iso(), by: by ? jid.normalize(by) : null, action, detail: String(detail).slice(0, 200) };
    doc.audit.push(entry);
    while (doc.audit.length > AUDIT_MAX) doc.audit.shift();
    this.db.push('logs', { type: 'gdc', groupJid: doc.groupJid, ...entry });
    this.db.touch();
    return entry;
  }

  // ---------- consulta de escuadras ----------

  /** Escuadra de una persona en CUALQUIER grupo (una persona no puede estar en dos escuadras a la vez). */
  membership(userJid) {
    const j = jid.normalize(userJid);
    for (const doc of this.db.values(COLLECTION)) {
      for (const squad of Object.values(doc.squads)) {
        if (squad.members.includes(j)) return { doc, squad };
      }
    }
    return null;
  }

  squads(groupJid) {
    return Object.values(this.doc(groupJid).squads).sort((a, b) => a.number - b.number);
  }

  getSquad(doc, number) {
    return doc.squads[String(number)] || null;
  }

  _resolveUser(j) {
    return this.users.find([j]);
  }

  _requireNotInSquad(userJid, groupJid) {
    const m = this.membership(userJid);
    if (m) {
      const where = m.doc.groupJid === groupJid ? '' : ' en otro grupo';
      throw fail('ALREADY_IN_SQUAD', `Ya perteneces a la escuadra #${m.squad.number}${where}. Usa *.gdc salir* primero.`);
    }
  }

  // ---------- acciones de escuadra ----------

  create(groupJid, user) {
    const { clan, doc } = this.requireClan(groupJid);
    this.requireEnabled(clan);
    this._requireNotInSquad(user.jid, doc.groupJid);
    if (Object.keys(doc.squads).length >= MAX_SQUADS) throw fail('TOO_MANY', `Se alcanzó el máximo de ${MAX_SQUADS} escuadras en este grupo.`);
    const number = doc.nextSquadNumber++;
    const squad = { number, captain: user.jid, members: [user.jid], open: true, createdAt: this._iso(), updatedAt: this._iso() };
    doc.squads[String(number)] = squad;
    this.audit(doc, user.jid, 'crear', `escuadra #${number}`);
    this.bus?.emit(EVENTS.squadCreated, { groupJid: doc.groupJid, number, captain: user.jid });
    return squad;
  }

  join(groupJid, user, number) {
    const { clan, doc } = this.requireClan(groupJid);
    this.requireEnabled(clan);
    this._requireNotInSquad(user.jid, doc.groupJid);
    const squad = this.squadOrThrow(doc, number);
    if (squad.members.length >= SQUAD_SIZE) throw fail('SQUAD_FULL', `La escuadra #${number} ya está completa (${SQUAD_SIZE}/${SQUAD_SIZE}).`);
    if (!squad.open) throw fail('SQUAD_CLOSED', `La escuadra #${number} está cerrada: solo se entra por invitación del capitán.`);
    this._addMember(doc, squad, user.jid, 'unirse');
    return squad;
  }

  squadOrThrow(doc, number) {
    const squad = this.getSquad(doc, number);
    if (!squad) throw fail('NO_SQUAD', `No existe la escuadra #${number}. Mira las escuadras con *.gdc equipos*.`);
    return squad;
  }

  _addMember(doc, squad, userJid, action) {
    squad.members.push(userJid);
    squad.updatedAt = this._iso();
    this.audit(doc, userJid, action, `escuadra #${squad.number} (${squad.members.length}/${SQUAD_SIZE})`);
    if (squad.members.length === SQUAD_SIZE) {
      this.audit(doc, null, 'completa', `escuadra #${squad.number}`);
      this.bus?.emit(EVENTS.squadCompleted, { groupJid: doc.groupJid, number: squad.number, members: [...squad.members] });
    }
    this._dropInvitesFor(doc, userJid);
  }

  /** Quita a alguien de su escuadra. Si era capitán pasa al siguiente miembro; si queda vacía se elimina. */
  _removeMember(doc, squad, userJid) {
    squad.members = squad.members.filter((m) => m !== userJid);
    squad.updatedAt = this._iso();
    let outcome = 'left';
    if (squad.members.length === 0) {
      delete doc.squads[String(squad.number)];
      this._dropInvitesOf(doc, squad.number);
      outcome = 'deleted';
    } else if (squad.captain === userJid) {
      squad.captain = squad.members[0];
      outcome = 'newCaptain';
    }
    return outcome;
  }

  leave(groupJid, user) {
    const doc = this.doc(groupJid);
    const mine = Object.values(doc.squads).find((s) => s.members.includes(user.jid));
    if (!mine) {
      if (this.membership(user.jid)) throw fail('OTHER_GROUP', 'Tu escuadra está en otro grupo; sal desde allí con *.gdc salir*.');
      throw fail('NOT_IN_SQUAD', 'No perteneces a ninguna escuadra.');
    }
    const outcome = this._removeMember(doc, mine, user.jid);
    this.audit(doc, user.jid, 'salir', `escuadra #${mine.number}`);
    return { squad: mine, outcome };
  }

  /** El capitán expulsa a un miembro de su escuadra; un administrador puede expulsar de cualquiera. */
  kick(groupJid, actor, targetJid, { isAdmin = false } = {}) {
    const doc = this.doc(groupJid);
    const target = jid.normalize(targetJid);
    const squad = Object.values(doc.squads).find((s) => s.members.includes(target));
    if (!squad) throw fail('TARGET_NOT_IN_SQUAD', 'Esa persona no pertenece a ninguna escuadra de este grupo.');
    if (target === actor.jid) throw fail('SELF_KICK', 'No puedes expulsarte a ti mismo: usa *.gdc salir*.');
    if (squad.captain !== actor.jid && !isAdmin) throw fail('NOT_CAPTAIN', 'Solo el capitán de la escuadra (o un administrador) puede expulsar.');
    if (squad.captain === target && !isAdmin) throw fail('KICK_CAPTAIN', 'No puedes expulsar al capitán.');
    const outcome = this._removeMember(doc, squad, target);
    this.audit(doc, actor.jid, 'expulsar', `${jid.mentionTag(target)} de la escuadra #${squad.number}${isAdmin && squad.captain !== actor.jid ? ' (admin)' : ''}`);
    return { squad, outcome };
  }

  /** Abrir/cerrar una escuadra a uniones directas (capitán, o administrador indicando el número). */
  setOpen(groupJid, actor, open, { number = null, isAdmin = false } = {}) {
    const doc = this.doc(groupJid);
    let squad;
    if (number !== null) {
      squad = this.squadOrThrow(doc, number);
      if (squad.captain !== actor.jid && !isAdmin) throw fail('NOT_CAPTAIN', 'Solo el capitán (o un administrador) puede cambiar eso.');
    } else {
      squad = Object.values(doc.squads).find((s) => s.captain === actor.jid);
      if (!squad) throw fail('NOT_CAPTAIN', 'Solo el capitán de una escuadra puede abrirla o cerrarla.');
    }
    squad.open = Boolean(open);
    squad.updatedAt = this._iso();
    this.audit(doc, actor.jid, open ? 'abrir' : 'cerrar', `escuadra #${squad.number}`);
    return squad;
  }

  // ---------- invitaciones ----------

  _purgeInvites(doc) {
    const t = this.now();
    for (const [id, inv] of Object.entries(doc.invites)) {
      const dead = inv.status !== 'pending' || inv.expiresAt <= t;
      if (dead && t - (inv.resolvedAt || inv.expiresAt) > 3600 * 1000) delete doc.invites[id];
    }
  }

  _dropInvitesFor(doc, userJid) {
    for (const inv of Object.values(doc.invites)) if (inv.to === userJid && inv.status === 'pending') this._resolveInvite(inv, 'cancelled');
  }

  _dropInvitesOf(doc, number) {
    for (const inv of Object.values(doc.invites)) if (inv.squad === number && inv.status === 'pending') this._resolveInvite(inv, 'cancelled');
  }

  _resolveInvite(inv, status) {
    inv.status = status;
    inv.resolvedAt = this.now();
  }

  invite(groupJid, captain, target) {
    const { clan, doc } = this.requireClan(groupJid);
    this.requireEnabled(clan);
    this._purgeInvites(doc);
    const squad = Object.values(doc.squads).find((s) => s.captain === captain.jid);
    if (!squad) throw fail('NOT_CAPTAIN', 'Solo el capitán de una escuadra puede invitar. Crea una con *.gdc crear*.');
    if (!target) throw fail('TARGET_NOT_REGISTERED', 'Esa persona no está registrada en el bot, así que no puede recibir invitaciones.');
    if (target.jid === captain.jid) throw fail('SELF_INVITE', 'No puedes invitarte a ti mismo.');
    if (squad.members.length >= SQUAD_SIZE) throw fail('SQUAD_FULL', `Tu escuadra ya está completa (${SQUAD_SIZE}/${SQUAD_SIZE}).`);
    if (this.membership(target.jid)) throw fail('TARGET_BUSY', 'Esa persona ya pertenece a una escuadra.');
    const dup = Object.values(doc.invites).find((i) => i.status === 'pending' && i.expiresAt > this.now() && i.squad === squad.number && i.to === target.jid);
    if (dup) throw fail('INVITE_EXISTS', 'Ya le enviaste una invitación vigente a esa persona.');
    const id = `${squad.number}-${this.now().toString(36)}-${Object.keys(doc.invites).length}`;
    const inv = { id, squad: squad.number, from: captain.jid, to: target.jid, createdAt: this.now(), expiresAt: this.now() + this.cfg.inviteTtlMin * 60000, status: 'pending' };
    doc.invites[id] = inv;
    this.audit(doc, captain.jid, 'invitar', `${jid.mentionTag(target.jid)} a la escuadra #${squad.number}`);
    return { invite: inv, squad };
  }

  /** Invitaciones vigentes de una persona (opcionalmente de una escuadra concreta). */
  pendingInvites(doc, userJid, number = null) {
    const t = this.now();
    return Object.values(doc.invites)
      .filter((i) => i.to === userJid && i.status === 'pending' && i.expiresAt > t && doc.squads[String(i.squad)] && (number === null || i.squad === number))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  acceptInvite(groupJid, user, number = null) {
    const { clan, doc } = this.requireClan(groupJid);
    this.requireEnabled(clan);
    const list = this.pendingInvites(doc, user.jid, number);
    if (list.length === 0) throw fail('NO_INVITE', number === null ? 'No tienes invitaciones vigentes.' : `No tienes una invitación vigente de la escuadra #${number}.`);
    this._requireNotInSquad(user.jid, doc.groupJid);
    const inv = list[0];
    const squad = doc.squads[String(inv.squad)];
    if (squad.members.length >= SQUAD_SIZE) {
      this._resolveInvite(inv, 'expired');
      throw fail('SQUAD_FULL', `La escuadra #${squad.number} ya se completó.`);
    }
    this._resolveInvite(inv, 'accepted');
    this._addMember(doc, squad, user.jid, 'aceptar');
    return squad;
  }

  rejectInvite(groupJid, user, number = null) {
    const { doc } = this.requireClan(groupJid);
    const list = this.pendingInvites(doc, user.jid, number);
    if (list.length === 0) throw fail('NO_INVITE', number === null ? 'No tienes invitaciones vigentes.' : `No tienes una invitación vigente de la escuadra #${number}.`);
    const inv = list[0];
    this._resolveInvite(inv, 'rejected');
    this.audit(doc, user.jid, 'rechazar', `invitación de la escuadra #${inv.squad}`);
    return { invite: inv, squad: doc.squads[String(inv.squad)] };
  }

  // ---------- configuración propia de la GDC ----------

  setPlates(groupJid, value, by) {
    const { doc } = this.requireClan(groupJid);
    const before = doc.platesRequired;
    doc.platesRequired = value;
    this.audit(doc, by, 'placas', `${before ?? 'sin definir'} → ${value ?? 'sin definir'}`);
    return doc.platesRequired;
  }

  // ---------- resultados e historial (manuales) ----------

  setResult(groupJid, by, { outcome, note = '' }) {
    const { doc } = this.requireClan(groupJid);
    const key = parseOutcome(outcome);
    if (!key) throw fail('BAD_OUTCOME', `Resultado no válido. Usa: ${Object.keys(OUTCOMES).join(', ')}.`);
    const cleanNote = String(note || '').replace(/[\u0000-\u001F\u007F​-‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX);
    doc.result = { outcome: key, note: cleanNote, by: jid.normalize(by), at: this._iso() };
    this.audit(doc, by, 'resultado', `${OUTCOMES[key]}${cleanNote ? `: ${cleanNote}` : ''}`);
    return doc.result;
  }

  /** Archiva las escuadras actuales y el resultado en el historial y deja el grupo listo para la siguiente GDC. */
  finalize(groupJid, by, { outcome = null, note = '' } = {}) {
    const { clan, doc } = this.requireClan(groupJid);
    if (outcome) this.setResult(groupJid, by, { outcome, note });
    const entry = this._archive(doc, clan, { reason: 'finalizada', by });
    this.bus?.emit(EVENTS.gdcFinished, { groupJid: doc.groupJid, clanId: clan.id, result: entry.result });
    return entry;
  }

  _archive(doc, clan, { reason, by }) {
    const entry = {
      id: `${this.today()}-${doc.history.length + 1}`,
      date: this.today(),
      finishedAt: this._iso(),
      finishedBy: by ? jid.normalize(by) : null,
      reason,
      clanId: clan?.id || doc.clanId,
      clanName: clan?.name || null,
      startedDate: doc.sent.start,
      platesRequired: doc.platesRequired,
      honor: clan ? { enabled: clan.config.honorEnabled, required: clan.config.honorRequired } : null,
      result: doc.result,
      squads: Object.values(doc.squads)
        .sort((a, b) => a.number - b.number)
        .map((s) => ({ number: s.number, captain: s.captain, members: [...s.members], names: s.members.map((m) => this._resolveUser(m)?.name || null) })),
    };
    doc.history.push(entry);
    while (doc.history.length > this.cfg.historyKeep) doc.history.shift();
    doc.squads = {};
    doc.invites = {};
    doc.result = null;
    doc.nextSquadNumber = 1;
    this.audit(doc, by, 'finalizar', `${reason}: ${entry.squads.length} escuadras${entry.result ? `, ${OUTCOMES[entry.result.outcome]}` : ', sin resultado'}`);
    return entry;
  }

  /** Archiva (sin resultado) lo que haya en el grupo; se usa al desverificar el clan. */
  archiveSquads(groupJid, { reason, by = null }) {
    const doc = this.db.get(COLLECTION, jid.normalize(groupJid));
    if (!doc || (Object.keys(doc.squads).length === 0 && !doc.result)) return null;
    return this._archive(doc, this.clans.get(doc.clanId), { reason, by });
  }

  history(groupJid, limit = 5) {
    return this.doc(groupJid).history.slice(-limit).reverse();
  }

  /** Escuadras sin actividad durante GDC_SQUAD_TTL_HOURS se archivan solas para no dejar a nadie atrapado. */
  expireStale(doc) {
    const limit = this.now() - this.cfg.squadTtlHours * 3600 * 1000;
    const stale = Object.values(doc.squads).filter((s) => Date.parse(s.updatedAt) < limit);
    if (!stale.length) return 0;
    for (const s of stale) {
      delete doc.squads[String(s.number)];
      this._dropInvitesOf(doc, s.number);
      this.audit(doc, null, 'expirar', `escuadra #${s.number} sin actividad`);
    }
    return stale.length;
  }

  // ---------- estado ----------

  /** Próxima GDC según la configuración del clan: { runAt, localDate, localTime } o null si está desactivada. */
  nextStart(clan) {
    if (!clan.config.gdcEnabled) return null;
    return time.nextDailyOccurrence({ hhmm: clan.config.gdcTime, tz: this.tz, afterMs: this.now() });
  }

  describeNext(clan) {
    const n = this.nextStart(clan);
    if (!n) return 'desactivada';
    const today = this.today();
    const tomorrow = time.localDateString(this.now() + 24 * 3600 * 1000, this.tz);
    const day = n.localDate === today ? 'hoy' : n.localDate === tomorrow ? 'mañana' : n.localDate;
    return `${day} a las ${n.localTime}`;
  }

  /** Líneas para el menú dinámico. Solo datos reales del estado guardado. */
  menuLines(clan) {
    const doc = this.doc(clan.groupJid);
    const counts = squadCounts(doc.squads);
    const lines = [`📅 Próxima GDC: ${this.describeNext(clan)}`];
    lines.push(platesLine(doc.platesRequired));
    if (clan.config.gdcEnabled) lines.push(`👥 Escuadras: ${counts.total}${counts.total ? ` (${counts.complete} completas)` : ''} · *.gdc* para el panel`);
    return lines;
  }

  // ---------- programación ----------

  _jobSpecs(clan, groupJid) {
    const cfg = clan.config;
    const base = { tz: this.tz, hhmm: cfg.gdcTime, payload: { groupJid, clanId: clan.id } };
    return [
      { ...base, baseId: `GDC_REM_${groupJid}`, type: JOB_REMINDER, offsetMinutes: -cfg.reminderMinutes, graceMs: cfg.reminderMinutes * 60000 },
      { ...base, baseId: `GDC_START_${groupJid}`, type: JOB_START, offsetMinutes: 0, graceMs: this.config.scheduler.graceMs },
    ];
  }

  /**
   * Deja en el scheduler exactamente los trabajos que corresponden al estado actual del grupo:
   * cancela los pendientes que ya no valen (hora o recordatorio cambiados, GDC desactivada, clan desverificado)
   * y programa los que faltan. Es idempotente: llamarla muchas veces no crea duplicados.
   */
  syncGroup(groupJid) {
    const group = jid.normalize(groupJid);
    const clan = this.clans.clanOfGroup(group);
    const desired = new Set();
    if (clan && clan.config.gdcEnabled) {
      for (const spec of this._jobSpecs(clan, group)) {
        const next = time.nextDailyOccurrence({ hhmm: spec.hhmm, tz: spec.tz, afterMs: this.now(), offsetMinutes: spec.offsetMinutes });
        desired.add(`${spec.baseId}_${next.localDate}_${next.localTime}`);
      }
    }
    let cancelled = 0;
    for (const job of this.scheduler.pending()) {
      if (!String(job.type).startsWith('gdc.') || job.payload?.groupJid !== group) continue;
      // Un aviso ya vencido pero con la configuración vigente lo decide el scheduler al recuperarse (gracia → se envía, si no → perdido).
      const overdueCurrent = clan && clan.config.gdcEnabled && job.runAt <= this.now() && this._isCurrent(job, clan, job.recurrence?.offsetMinutes);
      if (!desired.has(job.id) && !overdueCurrent) {
        this.scheduler.cancel(job.id);
        cancelled++;
      }
    }
    let created = 0;
    if (clan && clan.config.gdcEnabled) {
      for (const spec of this._jobSpecs(clan, group)) {
        if (this.scheduler.scheduleDaily(spec).created) created++;
      }
    }
    return { cancelled, created };
  }

  /** Reconcilia todos los grupos con clan (al arrancar y tras restaurar una copia de seguridad). */
  syncAll() {
    const groups = new Set([...this.clans.active().map((c) => c.groupJid), ...this.db.values(COLLECTION).map((d) => d.groupJid)]);
    let created = 0;
    let cancelled = 0;
    for (const g of groups) {
      if (!g) continue;
      const r = this.syncGroup(g);
      created += r.created;
      cancelled += r.cancelled;
    }
    return { groups: groups.size, created, cancelled };
  }

  // ---------- menciones y envío ----------

  /**
   * Participantes reales del grupo para mencionar: primero los de las escuadras, luego el resto de los participantes
   * de WhatsApp. Se usan JIDs reales (teléfono si WhatsApp lo da, si no el @lid). Si no se pueden consultar los
   * participantes, se mencionan solo los de las escuadras (el aviso se envía igual).
   */
  async mentionTargets(groupJid, doc) {
    const out = [];
    const seen = new Set();
    const self = new Set([this.wa?.selfJid, this.wa?.selfLid].filter(Boolean).map((j) => jid.normalize(j)));
    const selfNumber = this.wa?.selfNumber;
    const add = (j) => {
      const n = jid.normalize(j);
      if (!n || seen.has(n) || self.has(n) || (selfNumber && jid.toNumber(n) === selfNumber)) return;
      seen.add(n);
      out.push(n);
    };
    for (const s of Object.values(doc.squads)) s.members.forEach(add);
    try {
      const meta = await this.wa.groupMetadata(groupJid);
      for (const p of meta?.participants || []) {
        const phone = [p.phoneNumber, p.jid, p.id].map((j) => jid.normalize(j)).find((j) => j && jid.isUser(j));
        add(phone || p.lid || p.id);
      }
    } catch (err) {
      this.logger?.warn('GDC: no se pudieron consultar los participantes; se mencionan solo las escuadras.', err);
    }
    return out.slice(0, this.cfg.maxMentions);
  }

  _gdcDate(job, offsetMinutes) {
    return time.localDateString(job.runAt - offsetMinutes * 60000, this.tz);
  }

  /** ¿El trabajo corresponde a la configuración actual? (si el admin cambió la hora, el viejo ya no vale) */
  _isCurrent(job, clan, offsetMinutes) {
    return job.recurrence?.hhmm === clan.config.gdcTime && job.recurrence?.offsetMinutes === offsetMinutes;
  }

  async onReminder(job) {
    const group = job.payload.groupJid;
    const clan = this.clans.clanOfGroup(group);
    if (!clan || !clan.config.gdcEnabled) return;
    if (!this._isCurrent(job, clan, -clan.config.reminderMinutes)) {
      setImmediate(() => this.syncGroup(group));
      return;
    }
    const doc = this.doc(group);
    const date = this._gdcDate(job, job.recurrence.offsetMinutes);
    if (doc.sent.reminder === date) return; // idempotencia: ya se envió para esa GDC
    if (this.expireStale(doc)) this.db.touch();
    const mentions = await this.mentionTargets(group, doc);
    const text = reminderText({ clan, doc, mentions });
    await this.wa.sendText(group, text, { mentions }); // si falla lanza → el scheduler reintenta
    doc.sent.reminder = date;
    this.audit(doc, null, 'recordatorio', `enviado para ${date} (${Object.keys(doc.squads).length} escuadras, ${mentions.length} menciones)`);
    this.bus?.emit(EVENTS.gdcReminder, { groupJid: group, date });
  }

  async onStart(job) {
    const group = job.payload.groupJid;
    const clan = this.clans.clanOfGroup(group);
    if (!clan || !clan.config.gdcEnabled) return;
    if (!this._isCurrent(job, clan, 0)) {
      setImmediate(() => this.syncGroup(group));
      return;
    }
    const doc = this.doc(group);
    const date = this._gdcDate(job, 0);
    if (doc.sent.start === date) return;
    if (this.expireStale(doc)) this.db.touch();
    const mentions = await this.mentionTargets(group, doc);
    const text = startText({ clan, doc, mentions });
    await this.wa.sendText(group, text, { mentions });
    doc.sent.start = date;
    this.audit(doc, null, 'inicio', `GDC iniciada ${date} (${Object.keys(doc.squads).length} escuadras, ${mentions.length} menciones)`);
    this.bus?.emit(EVENTS.gdcStarted, { groupJid: group, date });
  }
}

module.exports = { GdcService, OUTCOMES, parseOutcome, JOB_REMINDER, JOB_START, MAX_SQUADS };
