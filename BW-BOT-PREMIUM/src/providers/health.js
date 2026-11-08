'use strict';

const BREAKER_FAILS = 3;
const BREAKER_OPEN_MS = 60 * 1000;
const RATE_LIMIT_OPEN_MS = 30 * 1000;
const AUTH_OPEN_MS = 10 * 60 * 1000;

/**
 * ProviderHealth: salud de cada proveedor (contadores, latencia, último error, cooldown).
 * Un proveedor "abierto" está en cooldown: se omite hasta que pasa el tiempo; después se reincluye
 * automáticamente (la siguiente consulta real o un health check actúa de verificación) y un éxito lo deja sano.
 */
class ProviderHealth {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.map = new Map();
  }

  _s(p) {
    let s = this.map.get(p);
    if (!s) {
      s = { fails: 0, openUntil: 0, lastError: null, lastErrorCode: null, lastOkAt: null, lastFailAt: null, lastUsedAt: null, lastLatencyMs: null, errorCount: 0, successCount: 0, limited: false, authError: false, checkedAt: null };
      this.map.set(p, s);
    }
    return s;
  }

  used(p) { this._s(p).lastUsedAt = this.now(); }

  isOpen(p, t = this.now()) { return this._s(p).openUntil > t; }

  ok(p, latencyMs) {
    const s = this._s(p);
    s.fails = 0;
    s.openUntil = 0;
    s.lastError = null;
    s.lastErrorCode = null;
    s.limited = false;
    s.authError = false;
    s.lastOkAt = this.now();
    s.lastLatencyMs = latencyMs ?? s.lastLatencyMs;
    s.successCount += 1;
  }

  /** `kind`: NOT_FOUND/REGION_ERROR cuentan como respuesta válida (la API sí contestó). */
  fail(p, kind, err = null, { retryAfterSec = 0 } = {}) {
    const s = this._s(p);
    const detail = err && err.detail ? `: ${err.detail}` : '';
    s.lastError = `${kind}${detail}`.slice(0, 160);
    s.lastErrorCode = err && err.code ? err.code : kind;
    if (kind === 'NOT_FOUND' || kind === 'REGION_ERROR') {
      s.fails = 0;
      s.lastOkAt = this.now();
      s.successCount += 1;
      return;
    }
    s.fails += 1;
    s.errorCount += 1;
    s.lastFailAt = this.now();
    if (kind === 'RATE_LIMITED') {
      s.limited = true;
      s.openUntil = this.now() + (retryAfterSec > 0 ? Math.min(retryAfterSec, 300) * 1000 : RATE_LIMIT_OPEN_MS);
    } else if (err && err.auth) {
      s.authError = true;
      s.openUntil = this.now() + AUTH_OPEN_MS;
    } else if (s.fails >= BREAKER_FAILS) {
      s.openUntil = this.now() + BREAKER_OPEN_MS;
    }
  }

  snapshot(p) { return { ...this._s(p) }; }
}

module.exports = { ProviderHealth, BREAKER_FAILS, BREAKER_OPEN_MS, RATE_LIMIT_OPEN_MS, AUTH_OPEN_MS };
