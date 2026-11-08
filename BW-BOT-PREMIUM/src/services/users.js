'use strict';

const jid = require('../whatsapp/jid');
const { EVENTS } = require('../events/bus');

const COLLECTION = 'users';
const MAX_LEVEL = 100;
const MAX_COINS = 1e12;
const NAME_MAX = 25;

/** Error con código estable y mensaje en español apto para mostrar al usuario. */
class UserError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'UserError';
    this.code = code;
  }
}

/** XP total necesaria para alcanzar un nivel: 0, 100, 300, 600, 1000… (50·L·(L−1)). */
function xpForLevel(level) {
  const l = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)));
  return 50 * l * (l - 1);
}

/** Nivel (1..100) que corresponde a una cantidad de XP. */
function levelForXp(xp) {
  const safe = Math.max(0, Math.floor(Number(xp) || 0));
  let level = Math.floor(0.5 + Math.sqrt(0.25 + safe / 50));
  level = Math.max(1, Math.min(MAX_LEVEL, level));
  while (level < MAX_LEVEL && xpForLevel(level + 1) <= safe) level++;
  while (level > 1 && xpForLevel(level) > safe) level--;
  return level;
}

/** Progreso dentro del nivel actual. */
function progress(user) {
  const level = levelForXp(user.xp);
  const base = xpForLevel(level);
  const atMax = level >= MAX_LEVEL;
  const next = atMax ? base : xpForLevel(level + 1);
  const into = user.xp - base;
  const needed = atMax ? 0 : next - base;
  return {
    level,
    xp: user.xp,
    into,
    needed,
    remaining: atMax ? 0 : next - user.xp,
    percent: atMax ? 100 : Math.min(100, Math.floor((into / needed) * 100)),
    atMax,
  };
}

/** Limpia un nombre para mostrarlo: sin caracteres de control ni marcas de formato de WhatsApp. */
function sanitizeName(raw, fallback = 'Jugador') {
  const clean = String(raw ?? '')
    .replace(/[\u0000-\u001F\u007F​-‏‪-‮⁦-⁩]/g, '')
    .replace(/[*_~`@]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX)
    .trim();
  return clean || fallback;
}

/** Elige la identidad principal: prefiere un JID de teléfono sobre un @lid. */
function pickPrimary(identities) {
  const list = (identities || []).map((j) => jid.normalize(j)).filter(Boolean);
  return list.find((j) => jid.isUser(j)) || list[0] || '';
}

/**
 * Servicio de usuarios: registro, perfil, actividad, XP/niveles, monedas y vinculación de Free Fire.
 * Todo persiste en la colección `users` de la base de datos.
 */
class UserService {
  constructor({ db, config, bus = null, logger = null, now = () => Date.now() }) {
    this.db = db;
    this.cfg = config.economy;
    this.bus = bus;
    this.logger = logger;
    this.now = now;
  }

  // ---------- consulta ----------

  /** Busca a la persona por cualquiera de sus identificadores. */
  find(identities) {
    const keys = [];
    for (const j of identities || []) {
      const key = jid.normalize(j);
      if (!key) continue;
      keys.push(key);
      const u = this.db.get(COLLECTION, key);
      if (u) return this._learnAliases(u, keys, identities);
    }
    // Una persona puede escribir unas veces con su número y otras con su @lid: se busca en los alias guardados.
    if (keys.some((k) => jid.isLid(k))) {
      const u = this.db.values(COLLECTION).find((x) => Array.isArray(x.aliases) && x.aliases.some((a) => keys.includes(a)));
      if (u) return this._learnAliases(u, keys, identities);
    }
    return null;
  }

  /** Guarda como alias los identificadores con los que se vio a la persona (máx. 6). */
  _learnAliases(user, keys, identities) {
    const all = (identities || []).map((j) => jid.normalize(j)).filter(Boolean);
    if (!Array.isArray(user.aliases)) user.aliases = [];
    let changed = false;
    for (const k of all.length ? all : keys) {
      if (k !== user.jid && !user.aliases.includes(k) && user.aliases.length < 6) {
        user.aliases.push(k);
        changed = true;
      }
    }
    if (changed) this.db.touch();
    return user;
  }

  isRegistered(identities) {
    return this.find(identities) !== null;
  }

  require(identities) {
    const u = this.find(identities);
    if (!u) throw new UserError('NOT_REGISTERED', 'Aún no estás registrado. Usa *.registro* para crear tu perfil.');
    return u;
  }

  findByFfUid(uid) {
    return this.db.values(COLLECTION).find((u) => u.ffUid === String(uid)) || null;
  }

  count() {
    return Object.keys(this.db.col(COLLECTION)).length;
  }

  // ---------- registro ----------

  /**
   * Crea el perfil. Si ya existe NO se modifica ni se vuelven a dar recompensas.
   * @returns { created, user, reward: { coins, xp } | null }
   */
  register({ identities, name }) {
    const existing = this.find(identities);
    if (existing) return { created: false, user: existing, reward: null };

    const key = pickPrimary(identities);
    if (!key) throw new UserError('INVALID_JID', 'No pude identificar tu cuenta de WhatsApp.');
    const number = jid.toNumber(key);
    const iso = new Date(this.now()).toISOString();

    const user = {
      jid: key,
      aliases: (identities || []).map((j) => jid.normalize(j)).filter((j) => j && j !== key).slice(0, 6),
      number,
      name: sanitizeName(name, number ? `Jugador${number.slice(-4)}` : 'Jugador'),
      registeredAt: iso,
      lastActivity: iso,
      lastXpAt: 0,
      ffUid: null,
      ffRegion: null,
      ffVerified: false,
      ffLinkedAt: null,
      ffSnapshot: null,
      level: 1,
      xp: 0,
      coins: 0,
      stats: { wins: 0, losses: 0, matches: 0 },
      activity: { messages: 0, commands: 0 },
      elo: 1000,
      achievements: [],
      titles: [],
      inventory: {},
      missions: {},
      streaks: { daily: 0, lastDaily: null },
      preferences: {},
      rewards: { registerClaimed: false },
    };
    this.db.set(COLLECTION, key, user);

    // La recompensa de registro se entrega una sola vez (marca persistente).
    let reward = null;
    if (!user.rewards.registerClaimed) {
      user.rewards.registerClaimed = true;
      const coins = this.cfg.registerBonusCoins;
      const xp = this.cfg.registerBonusXp;
      if (coins > 0) this._applyCoins(user, coins, 'registro');
      if (xp > 0) this._applyXp(user, xp, 'registro');
      reward = { coins, xp };
    }
    this.db.touch();
    this.bus?.emit(EVENTS.userRegistered, { jid: key, name: user.name });
    return { created: true, user, reward };
  }

  // ---------- actividad ----------

  /**
   * Registra actividad (mensaje o comando): actualiza la última actividad, los contadores y,
   * como mucho una vez por ACTIVITY_XP_COOLDOWN segundos, concede XP de actividad (anti-farm).
   * Solo cuenta para usuarios registrados. Devuelve { xpGained, levelUps }.
   */
  recordActivity(identities, { kind = 'message', name = null } = {}) {
    const user = this.find(identities);
    if (!user) return { xpGained: 0, levelUps: [] };
    const t = this.now();
    user.lastActivity = new Date(t).toISOString();
    if (kind === 'command') user.activity.commands += 1;
    else user.activity.messages += 1;
    if (name && user.name.startsWith('Jugador')) user.name = sanitizeName(name, user.name);

    let result = { xpGained: 0, levelUps: [] };
    if (this.cfg.activityXp > 0 && t - user.lastXpAt >= this.cfg.activityXpCooldownSec * 1000) {
      user.lastXpAt = t;
      const r = this._applyXp(user, this.cfg.activityXp, 'actividad');
      result = { xpGained: this.cfg.activityXp, levelUps: r.levelUps };
    }
    this.db.touch();
    return result;
  }

  // ---------- XP y niveles ----------

  /** Suma XP a un usuario registrado. @returns { xp, level, levelUps: [{ level, coins }] } */
  addXp(identities, amount, reason = 'xp') {
    this._checkAmount(amount);
    const user = this.require(identities);
    const r = this._applyXp(user, amount, reason);
    this.db.touch();
    return r;
  }

  _applyXp(user, amount, reason) {
    const before = levelForXp(user.xp);
    user.xp += amount;
    const after = levelForXp(user.xp);
    user.level = after;
    const levelUps = [];
    for (let l = before + 1; l <= after; l++) {
      const coins = 25 * l; // premio por subir de nivel
      this._applyCoins(user, coins, `nivel ${l}`);
      levelUps.push({ level: l, coins });
      this.bus?.emit(EVENTS.levelUp, { jid: user.jid, level: l, coins });
    }
    this.logger?.debug(`XP +${amount} (${reason}) a ${user.jid}: nivel ${user.level}`);
    return { xp: user.xp, level: user.level, levelUps };
  }

  progress(identities) {
    return progress(this.require(identities));
  }

  // ---------- monedas (virtuales) ----------

  _checkAmount(amount) {
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new UserError('INVALID_AMOUNT', 'La cantidad debe ser un número entero mayor que 0.');
    }
  }

  _applyCoins(user, delta, reason) {
    user.coins = Math.min(MAX_COINS, user.coins + delta);
    this.db.push('history', { type: 'coins', jid: user.jid, delta, reason, balance: user.coins, at: this.now() });
  }

  addCoins(identities, amount, reason = 'ajuste') {
    this._checkAmount(amount);
    const user = this.require(identities);
    this._applyCoins(user, amount, reason);
    this.db.touch();
    return user.coins;
  }

  spendCoins(identities, amount, reason = 'compra') {
    this._checkAmount(amount);
    const user = this.require(identities);
    if (user.coins < amount) {
      throw new UserError('INSUFFICIENT_FUNDS', `No tienes suficientes monedas (tienes ${user.coins}, necesitas ${amount}).`);
    }
    this._applyCoins(user, -amount, reason);
    this.db.touch();
    return user.coins;
  }

  // ---------- Free Fire ----------

  /**
   * Vincula un UID. `verified` indica si una API real lo confirmó; `snapshot` guarda solo datos validados.
   * Un mismo UID no puede estar vinculado a dos personas.
   */
  linkFreeFire(identities, { uid, region = null, verified = false, snapshot = null }) {
    const user = this.require(identities);
    const owner = this.findByFfUid(uid);
    if (owner && owner.jid !== user.jid) {
      throw new UserError('UID_TAKEN', 'Ese UID ya está vinculado a otro usuario.');
    }
    user.ffUid = String(uid);
    user.ffRegion = region || null;
    user.ffVerified = Boolean(verified);
    user.ffLinkedAt = new Date(this.now()).toISOString();
    user.ffSnapshot = snapshot || null;
    this.db.touch();
    this.bus?.emit(EVENTS.userLinked, { jid: user.jid, uid: user.ffUid });
    return user;
  }

  unlinkFreeFire(identities) {
    const user = this.require(identities);
    if (!user.ffUid) throw new UserError('NOT_LINKED', 'No tienes ningún UID de Free Fire vinculado.');
    const uid = user.ffUid;
    user.ffUid = null;
    user.ffRegion = null;
    user.ffVerified = false;
    user.ffLinkedAt = null;
    user.ffSnapshot = null;
    this.db.touch();
    this.bus?.emit(EVENTS.userUnlinked, { jid: user.jid, uid });
    return uid;
  }

  updateSnapshot(identities, { region, snapshot }) {
    const user = this.require(identities);
    if (!user.ffUid) throw new UserError('NOT_LINKED', 'No tienes ningún UID de Free Fire vinculado.');
    user.ffSnapshot = snapshot;
    user.ffVerified = true;
    if (region && !user.ffRegion) user.ffRegion = region;
    this.db.touch();
    return user;
  }
}

module.exports = { UserService, UserError, xpForLevel, levelForXp, progress, sanitizeName, pickPrimary, MAX_LEVEL };
