'use strict';

const crypto = require('node:crypto');

const MAX_ACTIONS = 16;
const MAX_STORED = 2000;

/**
 * InteractionService: botones y respuestas numeradas.
 *
 * Un comando puede responder con `actions: [{ label, command }]`. Cada acción es un COMANDO de texto (p. ej. ".gdc lista")
 * que se ejecuta por el mismo despachador que cualquier mensaje del usuario, así que permisos, registro, límites de
 * uso y servicios son exactamente los mismos y se REVALIDAN al pulsar (nada de lógica duplicada ni permisos cacheados).
 *
 *  - Botón nativo: llega como id "bw:<token>:<n>".
 *  - Alternativa de texto: la respuesta incluye una lista numerada y el usuario escribe ".1", ".2"…
 *  - Caducan (ui.ttlSec) y, por defecto, solo las puede usar quien las recibió.
 *  - Viven en memoria: tras un reinicio caducan (se avisa al pulsar un botón viejo).
 */
class InteractionService {
  constructor({ config, now = () => Date.now() }) {
    this.ttlMs = (config.ui?.ttlSec ?? 300) * 1000;
    this.now = now;
    this.byToken = new Map(); // token -> interacción
    this.latest = new Map(); // `${chat}|${user}` -> token (para ".N")
  }

  /** Crea una interacción. Devuelve { token, items:[{ n, label, command, buttonId }] }. */
  create({ chat, user, actions, anyone = false }) {
    const list = (actions || []).filter((a) => a && a.label && a.command).slice(0, MAX_ACTIONS);
    if (!list.length) return null;
    const token = crypto.randomBytes(4).toString('hex');
    const items = list.map((a, i) => ({ n: i + 1, label: String(a.label).slice(0, 40), command: String(a.command), buttonId: `bw:${token}:${i + 1}` }));
    this.byToken.set(token, { token, chat, user, anyone, items, at: this.now() });
    this.latest.set(`${chat}|${user}`, token);
    while (this.byToken.size > MAX_STORED) this.byToken.delete(this.byToken.keys().next().value);
    return { token, items };
  }

  _alive(it) {
    if (!it) return false;
    if (this.now() - it.at > this.ttlMs) { this.byToken.delete(it.token); return false; }
    return true;
  }

  /** Pulsación de un botón: devuelve { ok, command } o { ok:false, reason: 'expired'|'foreign' }. */
  resolveButton({ chat, users, buttonId }) {
    const m = /^bw:([0-9a-f]{8}):(\d{1,2})$/.exec(String(buttonId || ''));
    if (!m) return { ok: false, reason: 'invalid' };
    const it = this.byToken.get(m[1]);
    if (!this._alive(it) || it.chat !== chat) return { ok: false, reason: 'expired' };
    if (!it.anyone && !users.includes(it.user)) return { ok: false, reason: 'foreign' };
    const item = it.items[Number(m[2]) - 1];
    return item ? { ok: true, command: item.command } : { ok: false, reason: 'expired' };
  }

  /** Respuesta numérica ".N" a la última lista que recibió ese usuario en ese chat. */
  resolveNumber({ chat, user, n }) {
    const token = this.latest.get(`${chat}|${user}`);
    const it = token ? this.byToken.get(token) : null;
    if (!this._alive(it)) { this.latest.delete(`${chat}|${user}`); return { ok: false, reason: 'expired' }; }
    const item = it.items[n - 1];
    return item ? { ok: true, command: item.command } : { ok: false, reason: 'range' };
  }

  /** Texto de la alternativa numerada que acompaña a todo mensaje con acciones. */
  static fallbackText(items, prefix = '.') {
    return ['', ...items.map((i) => `*${prefix}${i.n}* ${i.label}`)].join('\n');
  }

  sweep() {
    for (const it of [...this.byToken.values()]) this._alive(it);
    return this.byToken.size;
  }

  stats() { return { active: this.byToken.size }; }
}

module.exports = { InteractionService };
