'use strict';

const jid = require('../whatsapp/jid');
const { sanitizeName } = require('./users');
const { nextId, audit, fail } = require('./common');

const COLLECTION = 'teams';
const MODES = Object.freeze({ '2v2': 2, '4v4': 4, '6v6': 6 });
const NAME_MIN = 3;
const NAME_MAX = 20;

/** "2v2", "2vs2", "2" → "2v2". null si no es un modo válido. */
function parseMode(text) {
  const m = String(text ?? '').toLowerCase().replace(/\s+/g, '').match(/^(\d)(?:v|vs|x)?(\d)?$/);
  if (!m) return null;
  const key = `${m[1]}v${m[2] || m[1]}`;
  return MODES[key] ? key : null;
}

function cleanTeamName(raw) {
  const name = sanitizeName(raw, '').replace(/[^\p{L}\p{N} ._-]/gu, '').replace(/\s+/g, ' ').trim();
  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    throw fail('BAD_NAME', `El nombre del equipo debe tener entre ${NAME_MIN} y ${NAME_MAX} caracteres (letras, números, espacios, . _ -).`);
  }
  return name;
}

const normName = (n) => n.toLowerCase();

/**
 * Equipos 2v2 / 4v4 / 6v6. Reglas:
 *  - un jugador solo puede estar en UN equipo activo por modalidad (sin duplicados);
 *  - un equipo no supera el tamaño de su modalidad; para jugar debe estar completo;
 *  - roles: capitán (uno), subcapitán (opcional);
 *  - la plantilla no puede cambiar mientras el equipo esté en una partida llena/iniciada (guardas registradas por otros módulos).
 */
class TeamService {
  constructor({ db, users, config, bus = null, logger = null, now = () => Date.now() }) {
    this.db = db;
    this.users = users;
    this.cfg = config.teams;
    this.bus = bus;
    this.logger = logger;
    this.now = now;
    this.guards = [];
  }

  /** Otros módulos (partidas, torneos, scrims) pueden impedir cambios de plantilla: fn(team, action) → mensaje | null. */
  addGuard(fn) {
    this.guards.push(fn);
  }

  _guard(team, action) {
    for (const g of this.guards) {
      const msg = g(team, action);
      if (msg) throw fail('TEAM_LOCKED', msg);
    }
  }

  _iso() {
    return new Date(this.now()).toISOString();
  }

  // ---------- consulta ----------

  active() {
    return this.db.values(COLLECTION).filter((t) => t.status === 'activo');
  }

  /** Busca por id (EQ-0001, eq-1, 1) o por nombre exacto (sin importar mayúsculas). Incluye disueltos si `any`. */
  find(ref, { any = false } = {}) {
    const raw = String(ref ?? '').trim();
    if (!raw) return null;
    let id = null;
    const m = raw.match(/^(?:eq-?)?(\d{1,6})$/i);
    if (m) id = `EQ-${m[1].padStart(4, '0')}`;
    let t = id ? this.db.get(COLLECTION, id) : null;
    if (!t) t = this.db.values(COLLECTION).find((x) => normName(x.name) === normName(raw) && (any || x.status === 'activo')) || null;
    if (t && !any && t.status !== 'activo') return null;
    return t || null;
  }

  require(ref) {
    const t = this.find(ref);
    if (!t) throw fail('NO_TEAM', `No encontré el equipo "${String(ref).slice(0, 30)}". Usa su ID (EQ-0001) o su nombre exacto.`);
    return t;
  }

  teamsOf(jidValue) {
    const j = jid.normalize(jidValue);
    return this.active().filter((t) => t.members.includes(j));
  }

  /** Equipo del jugador en una modalidad, o el único que tenga si no se indica modalidad. */
  ownTeam(user, modeHint = null) {
    const mine = this.teamsOf(user.jid);
    if (mine.length === 0) throw fail('NO_OWN_TEAM', 'No perteneces a ningún equipo. Crea uno con *.equipo crear MODO NOMBRE*.');
    if (modeHint) {
      const mode = parseMode(modeHint);
      if (!mode) throw fail('BAD_MODE', 'La modalidad debe ser 2v2, 4v4 o 6v6.');
      const t = mine.find((x) => x.mode === mode);
      if (!t) throw fail('NO_OWN_TEAM', `No tienes un equipo ${mode}.`);
      return t;
    }
    if (mine.length > 1) throw fail('AMBIGUOUS_TEAM', `Perteneces a varios equipos (${mine.map((t) => `${t.id} ${t.mode}`).join(', ')}). Indica la modalidad, por ejemplo *2v2*.`);
    return mine[0];
  }

  isLeader(team, jidValue) {
    return team.captain === jidValue || team.vice === jidValue;
  }

  isFull(team) {
    return team.members.length === team.size;
  }

  // ---------- altas ----------

  create({ user, mode, name, groupJid = null, clanId = null }) {
    const m = parseMode(mode);
    if (!m) throw fail('BAD_MODE', 'La modalidad debe ser 2v2, 4v4 o 6v6.');
    const clean = cleanTeamName(name);
    if (this.teamsOf(user.jid).some((t) => t.mode === m)) throw fail('ALREADY_IN_TEAM', `Ya perteneces a un equipo ${m}. Sal de él antes de crear otro.`);
    if (this.active().some((t) => normName(t.name) === normName(clean))) throw fail('NAME_TAKEN', `Ya existe un equipo llamado "${clean}".`);
    if (this.active().filter((t) => t.captain === user.jid).length >= this.cfg.maxPerCaptain) {
      throw fail('TOO_MANY', `Solo puedes ser capitán de ${this.cfg.maxPerCaptain} equipos a la vez.`);
    }
    const id = nextId(this.db, 'team', 'EQ');
    const team = {
      id,
      name: clean,
      mode: m,
      size: MODES[m],
      status: 'activo',
      captain: user.jid,
      vice: null,
      members: [user.jid],
      invites: [],
      groupJid: groupJid ? jid.normalize(groupJid) : null,
      clanId: clanId || null,
      createdAt: this._iso(),
      stats: { played: 0, wins: 0, losses: 0, draws: 0, streak: 0, bestStreak: 0 },
      recent: [], // ids de partidas finalizadas (las 50 últimas)
    };
    this.db.set(COLLECTION, id, team);
    audit(this.db, { scope: 'equipo', ref: id, actor: user.jid, action: 'crear', detail: `${m} ${clean}`, at: this.now() });
    return team;
  }

  // ---------- invitaciones ----------

  _pruneInvites(team) {
    const ttl = this.cfg.inviteTtlMin * 60000;
    const before = team.invites.length;
    team.invites = team.invites.filter((i) => this.now() - i.at <= ttl);
    if (team.invites.length !== before) this.db.touch();
  }

  invite(team, actor, targetUser) {
    this._requireLeader(team, actor);
    if (!targetUser) throw fail('TARGET_NOT_REGISTERED', 'Esa persona no está registrada en el bot, no puedo invitarla.');
    if (targetUser.jid === actor.jid) throw fail('SELF', 'No puedes invitarte a ti mismo.');
    if (team.members.includes(targetUser.jid)) throw fail('ALREADY_MEMBER', 'Esa persona ya está en tu equipo.');
    if (this.teamsOf(targetUser.jid).some((t) => t.mode === team.mode)) throw fail('TARGET_BUSY', `Esa persona ya pertenece a un equipo ${team.mode}.`);
    this._pruneInvites(team);
    if (team.invites.some((i) => i.jid === targetUser.jid)) throw fail('ALREADY_INVITED', 'Esa persona ya tiene una invitación pendiente de tu equipo.');
    if (team.members.length + team.invites.length >= team.size) throw fail('TEAM_FULL', `El equipo ya está completo o tiene invitaciones pendientes para los ${team.size} lugares.`);
    team.invites.push({ jid: targetUser.jid, by: actor.jid, at: this.now() });
    this.db.touch();
    audit(this.db, { scope: 'equipo', ref: team.id, actor: actor.jid, action: 'invitar', detail: targetUser.jid, at: this.now() });
    return team;
  }

  invitesFor(user) {
    const out = [];
    for (const t of this.active()) {
      this._pruneInvites(t);
      if (t.invites.some((i) => i.jid === user.jid)) out.push(t);
    }
    return out;
  }

  _pickInvite(user, ref) {
    const list = this.invitesFor(user);
    if (list.length === 0) throw fail('NO_INVITES', 'No tienes invitaciones de equipo vigentes.');
    if (ref) {
      const t = this.find(ref);
      const hit = t && list.find((x) => x.id === t.id);
      if (!hit) throw fail('NO_INVITE', 'No tienes una invitación vigente de ese equipo.');
      return hit;
    }
    if (list.length > 1) throw fail('AMBIGUOUS_INVITE', `Tienes varias invitaciones (${list.map((t) => `${t.id} ${t.name}`).join(', ')}). Indica el ID.`);
    return list[0];
  }

  accept(user, ref = null) {
    const team = this._pickInvite(user, ref);
    if (this.teamsOf(user.jid).some((t) => t.mode === team.mode)) throw fail('ALREADY_IN_TEAM', `Ya perteneces a un equipo ${team.mode}.`);
    if (team.members.length >= team.size) throw fail('TEAM_FULL', 'Ese equipo ya se completó.');
    this._guard(team, 'cambio de plantilla');
    team.members.push(user.jid);
    team.invites = team.invites.filter((i) => i.jid !== user.jid);
    this.db.touch();
    audit(this.db, { scope: 'equipo', ref: team.id, actor: user.jid, action: 'unirse', detail: 'aceptó invitación', at: this.now() });
    return team;
  }

  reject(user, ref = null) {
    const team = this._pickInvite(user, ref);
    team.invites = team.invites.filter((i) => i.jid !== user.jid);
    this.db.touch();
    audit(this.db, { scope: 'equipo', ref: team.id, actor: user.jid, action: 'rechazar', detail: 'rechazó invitación', at: this.now() });
    return team;
  }

  // ---------- plantilla y cargos ----------

  _requireLeader(team, actor) {
    if (!this.isLeader(team, actor.jid)) throw fail('NOT_LEADER', 'Solo el capitán o el subcapitán pueden hacer eso.');
  }

  _requireCaptain(team, actor, isAdmin = false) {
    if (team.captain !== actor.jid && !isAdmin) throw fail('NOT_CAPTAIN', 'Solo el capitán puede hacer eso.');
  }

  leave(team, user) {
    if (!team.members.includes(user.jid)) throw fail('NOT_MEMBER', 'No perteneces a ese equipo.');
    this._guard(team, 'cambio de plantilla');
    team.members = team.members.filter((m) => m !== user.jid);
    let outcome = 'left';
    if (team.members.length === 0) {
      team.status = 'disuelto';
      team.disbandedAt = this._iso();
      outcome = 'disbanded';
    } else if (team.captain === user.jid) {
      team.captain = team.vice && team.members.includes(team.vice) ? team.vice : team.members[0];
      if (team.vice === team.captain) team.vice = null;
      outcome = 'newCaptain';
    } else if (team.vice === user.jid) {
      team.vice = null;
    }
    this.db.touch();
    audit(this.db, { scope: 'equipo', ref: team.id, actor: user.jid, action: 'salir', detail: outcome, at: this.now() });
    return { team, outcome };
  }

  kick(team, actor, targetJid, { isAdmin = false } = {}) {
    if (!isAdmin) this._requireLeader(team, actor);
    if (!team.members.includes(targetJid)) throw fail('NOT_MEMBER', 'Esa persona no está en el equipo.');
    if (targetJid === actor.jid) throw fail('SELF', 'Para irte usa *.equipo salir*.');
    if (targetJid === team.captain) throw fail('CANNOT_KICK_CAPTAIN', 'No se puede expulsar al capitán.');
    if (targetJid === team.vice && actor.jid !== team.captain && !isAdmin) throw fail('CANNOT_KICK_VICE', 'Solo el capitán puede expulsar al subcapitán.');
    this._guard(team, 'cambio de plantilla');
    team.members = team.members.filter((m) => m !== targetJid);
    if (team.vice === targetJid) team.vice = null;
    this.db.touch();
    audit(this.db, { scope: 'equipo', ref: team.id, actor: actor.jid, action: 'expulsar', detail: targetJid, at: this.now() });
    return team;
  }

  transferCaptain(team, actor, targetJid, { isAdmin = false } = {}) {
    this._requireCaptain(team, actor, isAdmin);
    if (!team.members.includes(targetJid)) throw fail('NOT_MEMBER', 'Esa persona no está en el equipo.');
    if (targetJid === team.captain) throw fail('ALREADY', 'Esa persona ya es la capitana o el capitán.');
    const old = team.captain;
    team.captain = targetJid;
    if (team.vice === targetJid) team.vice = null;
    this.db.touch();
    audit(this.db, { scope: 'equipo', ref: team.id, actor: actor.jid, action: 'capitan', detail: `${old} → ${targetJid}`, at: this.now() });
    return team;
  }

  /** targetJid = null quita el cargo. */
  setVice(team, actor, targetJid, { isAdmin = false } = {}) {
    this._requireCaptain(team, actor, isAdmin);
    if (targetJid === null) {
      if (!team.vice) throw fail('NO_VICE', 'El equipo no tiene subcapitán.');
      team.vice = null;
    } else {
      if (!team.members.includes(targetJid)) throw fail('NOT_MEMBER', 'Esa persona no está en el equipo.');
      if (targetJid === team.captain) throw fail('ALREADY', 'El capitán no puede ser subcapitán.');
      team.vice = targetJid;
    }
    this.db.touch();
    audit(this.db, { scope: 'equipo', ref: team.id, actor: actor.jid, action: 'subcapitan', detail: targetJid || 'quitado', at: this.now() });
    return team;
  }

  rename(team, actor, name, { isAdmin = false } = {}) {
    this._requireCaptain(team, actor, isAdmin);
    const clean = cleanTeamName(name);
    if (this.active().some((t) => t.id !== team.id && normName(t.name) === normName(clean))) throw fail('NAME_TAKEN', `Ya existe un equipo llamado "${clean}".`);
    const old = team.name;
    team.name = clean;
    this.db.touch();
    audit(this.db, { scope: 'equipo', ref: team.id, actor: actor.jid, action: 'renombrar', detail: `${old} → ${clean}`, at: this.now() });
    return team;
  }

  disband(team, actor, { isAdmin = false } = {}) {
    this._requireCaptain(team, actor, isAdmin);
    this._guard(team, 'disolución');
    team.status = 'disuelto';
    team.disbandedAt = this._iso();
    team.invites = [];
    this.db.touch();
    audit(this.db, { scope: 'equipo', ref: team.id, actor: actor.jid, action: 'disolver', detail: team.name, at: this.now() });
    return team;
  }

  // ---------- estadísticas ----------

  /** Aplica un resultado finalizado a las estadísticas del equipo (lo llama MatchService una sola vez por partida). */
  applyResult(teamId, matchId, outcome) {
    const t = this.db.get(COLLECTION, teamId);
    if (!t) return;
    t.stats.played += 1;
    if (outcome === 'win') {
      t.stats.wins += 1;
      t.stats.streak = t.stats.streak > 0 ? t.stats.streak + 1 : 1;
    } else if (outcome === 'loss') {
      t.stats.losses += 1;
      t.stats.streak = t.stats.streak < 0 ? t.stats.streak - 1 : -1;
    } else {
      t.stats.draws += 1;
      t.stats.streak = 0;
    }
    t.stats.bestStreak = Math.max(t.stats.bestStreak, t.stats.streak);
    t.recent.push(matchId);
    if (t.recent.length > 50) t.recent.splice(0, t.recent.length - 50);
    this.db.touch();
  }

  winRate(team) {
    return team.stats.played ? Math.round((team.stats.wins / team.stats.played) * 100) : 0;
  }

  /** Ranking simple por victorias → % de victorias → menos partidas. Solo equipos con partidas jugadas. */
  ranking({ mode = null, limit = 10 } = {}) {
    return this.active()
      .filter((t) => t.stats.played > 0 && (!mode || t.mode === mode))
      .sort((a, b) => b.stats.wins - a.stats.wins || this.winRate(b) - this.winRate(a) || a.stats.played - b.stats.played || a.id.localeCompare(b.id))
      .slice(0, limit);
  }

  displayName(jidValue) {
    const u = this.users.find([jidValue]);
    return u ? u.name : jid.mentionTag(jidValue);
  }
}

module.exports = { TeamService, MODES, parseMode, cleanTeamName };
