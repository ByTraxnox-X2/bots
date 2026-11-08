'use strict';

const jid = require('../whatsapp/jid');
const { audit, fail } = require('./common');

const BROADCAST_TTL_MS = 2 * 60 * 1000;
const BROADCAST_MAX = 1000;
const BROADCAST_MIN = 3;

/**
 * Estado y acciones de administración del OWNER: modo mantenimiento y difusión (broadcast) a los grupos
 * donde el bot está REALMENTE presente (se consultan a WhatsApp en el momento; nunca hay IDs inventados).
 */
class AdminService {
  constructor({ db, wa, config, logger = null, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
    this.db = db;
    this.wa = wa;
    this.config = config;
    this.logger = logger;
    this.now = now;
    this.sleep = sleep;
    this.sending = false;
  }

  _settings() {
    return this.db.ensure('settings', 'admin', () => ({ maintenance: { enabled: false, reason: '', since: null, by: null }, broadcast: null, lastBroadcast: null }));
  }

  // ---------- mantenimiento ----------

  maintenance() {
    return this._settings().maintenance;
  }

  setMaintenance(enabled, { by = null, reason = '' } = {}) {
    const s = this._settings();
    if (Boolean(enabled) === s.maintenance.enabled && !reason) throw fail('NO_CHANGE', `El modo mantenimiento ya está ${enabled ? 'activado' : 'desactivado'}.`);
    s.maintenance = enabled ? { enabled: true, reason: String(reason).slice(0, 120), since: new Date(this.now()).toISOString(), by: by ? jid.normalize(by) : null } : { enabled: false, reason: '', since: null, by: null };
    this.db.touch();
    audit(this.db, { scope: 'admin', ref: 'mantenimiento', actor: by, action: enabled ? 'activar' : 'desactivar', detail: reason, at: this.now() });
    return s.maintenance;
  }

  // ---------- grupos reales ----------

  _selfIds() {
    return [this.wa?.selfJid, this.wa?.selfLid].map((j) => jid.normalize(j)).filter(Boolean);
  }

  /** Grupos donde el bot está presente ahora (consulta a WhatsApp). canSend = puede escribir en él. */
  async listGroups() {
    if (typeof this.wa?.listGroups !== 'function') throw fail('NO_WA', 'La conexión de WhatsApp no permite listar grupos.');
    let raw;
    try {
      raw = await this.wa.listGroups();
    } catch (err) {
      this.logger?.warn?.('No se pudieron listar los grupos', err);
      throw fail('WA_UNAVAILABLE', 'No pude consultar los grupos: WhatsApp no está conectado ahora mismo.');
    }
    const selfIds = this._selfIds();
    const number = this.wa?.selfNumber;
    return raw
      .filter((g) => g && jid.isGroup(g.id))
      .map((g) => {
        const me = (g.participants || []).find((p) => [p?.id, p?.lid, p?.phoneNumber, p?.jid].map((j) => jid.normalize(j)).some((i) => i && (selfIds.includes(i) || (number && jid.toNumber(i) === number))));
        const botAdmin = Boolean(me?.admin);
        return { id: g.id, name: g.subject || g.id, size: (g.participants || []).length, announce: Boolean(g.announce), botAdmin, canSend: !g.announce || botAdmin, present: Boolean(me) || selfIds.length === 0 };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  // ---------- broadcast ----------

  pendingBroadcast() {
    const b = this._settings().broadcast;
    if (!b) return null;
    if (b.expiresAt <= this.now()) {
      this._settings().broadcast = null;
      this.db.touch();
      return null;
    }
    return b;
  }

  /** Paso 1: guarda el texto y calcula a cuántos grupos llegaría. No envía nada. */
  async prepareBroadcast(text, by) {
    const clean = String(text || '').replace(/\r/g, '').trim();
    if (clean.length < BROADCAST_MIN || clean.length > BROADCAST_MAX) throw fail('BAD_TEXT', `El anuncio debe tener entre ${BROADCAST_MIN} y ${BROADCAST_MAX} caracteres.`);
    const groups = await this.listGroups();
    const targets = groups.filter((g) => g.canSend);
    if (!targets.length) throw fail('NO_TARGETS', 'No hay grupos donde el bot pueda enviar mensajes ahora mismo.');
    const s = this._settings();
    s.broadcast = { text: clean, by: jid.normalize(by), createdAt: new Date(this.now()).toISOString(), expiresAt: this.now() + BROADCAST_TTL_MS };
    this.db.touch();
    return { text: clean, total: groups.length, targets: targets.length, skipped: groups.length - targets.length };
  }

  cancelBroadcast() {
    const s = this._settings();
    if (!this.pendingBroadcast()) throw fail('NO_PENDING', 'No hay ningún anuncio pendiente de confirmar.');
    s.broadcast = null;
    this.db.touch();
  }

  /** Paso 2: envía el anuncio pendiente (una sola vez) a los grupos donde el bot puede escribir. */
  async confirmBroadcast(by) {
    const pending = this.pendingBroadcast();
    if (!pending) throw fail('NO_PENDING', 'No hay ningún anuncio pendiente (o ya venció). Prepáralo con *broadcast TEXTO*.');
    if (this.sending) throw fail('BUSY', 'Ya hay un anuncio enviándose.');
    this.sending = true;
    const s = this._settings();
    s.broadcast = null; // consumido antes de enviar: confirmar dos veces no duplica el envío
    this.db.touch();
    try {
      const groups = await this.listGroups();
      const result = { sent: 0, failed: [], skipped: [], total: groups.length };
      const header = '📢 *Anuncio del administrador del bot*\n\n';
      let first = true;
      for (const g of groups) {
        if (!g.canSend) {
          result.skipped.push(g.name);
          continue;
        }
        if (!first) await this.sleep(this.config.broadcast?.delayMs ?? 1500);
        first = false;
        try {
          await this.wa.sendText(g.id, header + pending.text);
          result.sent++;
        } catch (err) {
          result.failed.push(g.name);
          this.logger?.warn?.('Broadcast: no se pudo enviar a un grupo', err);
        }
      }
      s.lastBroadcast = { at: new Date(this.now()).toISOString(), by: jid.normalize(by), sent: result.sent, failed: result.failed.length, skipped: result.skipped.length };
      this.db.touch();
      audit(this.db, { scope: 'admin', ref: 'broadcast', actor: by, action: 'enviar', detail: `${result.sent} enviados, ${result.failed.length} fallidos, ${result.skipped.length} omitidos`, at: this.now() });
      return result;
    } finally {
      this.sending = false;
    }
  }
}

module.exports = { AdminService, BROADCAST_MAX };
