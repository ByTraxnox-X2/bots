'use strict';

/**
 * Límite de uso en memoria (se reinicia al reiniciar el bot, lo cual es aceptable para anti-spam).
 *  - Ventana fija: máximo N usos por ventana para una clave (usuario, grupo, API, play…).
 *  - Cooldown: tiempo mínimo entre usos de una misma clave (usuario+comando).
 * Las entradas caducadas se limpian solas para que la memoria no crezca sin límite.
 */
class RateLimiter {
  constructor({ now = () => Date.now(), maxEntries = 5000 } = {}) {
    this.now = now;
    this.maxEntries = maxEntries;
    this.windows = new Map(); // key -> { start, count, notified }
    this.cooldowns = new Map(); // key -> expiresAt
  }

  /**
   * Registra un uso. Devuelve { allowed, retryAfterMs, notify }.
   * `notify` es true solo la primera vez que se rechaza dentro de una ventana, para
   * avisar al usuario una vez y no responder a cada intento de spam.
   */
  hit(key, max, windowMs) {
    const t = this.now();
    this._maybeCleanup(t);
    let w = this.windows.get(key);
    if (!w || t - w.start >= windowMs) {
      w = { start: t, count: 0, notified: false, windowMs };
      this.windows.set(key, w);
    }
    if (w.count < max) {
      w.count += 1;
      return { allowed: true, retryAfterMs: 0, notify: false };
    }
    const notify = !w.notified;
    w.notified = true;
    return { allowed: false, retryAfterMs: Math.max(0, w.start + windowMs - t), notify };
  }

  /** Milisegundos que faltan para que termine el cooldown de la clave (0 si está libre). */
  cooldownLeft(key) {
    const exp = this.cooldowns.get(key);
    if (!exp) return 0;
    const left = exp - this.now();
    if (left <= 0) {
      this.cooldowns.delete(key);
      return 0;
    }
    return left;
  }

  setCooldown(key, ms) {
    if (ms > 0) this.cooldowns.set(key, this.now() + ms);
  }

  clear(key) {
    this.windows.delete(key);
    this.cooldowns.delete(key);
  }

  _maybeCleanup(t) {
    if (this.windows.size + this.cooldowns.size < this.maxEntries) return;
    this.cleanup(t);
  }

  cleanup(t = this.now()) {
    for (const [k, w] of this.windows) if (t - w.start >= w.windowMs) this.windows.delete(k);
    for (const [k, exp] of this.cooldowns) if (exp <= t) this.cooldowns.delete(k);
  }

  get size() {
    return this.windows.size + this.cooldowns.size;
  }
}

/**
 * Política de límites para comandos: por usuario, por grupo y cooldown por comando.
 * El OWNER está exento. Primero se comprueba todo y el cooldown solo se aplica si el comando se ejecutará.
 */
class CommandLimiter {
  constructor({ config, limiter = new RateLimiter() }) {
    this.cfg = config.rateLimit;
    this.limiter = limiter;
  }

  /**
   * @returns { allowed, reason: 'user'|'group'|'cooldown'|null, retryAfterSec, notify }
   */
  check({ userKey, groupKey = null, command, cooldownSec = 0, isOwner = false }) {
    if (isOwner) return { allowed: true, reason: null, retryAfterSec: 0, notify: false };

    const u = this.limiter.hit(`u:${userKey}`, this.cfg.userMax, this.cfg.userWindowSec * 1000);
    if (!u.allowed) return this._deny('user', u);

    if (groupKey) {
      const g = this.limiter.hit(`g:${groupKey}`, this.cfg.groupMax, this.cfg.groupWindowSec * 1000);
      if (!g.allowed) return this._deny('group', g);
    }

    const cdKey = `c:${userKey}:${command}`;
    const left = this.limiter.cooldownLeft(cdKey);
    if (left > 0) {
      // Para el cooldown avisamos solo la primera vez dentro del periodo.
      const flagKey = `cn:${userKey}:${command}`;
      const alreadyNotified = this.limiter.cooldownLeft(flagKey) > 0;
      if (!alreadyNotified) this.limiter.setCooldown(flagKey, left);
      return { allowed: false, reason: 'cooldown', retryAfterSec: Math.ceil(left / 1000), notify: !alreadyNotified };
    }
    this.limiter.setCooldown(cdKey, cooldownSec * 1000);
    return { allowed: true, reason: null, retryAfterSec: 0, notify: false };
  }

  _deny(reason, r) {
    return { allowed: false, reason, retryAfterSec: Math.ceil(r.retryAfterMs / 1000), notify: r.notify };
  }
}

module.exports = { RateLimiter, CommandLimiter };
