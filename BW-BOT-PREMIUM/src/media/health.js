'use strict';

const BREAKER_FAILS = 3;
const BREAKER_OPEN_MS = 60 * 1000;
const RATE_LIMIT_OPEN_MS = 30 * 1000;

/** Estado de salud de cada proveedor: interruptor automático (circuit breaker) tras fallos seguidos. */
class ProviderHealth {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.state = new Map();
  }

  _s(name) {
    let s = this.state.get(name);
    if (!s) {
      s = { fails: 0, openUntil: 0, lastError: null, lastOkAt: 0, lastLatencyMs: null, ok: 0, failed: 0 };
      this.state.set(name, s);
    }
    return s;
  }

  isOpen(name) {
    return this._s(name).openUntil > this.now();
  }

  ok(name, latencyMs) {
    const s = this._s(name);
    s.fails = 0;
    s.openUntil = 0;
    s.lastError = null;
    s.lastOkAt = this.now();
    s.lastLatencyMs = latencyMs;
    s.ok++;
  }

  /** Un "no encontrado" es una respuesta válida del proveedor y no cuenta como fallo del servicio. */
  fail(name, kind, detail = '') {
    const s = this._s(name);
    s.lastError = `${kind}${detail ? `: ${detail}` : ''}`.slice(0, 160);
    s.failed++;
    if (kind === 'NOT_FOUND' || kind === 'UNAVAILABLE') return;
    s.fails++;
    if (kind === 'RATE_LIMITED') s.openUntil = this.now() + RATE_LIMIT_OPEN_MS;
    else if (s.fails >= BREAKER_FAILS) s.openUntil = this.now() + BREAKER_OPEN_MS;
  }

  snapshot(name) {
    const s = this._s(name);
    const t = this.now();
    let state = 'sin_probar';
    if (s.openUntil > t) state = 'caida';
    else if (s.lastOkAt) state = s.fails > 0 ? 'degradada' : 'ok';
    else if (s.lastError) state = s.fails > 0 ? 'degradada' : 'sin_probar';
    return { state, lastLatencyMs: s.lastLatencyMs, lastError: s.lastError, lastOkAt: s.lastOkAt || null, ok: s.ok, failed: s.failed };
  }
}

module.exports = { ProviderHealth, BREAKER_FAILS, BREAKER_OPEN_MS };
