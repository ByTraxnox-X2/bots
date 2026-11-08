'use strict';

const NEGATIVE_TTL_SEC = 60;

/**
 * ProviderCache: cache con TTL en memoria. Solo guarda éxitos y "no encontrado" definitivo (TTL corto).
 * Los fallos de API (caída, timeout, 429, auth, respuesta inválida) NUNCA se cachean, para no ocultar un
 * error permanente ni prolongar uno temporal.
 */
class ProviderCache {
  constructor({ ttlSec, max = 500, now = () => Date.now() }) {
    this.ttlSec = ttlSec;
    this.max = max;
    this.now = now;
    this.map = new Map();
  }

  get(key) {
    const e = this.map.get(key);
    if (!e) return null;
    if (this.now() - e.at >= e.ttlMs) {
      this.map.delete(key);
      return null;
    }
    return e.value;
  }

  put(key, result) {
    let ttlMs = 0;
    if (result.ok) ttlMs = this.ttlSec * 1000;
    else if (result.kind === 'NOT_FOUND' && !result.partial) ttlMs = Math.min(NEGATIVE_TTL_SEC, this.ttlSec) * 1000;
    if (ttlMs <= 0) return false;
    this.map.set(key, { at: this.now(), ttlMs, value: result });
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
    return true;
  }

  clear() { this.map.clear(); }
  get size() { return this.map.size; }
}

module.exports = { ProviderCache, NEGATIVE_TTL_SEC };
