'use strict';

/**
 * Backoff exponencial con jitter para reconexiones.
 * maxAttempts = 0 significa sin límite de intentos (pero el retardo sigue acotado por maxMs).
 */
class Backoff {
  constructor({ baseMs = 2000, maxMs = 120000, maxAttempts = 0, jitter = 0.2, random = Math.random } = {}) {
    this.baseMs = baseMs;
    this.maxMs = maxMs;
    this.maxAttempts = maxAttempts;
    this.jitter = jitter;
    this.random = random;
    this.attempts = 0;
  }

  /** Devuelve el siguiente retardo en ms, o null si se superó el máximo de intentos. */
  next() {
    if (this.maxAttempts > 0 && this.attempts >= this.maxAttempts) return null;
    const exp = Math.min(this.maxMs, this.baseMs * 2 ** this.attempts);
    this.attempts += 1;
    const spread = exp * this.jitter;
    const delay = exp - spread + this.random() * spread * 2;
    return Math.round(Math.min(this.maxMs, Math.max(0, delay)));
  }

  reset() {
    this.attempts = 0;
  }
}

module.exports = { Backoff };
