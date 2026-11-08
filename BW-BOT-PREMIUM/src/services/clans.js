'use strict';

const jid = require('../whatsapp/jid');
const { EVENTS } = require('../events/bus');
const { UserError } = require('./users');

const CLANS = 'clans';
const GROUPS = 'groups';
const HISTORY_MAX = 100;
const RULES_MAX = 600;
const DESC_MAX = 200;

/** Configuración por clan/grupo. El honor y la hora son por clan: no existe configuración global. */
const DEFAULT_CONFIG = Object.freeze({
  gdcEnabled: true,
  gdcTime: '19:00', // hora de inicio de la GDC (zona horaria del bot)
  reminderMinutes: 10, // aviso antes de empezar (19:00 → 18:50)
  honorEnabled: false,
  honorRequired: 0,
});

const HHMM_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** Claves editables con .setclan: alias en español → { key, parse }. Cada parse devuelve { ok, value } | { ok:false, error }. */
const CONFIG_KEYS = {
  gdc: { key: 'gdcEnabled', label: 'GDC', parse: parseOnOff, show: (v) => (v ? 'activada' : 'desactivada'), help: 'activar | desactivar' },
  hora: { key: 'gdcTime', label: 'Hora de la GDC', parse: parseTime, show: (v) => v, help: 'HH:MM (24 h), por ejemplo 19:00' },
  recordatorio: {
    key: 'reminderMinutes',
    label: 'Recordatorio (minutos antes)',
    parse: (t) => parseInt_(t, 1, 120, 'El recordatorio'),
    show: (v) => `${v} min`,
    help: 'minutos antes de la GDC, de 1 a 120',
  },
  honor: { key: 'honorEnabled', label: 'Honor', parse: parseOnOff, show: (v) => (v ? 'activado' : 'desactivado'), help: 'activar | desactivar' },
  honorrequerido: {
    key: 'honorRequired',
    label: 'Honor requerido',
    parse: (t) => parseInt_(t, 0, 100000, 'El honor requerido'),
    show: (v) => String(v),
    help: 'número de 0 a 100000',
  },
};

function parseOnOff(text) {
  const t = String(text || '').trim().toLowerCase();
  if (['activar', 'activado', 'on', 'si', 'sí', 'true', '1'].includes(t)) return { ok: true, value: true };
  if (['desactivar', 'desactivado', 'off', 'no', 'false', '0'].includes(t)) return { ok: true, value: false };
  return { ok: false, error: 'Indica activar o desactivar.' };
}

function parseTime(text) {
  const m = HHMM_RE.exec(String(text || '').trim());
  if (!m) return { ok: false, error: 'La hora debe tener el formato HH:MM de 24 horas (por ejemplo 19:00).' };
  return { ok: true, value: `${m[1].padStart(2, '0')}:${m[2]}` };
}

function parseInt_(text, min, max, label) {
  const raw = String(text || '').trim();
  if (!/^\d+$/.test(raw) || Number(raw) < min || Number(raw) > max) return { ok: false, error: `${label} debe ser un número entero entre ${min} y ${max}.` };
  return { ok: true, value: Number(raw) };
}

/** Texto libre escrito por administradores: sin caracteres de control/bidi, sin saltos excesivos, con tope. */
function sanitizeFreeText(raw, max) {
  return String(raw ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max)
    .trim();
}

function snapshotOf(res) {
  return { fetchedAt: new Date(res.fetchedAt || Date.now()).toISOString(), provider: res.provider, data: { ...res.data } };
}

/**
 * Clanes verificados y su relación con grupos de WhatsApp.
 *  - clans[idClan]  → registro del clan (datos de la API, configuración, reglas, historial)
 *  - groups[jid]    → { jid, clanId }  (un grupo = un clan; un clan activo = un grupo)
 * Al desverificar, el clan se conserva marcado como inactivo (configuración, reglas e historial) y se restaura si
 * se vuelve a verificar. Todos los datos de la API se guardan tal como llegaron (solo campos reales).
 */
class ClanService {
  constructor({ db, bus = null, logger = null, now = () => Date.now() }) {
    this.db = db;
    this.bus = bus;
    this.logger = logger;
    this.now = now;
  }

  _iso() {
    return new Date(this.now()).toISOString();
  }

  // ---------- consulta ----------

  /** Clan activo asociado al grupo (o null). */
  clanOfGroup(groupJid) {
    const g = this.db.get(GROUPS, jid.normalize(groupJid));
    const clan = g?.clanId ? this.db.get(CLANS, g.clanId) : null;
    return clan && clan.active ? clan : null;
  }

  get(clanId) {
    return this.db.get(CLANS, String(clanId)) || null;
  }

  /** Clanes activos (verificados en algún grupo). */
  active() {
    return this.db.values(CLANS).filter((c) => c.active);
  }

  // ---------- verificación ----------

  /** Comprueba conflictos ANTES de consultar la API: así no se gasta una consulta en algo que no se puede hacer. */
  checkVerifiable(groupJid, clanId) {
    const g = this.db.get(GROUPS, jid.normalize(groupJid));
    const current = g?.clanId ? this.db.get(CLANS, g.clanId) : null;
    if (current && current.active && current.id !== String(clanId)) {
      throw new UserError('GROUP_HAS_CLAN', `Este grupo ya tiene verificado el clan *${current.name || current.id}* (ID ${current.id}). Usa *.desverificarclan* primero.`);
    }
    const existing = this.get(clanId);
    if (existing && existing.active && existing.groupJid !== jid.normalize(groupJid)) {
      throw new UserError('CLAN_TAKEN', 'Ese clan ya está verificado en otro grupo. Un clan solo puede estar verificado en un grupo.');
    }
  }

  /**
   * Verifica el clan en el grupo con el resultado real de la API (`res` de ClanApiService.lookup con ok=true).
   * @returns { clan, created, restored }
   */
  verify({ groupJid, clanId, by, res }) {
    if (!res || !res.ok) throw new Error('verify() requiere un resultado correcto de la API.');
    const group = jid.normalize(groupJid);
    clanId = String(clanId);
    this.checkVerifiable(group, clanId);

    let clan = this.get(clanId);
    const created = !clan;
    const restored = Boolean(clan && !clan.active);
    if (!clan) {
      clan = {
        id: clanId,
        active: true,
        groupJid: group,
        name: null,
        region: null,
        verifiedAt: this._iso(),
        verifiedBy: jid.normalize(by),
        snapshot: null,
        config: { ...DEFAULT_CONFIG },
        rules: '',
        description: '',
        history: [],
      };
      this.db.set(CLANS, clanId, clan);
    }
    clan.active = true;
    clan.groupJid = group;
    clan.verifiedAt = this._iso();
    clan.verifiedBy = jid.normalize(by);
    clan.config = { ...DEFAULT_CONFIG, ...(clan.config || {}) };
    this._applySnapshot(clan, res);

    const g = this.db.ensure(GROUPS, group, () => ({ jid: group, clanId: null, createdAt: this._iso() }));
    g.clanId = clanId;
    this._log(clan, by, created ? 'verificado' : restored ? 'verificado de nuevo' : 'actualizado', clan.name || clanId);
    this.db.touch();
    this.bus?.emit(EVENTS.clanVerified, { groupJid: group, clanId, name: clan.name });
    return { clan, created, restored };
  }

  unverify(groupJid, by) {
    const group = jid.normalize(groupJid);
    const clan = this.clanOfGroup(group);
    if (!clan) throw new UserError('NO_CLAN', '⚠️ Este grupo no tiene un clan verificado.');
    clan.active = false;
    clan.groupJid = null;
    const g = this.db.get(GROUPS, group);
    if (g) g.clanId = null;
    this._log(clan, by, 'desverificado', clan.name || clan.id);
    this.db.touch();
    this.bus?.emit(EVENTS.clanUnverified, { groupJid: group, clanId: clan.id, name: clan.name });
    return clan;
  }

  _applySnapshot(clan, res) {
    clan.snapshot = snapshotOf(res);
    if (res.data.name) clan.name = res.data.name;
    if (res.region || res.data.region) clan.region = res.region || res.data.region;
  }

  /** Guarda una consulta nueva de la API en un clan ya verificado. */
  updateSnapshot(clanId, res) {
    const clan = this.get(clanId);
    if (!clan || !clan.active || !res?.ok) return null;
    this._applySnapshot(clan, res);
    this.db.touch();
    return clan;
  }

  snapshotAgeMs(clan) {
    const t = clan?.snapshot?.fetchedAt ? Date.parse(clan.snapshot.fetchedAt) : NaN;
    return Number.isFinite(t) ? this.now() - t : Infinity;
  }

  // ---------- configuración y textos ----------

  /** @returns { label, key, value, shown } */
  setConfig(clan, alias, rawValue, by) {
    const def = CONFIG_KEYS[String(alias || '').toLowerCase()];
    if (!def) {
      throw new UserError('BAD_KEY', `Opción desconocida. Opciones: ${Object.keys(CONFIG_KEYS).join(', ')}.`);
    }
    const parsed = def.parse(rawValue);
    if (!parsed.ok) throw new UserError('BAD_VALUE', `${parsed.error}\n${def.label}: ${def.help}`);
    const before = clan.config[def.key];
    clan.config[def.key] = parsed.value;
    this._log(clan, by, 'config', `${def.label}: ${def.show(before)} → ${def.show(parsed.value)}`);
    this.db.touch();
    this.bus?.emit(EVENTS.clanConfigChanged, { groupJid: clan.groupJid, clanId: clan.id, key: def.key });
    return { label: def.label, key: def.key, value: parsed.value, shown: def.show(parsed.value) };
  }

  configLines(clan) {
    const lines = [];
    for (const [alias, def] of Object.entries(CONFIG_KEYS)) {
      const v = clan.config[def.key];
      lines.push({ alias, label: def.label, shown: def.show(v) });
    }
    return lines;
  }

  setRules(clan, text, by) {
    const clean = sanitizeFreeText(text, RULES_MAX);
    clan.rules = clean;
    this._log(clan, by, 'reglas', clean ? `actualizadas (${clean.length} caracteres)` : 'borradas');
    this.db.touch();
    return clean;
  }

  setDescription(clan, text, by) {
    const clean = sanitizeFreeText(text, DESC_MAX);
    clan.description = clean;
    this._log(clan, by, 'descripción', clean ? 'actualizada' : 'borrada');
    this.db.touch();
    return clean;
  }

  // ---------- historial y ranking ----------

  _log(clan, by, action, detail = '') {
    const entry = { at: this._iso(), by: by ? jid.normalize(by) : null, action, detail: String(detail).slice(0, 200) };
    clan.history.push(entry);
    while (clan.history.length > HISTORY_MAX) clan.history.shift();
    this.db.push('logs', { type: 'clan', clanId: clan.id, ...entry });
  }

  history(clan, limit = 10) {
    return clan.history.slice(-limit).reverse();
  }

  /**
   * Ranking de clanes verificados en este bot. Solo entran los que tienen nivel real en la última consulta de la API,
   * ordenados por nivel y, a igualdad, por puntuación y por miembros (si la API los entregó).
   */
  ranking() {
    return this.active()
      .filter((c) => typeof c.snapshot?.data?.level === 'number')
      .map((c) => ({ id: c.id, name: c.name || c.id, level: c.snapshot.data.level, score: c.snapshot.data.score, memberCount: c.snapshot.data.memberCount }))
      .sort((a, b) => b.level - a.level || (b.score ?? -1) - (a.score ?? -1) || (b.memberCount ?? -1) - (a.memberCount ?? -1) || a.name.localeCompare(b.name));
  }
}

module.exports = { ClanService, CONFIG_KEYS, DEFAULT_CONFIG, sanitizeFreeText, HISTORY_MAX, RULES_MAX, DESC_MAX };
