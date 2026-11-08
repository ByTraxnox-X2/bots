'use strict';

const jid = require('../whatsapp/jid');
const { nextId, audit, fail } = require('./common');
const { EVENTS } = require('../events/bus');
const { plain } = require('../utils/text');

const META_TTL_MS = 60 * 1000;
const WARNS_MAX_PER_USER = 20;
const MUTE_MAX_MIN = 7 * 24 * 60;
const MUTE_DEFAULT_MIN = 30;
const NOTICE_GAP_MS = 30 * 1000;
const TRACK_MAX = 4000;
const WELCOME_MAX = 300;
const LINK_RE = /(https?:\/\/|www\.)\S+|chat\.whatsapp\.com\/\S+|wa\.me\/\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|me|gg|xyz|info|ly|co|app|dev|tv|link|ec|es|ar|mx|cl|pe|us|top|site|online|club)\b(?:\/\S*)?/i;

const DEFAULT_WELCOME = '👋 ¡Bienvenido/a {usuario} a *{grupo}*! Ya somos {miembros}.';
const DEFAULT_GOODBYE = '👋 {usuario} salió de *{grupo}*.';

const defaults = () => ({
  antilinks: false,
  antispam: false,
  antiflood: false,
  floodMax: 6,
  floodWindowSec: 10,
  spamRepeat: 3,
  spamWindowSec: 30,
  maxWarns: 3,
  warnAction: 'nada', // 'nada' (solo avisa) | 'kick' (expulsa si el bot es admin)
  welcome: { enabled: false, text: '' },
  goodbye: { enabled: false, text: '' },
  warns: {},
  mutes: {},
});

const idOf = (p) => (typeof p === 'string' ? p : p?.id || p?.jid || p?.phoneNumber || '');

/**
 * Moderación y configuración de grupos. TODA acción sobre el grupo comprueba permisos reales:
 *  - quién es admin sale de los metadatos reales del grupo (nunca se supone);
 *  - borrar mensajes o expulsar solo se intenta si el bot es administrador; si no, se devuelve un error claro.
 */
class GroupService {
  constructor({ db, wa, bus = null, users, config, logger = null, now = () => Date.now() }) {
    this.db = db;
    this.wa = wa;
    this.bus = bus;
    this.users = users;
    this.config = config;
    this.logger = logger;
    this.now = now;
    this.metaCache = new Map();
    this.flood = new Map();
    this.spam = new Map();
    this.notices = new Map();
    this.recentMembers = new Map();
    this.warnedNoAdmin = new Map();
  }

  _iso() {
    return new Date(this.now()).toISOString();
  }

  // ---------- configuración persistente ----------

  /** Configuración del grupo (la crea con valores por defecto si no existía). */
  mod(group) {
    const key = jid.normalize(group);
    const g = this.db.ensure('groups', key, () => ({ jid: key, clanId: null, createdAt: this._iso() }));
    if (!g.mod) g.mod = defaults();
    else for (const [k, v] of Object.entries(defaults())) if (g.mod[k] === undefined) g.mod[k] = v;
    return g.mod;
  }

  /** Igual que mod() pero sin crear nada (para el camino caliente de cada mensaje). */
  peek(group) {
    return this.db.get('groups', jid.normalize(group))?.mod || null;
  }

  log(group, actor, action, detail = '') {
    audit(this.db, { scope: 'moderacion', ref: jid.normalize(group), actor, action, detail, at: this.now() });
  }

  modLogs(group, limit = 15) {
    const key = jid.normalize(group);
    return this.db.col('logs').filter((l) => l.scope === 'moderacion' && l.ref === key).slice(-limit).reverse();
  }

  // ---------- metadatos reales del grupo ----------

  async meta(group, { fresh = false } = {}) {
    const key = jid.normalize(group);
    const hit = this.metaCache.get(key);
    if (!fresh && hit && this.now() - hit.at < META_TTL_MS) return hit.meta;
    const meta = await this.wa.groupMetadata(key);
    this.metaCache.set(key, { at: this.now(), meta });
    while (this.metaCache.size > 200) this.metaCache.delete(this.metaCache.keys().next().value);
    return meta;
  }

  invalidate(group) {
    this.metaCache.delete(jid.normalize(group));
  }

  invalidateAll() {
    this.metaCache.clear();
  }

  _ids(p) {
    return [p?.id, p?.lid, p?.phoneNumber, p?.jid].map((j) => jid.normalize(j)).filter(Boolean);
  }

  _participant(meta, jidValue) {
    const target = jid.normalize(jidValue);
    return (meta?.participants || []).find((p) => this._ids(p).includes(target)) || null;
  }

  async isAdmin(group, jidValue) {
    try {
      return Boolean(this._participant(await this.meta(group), jidValue)?.admin);
    } catch (err) {
      this.logger?.warn?.('No se pudo consultar el grupo para verificar admins', err);
      return false;
    }
  }

  _selfIds() {
    return [this.wa?.selfJid, this.wa?.selfLid].map((j) => jid.normalize(j)).filter(Boolean);
  }

  isSelf(jidValue) {
    const n = jid.normalize(jidValue);
    const number = this.wa?.selfNumber;
    return this._selfIds().includes(n) || Boolean(number && jid.toNumber(n) === number);
  }

  /** ¿El bot es administrador de este grupo? Solo true si los metadatos reales lo confirman. */
  async botIsAdmin(group) {
    try {
      const meta = await this.meta(group);
      const selfIds = this._selfIds();
      return (meta?.participants || []).some((p) => p?.admin && (this._ids(p).some((i) => selfIds.includes(i)) || (this.wa?.selfNumber && this._ids(p).some((i) => jid.toNumber(i) === this.wa.selfNumber))));
    } catch (err) {
      this.logger?.warn?.('No se pudo verificar si el bot es administrador', err);
      return false;
    }
  }

  async requireBotAdmin(group, what) {
    if (!(await this.botIsAdmin(group))) {
      throw fail('BOT_NOT_ADMIN', `🚫 No puedo ${what}: el bot no es administrador de este grupo (o no pude comprobarlo). Hazme admin y vuelve a intentarlo.`);
    }
  }

  // ---------- advertencias ----------

  warnsOf(group, jidValue) {
    return [...(this.peek(group)?.warns?.[jid.normalize(jidValue)] || [])];
  }

  addWarn(group, jidValue, { by = null, reason = '' } = {}) {
    const m = this.mod(group);
    const key = jid.normalize(jidValue);
    const list = (m.warns[key] ||= []);
    const warn = { id: nextId(this.db, 'warn', 'W'), at: this._iso(), by: by ? jid.normalize(by) : null, reason: String(reason || 'sin motivo').slice(0, 120) };
    list.push(warn);
    if (list.length > WARNS_MAX_PER_USER) list.splice(0, list.length - WARNS_MAX_PER_USER);
    this.db.touch();
    this.log(group, by, 'warn', `${key} (${list.length}/${m.maxWarns}): ${warn.reason}`);
    return { warn, count: list.length, max: m.maxWarns, reached: list.length >= m.maxWarns };
  }

  /** Quita la última advertencia (o una concreta por id). Devuelve las que quedan. */
  removeWarn(group, jidValue, { by = null, id = null } = {}) {
    const m = this.mod(group);
    const key = jid.normalize(jidValue);
    const list = m.warns[key] || [];
    if (!list.length) throw fail('NO_WARNS', 'Esa persona no tiene advertencias en este grupo.');
    const i = id ? list.findIndex((w) => w.id === id) : list.length - 1;
    if (i < 0) throw fail('NO_WARN', `No encontré la advertencia ${plain(id)}.`);
    const [removed] = list.splice(i, 1);
    if (!list.length) delete m.warns[key];
    this.db.touch();
    this.log(group, by, 'unwarn', `${key}: ${removed.id}`);
    return { removed, left: list.length };
  }

  warnList(group) {
    const m = this.peek(group);
    return Object.entries(m?.warns || {}).map(([j, list]) => ({ jid: j, count: list.length, last: list[list.length - 1] })).sort((a, b) => b.count - a.count || a.jid.localeCompare(b.jid));
  }

  /** Aplica la consecuencia al llegar al máximo de advertencias. Devuelve { kicked, error }. */
  async applyWarnLimit(group, jidValue, by = null) {
    const m = this.mod(group);
    if (m.warnAction !== 'kick') return { kicked: false, error: null };
    if (!(await this.botIsAdmin(group))) return { kicked: false, error: 'El bot no es administrador del grupo, no puede expulsar.' };
    try {
      await this.wa.removeParticipants(jid.normalize(group), [jid.normalize(jidValue)]);
      delete m.warns[jid.normalize(jidValue)];
      this.db.touch();
      this.invalidate(group);
      this.log(group, by, 'expulsar-por-warns', jid.normalize(jidValue));
      return { kicked: true, error: null };
    } catch (err) {
      this.logger?.warn?.('No se pudo expulsar tras las advertencias', err);
      return { kicked: false, error: 'WhatsApp rechazó la expulsión.' };
    }
  }

  // ---------- silencios ----------

  mute(group, jidValue, { minutes = MUTE_DEFAULT_MIN, by = null, reason = '' } = {}) {
    const mins = Math.floor(Number(minutes));
    if (!Number.isFinite(mins) || mins < 1 || mins > MUTE_MAX_MIN) throw fail('BAD_MINUTES', `Los minutos deben estar entre 1 y ${MUTE_MAX_MIN} (7 días).`);
    const m = this.mod(group);
    const key = jid.normalize(jidValue);
    m.mutes[key] = { until: this.now() + mins * 60000, by: by ? jid.normalize(by) : null, reason: String(reason || '').slice(0, 120), at: this._iso() };
    this.db.touch();
    this.log(group, by, 'mute', `${key} ${mins} min${reason ? `: ${reason}` : ''}`);
    return m.mutes[key];
  }

  unmute(group, jidValue, { by = null } = {}) {
    const m = this.mod(group);
    const key = jid.normalize(jidValue);
    if (!m.mutes[key] || m.mutes[key].until <= this.now()) {
      delete m.mutes[key];
      throw fail('NOT_MUTED', 'Esa persona no está silenciada.');
    }
    delete m.mutes[key];
    this.db.touch();
    this.log(group, by, 'unmute', key);
  }

  muteOf(group, identities) {
    const m = this.peek(group);
    if (!m) return null;
    for (const id of identities) {
      const key = jid.normalize(id);
      const rec = m.mutes[key];
      if (!rec) continue;
      if (rec.until <= this.now()) {
        delete m.mutes[key];
        this.db.touch();
        continue;
      }
      return { jid: key, ...rec };
    }
    return null;
  }

  activeMutes(group) {
    const m = this.peek(group);
    if (!m) return [];
    return Object.entries(m.mutes).filter(([, r]) => r.until > this.now()).map(([j, r]) => ({ jid: j, ...r }));
  }

  // ---------- ajustes ----------

  setFeature(group, key, enabled, by = null) {
    if (!['antilinks', 'antispam', 'antiflood'].includes(key)) throw fail('BAD_FEATURE', 'Función desconocida.');
    const m = this.mod(group);
    m[key] = Boolean(enabled);
    this.db.touch();
    this.log(group, by, key, enabled ? 'activar' : 'desactivar');
    return m;
  }

  setNumber(group, key, value, { min, max, by = null }) {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n) || n < min || n > max) throw fail('BAD_NUMBER', `El valor debe ser un número entero entre ${min} y ${max}.`);
    const m = this.mod(group);
    m[key] = n;
    this.db.touch();
    this.log(group, by, `config-${key}`, String(n));
    return n;
  }

  setWarnAction(group, action, by = null) {
    if (!['nada', 'kick'].includes(action)) throw fail('BAD_ACTION', 'La acción debe ser *nada* (solo avisar) o *kick* (expulsar).');
    this.mod(group).warnAction = action;
    this.db.touch();
    this.log(group, by, 'config-warnaccion', action);
  }

  setMessage(group, kind, { enabled, text } = {}, by = null) {
    const m = this.mod(group);
    const slot = m[kind];
    if (text !== undefined) {
      const clean = String(text).replace(/\s+/g, ' ').trim();
      if (clean.length < 3 || clean.length > WELCOME_MAX) throw fail('BAD_TEXT', `El texto debe tener entre 3 y ${WELCOME_MAX} caracteres.`);
      slot.text = clean;
    }
    if (enabled !== undefined) slot.enabled = Boolean(enabled);
    this.db.touch();
    this.log(group, by, kind, `${slot.enabled ? 'on' : 'off'}${text !== undefined ? ' texto' : ''}`);
    return slot;
  }

  render(kind, group, joined, meta) {
    const slot = this.mod(group)[kind];
    const base = slot.text || (kind === 'welcome' ? DEFAULT_WELCOME : DEFAULT_GOODBYE);
    return base
      .replace(/\{usuario\}/g, joined.map((j) => jid.mentionTag(j)).join(' '))
      .replace(/\{grupo\}/g, plain(meta?.subject || 'este grupo'))
      .replace(/\{miembros\}/g, String((meta?.participants || []).length || '—'));
  }

  // ---------- bienvenidas y despedidas (evento group-participants) ----------

  async onParticipants(update) {
    const group = jid.normalize(update?.id);
    if (!group || !jid.isGroup(group)) return;
    this.invalidate(group);
    const action = update.action;
    if (!['add', 'remove'].includes(action)) return;
    const m = this.peek(group);
    const kind = action === 'add' ? 'welcome' : 'goodbye';
    // WhatsApp puede entregar el mismo evento dos veces: se ignora la repetición reciente.
    const joined = [];
    for (const p of update.participants || []) {
      const id = jid.normalize(idOf(p));
      if (!id || this.isSelf(id)) continue;
      const k = `${group}|${action}|${id}`;
      const last = this.recentMembers.get(k);
      if (last && this.now() - last < 30000) continue;
      this.recentMembers.set(k, this.now());
      joined.push(id);
    }
    while (this.recentMembers.size > 500) this.recentMembers.delete(this.recentMembers.keys().next().value);
    if (!joined.length) return;
    this.bus?.emit(action === 'add' ? EVENTS.userJoined : EVENTS.userLeft, { groupJid: group, jids: joined });
    if (!m || !m[kind].enabled) return;
    try {
      const meta = await this.meta(group, { fresh: true }).catch(() => null);
      await this.wa.sendText(group, this.render(kind, group, joined, meta), { mentions: joined });
    } catch (err) {
      this.logger?.warn?.(`No se pudo enviar la ${kind === 'welcome' ? 'bienvenida' : 'despedida'}`, err);
    }
  }

  // ---------- vigilancia automática (se llama con cada mensaje de grupo) ----------

  static hasLink(text) {
    return LINK_RE.test(String(text || ''));
  }

  _track(map, key, value) {
    map.set(key, value);
    while (map.size > TRACK_MAX) map.delete(map.keys().next().value);
  }

  async _delete(incoming) {
    try {
      await this.wa.deleteMessage(incoming.chatJid, incoming.key);
      return true;
    } catch (err) {
      const last = this.warnedNoAdmin.get(incoming.chatJid) || 0;
      if (this.now() - last > 10 * 60000) {
        this.warnedNoAdmin.set(incoming.chatJid, this.now());
        this.logger?.warn?.('No se pudo borrar un mensaje (¿el bot dejó de ser administrador?)', err);
      }
      return false;
    }
  }

  async _notify(incoming, who, text) {
    const k = `${incoming.chatJid}|${who}`;
    if (this.now() - (this.notices.get(k) || 0) < NOTICE_GAP_MS) return;
    this._track(this.notices, k, this.now());
    try {
      await this.wa.sendText(incoming.chatJid, text, { mentions: [who] });
    } catch (err) {
      this.logger?.warn?.('No se pudo enviar el aviso de moderación', err);
    }
  }

  async _autoWarn(incoming, who, reason) {
    const w = this.addWarn(incoming.chatJid, who, { by: null, reason });
    let extra = '';
    if (w.reached) {
      const r = await this.applyWarnLimit(incoming.chatJid, who, null);
      extra = r.kicked ? ' Llegó al máximo y fue expulsado.' : r.error ? ` Llegó al máximo (${r.error})` : ' Llegó al máximo de advertencias.';
    }
    await this._notify(incoming, who, `⚠️ ${jid.mentionTag(who)} advertencia ${w.count}/${w.max}: ${reason}.${extra}`);
  }

  /**
   * Revisa un mensaje de grupo. Devuelve { stop: true } si fue borrado por moderación (y no debe procesarse más).
   * Los administradores del grupo, los MOD+ y el OWNER nunca se filtran (lo decide el dispatcher con isAdmin()).
   */
  async inspect(incoming, { isAdmin }) {
    const m = this.peek(incoming.chatJid);
    if (!m) return { stop: false };
    const hasMutes = Object.keys(m.mutes).length > 0;
    if (!hasMutes && !m.antilinks && !m.antispam && !m.antiflood) return { stop: false };
    if (await isAdmin()) return { stop: false };
    const who = incoming.primarySender;

    if (hasMutes && this.muteOf(incoming.chatJid, incoming.senderJids)) {
      await this._delete(incoming);
      return { stop: true, reason: 'mute' };
    }
    if (m.antilinks && GroupService.hasLink(incoming.text)) {
      if (await this._delete(incoming)) {
        await this._autoWarn(incoming, who, 'enlaces no permitidos');
        return { stop: true, reason: 'antilinks' };
      }
      return { stop: false };
    }
    if (m.antiflood) {
      const k = `${incoming.chatJid}|${who}`;
      const t = this.now();
      const st = this.flood.get(k) || { times: [], flagged: false };
      st.times = st.times.filter((x) => t - x < m.floodWindowSec * 1000);
      st.times.push(t);
      if (st.times.length <= m.floodMax) st.flagged = false;
      this._track(this.flood, k, st);
      if (st.times.length > m.floodMax) {
        if (await this._delete(incoming)) {
          if (!st.flagged) {
            st.flagged = true;
            await this._autoWarn(incoming, who, 'flood de mensajes');
          }
          return { stop: true, reason: 'antiflood' };
        }
      }
    }
    if (m.antispam) {
      const k = `${incoming.chatJid}|${who}`;
      const t = this.now();
      const text = incoming.text.trim().toLowerCase().replace(/\s+/g, ' ');
      let st = this.spam.get(k);
      if (!st || st.text !== text || t - st.start > m.spamWindowSec * 1000) st = { text, count: 0, start: t, flagged: false };
      st.count++;
      this._track(this.spam, k, st);
      if (st.count >= m.spamRepeat) {
        if (await this._delete(incoming)) {
          if (!st.flagged) {
            st.flagged = true;
            await this._autoWarn(incoming, who, 'mensajes repetidos (spam)');
          }
          return { stop: true, reason: 'antispam' };
        }
      }
    }
    return { stop: false };
  }
}

module.exports = { GroupService, LINK_RE, MUTE_DEFAULT_MIN, MUTE_MAX_MIN };
