'use strict';

const { EventEmitter } = require('node:events');
const time = require('../utils/time');

const MAX_TIMEOUT_MS = 2 ** 31 - 1;
const COLLECTION = 'scheduled';

/**
 * Estados de un trabajo:
 *  pending      esperando su hora
 *  sending      reclamado: el handler está corriendo (o el proceso murió durante él)
 *  done         ejecutado correctamente (no se vuelve a ejecutar nunca)
 *  failed       agotó sus reintentos
 *  missed       venció hace más que la ventana de gracia y no se ejecutó
 *  interrupted  el proceso murió mientras estaba en "sending": se desconoce si se entregó,
 *               por eso NO se reenvía (preferimos perder un aviso a duplicarlo)
 *  cancelled    cancelado a propósito
 */
const FINAL_STATES = new Set(['done', 'failed', 'missed', 'interrupted', 'cancelled']);

/**
 * Scheduler persistente. Todo el estado vive en la base de datos (colección `scheduled`),
 * así que tras un reinicio se reconstruyen los temporizadores a partir de lo guardado.
 *
 * Garantías:
 *  - Un id nunca se ejecuta dos veces: el estado "sending" se guarda en disco ANTES de llamar al handler.
 *  - schedule() con un id existente no crea duplicados.
 *  - Los trabajos vencidos durante una caída se ejecutan solo si están dentro de `graceMs`.
 *  - Si el handler lanza un error (no se entregó nada), se reintenta con espera creciente.
 */
class Scheduler extends EventEmitter {
  constructor({
    db,
    logger,
    now = () => Date.now(),
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    defaultGraceMs = 5 * 60 * 1000,
    maxAttempts = 3,
    retryBaseMs = 15000,
    keepFinishedMs = 7 * 24 * 3600 * 1000,
  }) {
    super();
    this.db = db;
    this.logger = logger;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.defaultGraceMs = defaultGraceMs;
    this.maxAttempts = maxAttempts;
    this.retryBaseMs = retryBaseMs;
    this.keepFinishedMs = keepFinishedMs;
    this.handlers = new Map();
    this._timer = null;
    this._running = false;
    this._started = false;
    this._stopped = false;
    this._inFlight = new Set();
  }

  /** Registra el handler de un tipo de trabajo: async (job) => void. Debe lanzar si no pudo entregar. */
  register(type, handler) {
    if (typeof handler !== 'function') throw new Error('El handler debe ser una función.');
    this.handlers.set(type, handler);
    return this;
  }

  _jobs() {
    return this.db.col(COLLECTION);
  }

  get(id) {
    return this._jobs()[id] || null;
  }

  list(filter = () => true) {
    return Object.values(this._jobs()).filter(filter);
  }

  pending() {
    return this.list((j) => j.status === 'pending');
  }

  /**
   * Programa un trabajo de una sola vez.
   * Si el id ya existe NO se duplica: un trabajo pendiente conserva su hora (salvo reschedule: true)
   * y uno ya terminado se devuelve tal cual.
   */
  schedule({ id, type, runAt, payload = {}, graceMs, recurrence = null, reschedule = false }) {
    if (!id || typeof id !== 'string') throw new Error('Falta el id del trabajo.');
    if (!type) throw new Error('Falta el tipo del trabajo.');
    if (!Number.isFinite(runAt)) throw new Error('runAt debe ser un instante UTC en milisegundos.');

    const existing = this.get(id);
    if (existing && existing.status === 'cancelled') {
      // Un trabajo cancelado a propósito puede volver a programarse con el mismo id (p. ej. desactivar y activar de nuevo).
      Object.assign(existing, { runAt, payload, graceMs: Number.isFinite(graceMs) ? graceMs : this.defaultGraceMs, recurrence, status: 'pending', attempts: 0, firedAt: null, lastError: null });
      this.db.touch();
      this._arm();
      return { job: existing, created: true };
    }
    if (existing) {
      if (existing.status === 'pending' && reschedule && existing.runAt !== runAt) {
        existing.runAt = runAt;
        existing.attempts = 0;
        this.db.touch();
        this._arm();
      }
      return { job: existing, created: false };
    }

    const job = {
      id,
      type,
      runAt,
      payload,
      graceMs: Number.isFinite(graceMs) ? graceMs : this.defaultGraceMs,
      recurrence,
      status: 'pending',
      attempts: 0,
      createdAt: this.now(),
      firedAt: null,
      lastError: null,
    };
    this.db.set(COLLECTION, id, job);
    this._arm();
    return { job, created: true };
  }

  /**
   * Programa un trabajo diario recurrente. El id incluye la fecha y hora locales de la ejecución,
   * p. ej. GDC_<grupo>_2026-10-04_18:50. Al ejecutarse, se programa solo la siguiente ocurrencia.
   */
  scheduleDaily({ baseId, type, hhmm, tz, offsetMinutes = 0, payload = {}, graceMs }) {
    const recurrence = { kind: 'daily', baseId, hhmm, tz, offsetMinutes };
    const next = time.nextDailyOccurrence({ hhmm, tz, afterMs: this.now(), offsetMinutes });
    const id = `${baseId}_${next.localDate}_${next.localTime}`;
    return this.schedule({ id, type, runAt: next.runAt, payload, graceMs, recurrence });
  }

  cancel(id) {
    const job = this.get(id);
    if (!job || FINAL_STATES.has(job.status)) return false;
    job.status = 'cancelled';
    this.db.touch();
    this._arm();
    return true;
  }

  /** Cancela todos los pendientes que cumplan el filtro (p. ej. los de un grupo). */
  cancelWhere(predicate) {
    let n = 0;
    for (const job of this.pending()) {
      if (predicate(job)) {
        job.status = 'cancelled';
        n++;
      }
    }
    if (n) {
      this.db.touch();
      this._arm();
    }
    return n;
  }

  /**
   * Reconstruye los temporizadores tras un arranque. Debe llamarse una vez con la DB ya cargada
   * y los handlers ya registrados.
   */
  async start() {
    if (this._started) return this.recoverySummary;
    this._started = true;
    this._stopped = false;
    const summary = { resumed: 0, runNow: 0, missed: 0, interrupted: 0 };
    const t = this.now();

    for (const job of this.list()) {
      if (job.status === 'sending') {
        job.status = 'interrupted';
        job.lastError = 'El proceso terminó mientras se enviaba; no se reenvía para evitar duplicados.';
        summary.interrupted++;
        this.logger?.warn(`Trabajo ${job.id} interrumpido durante el envío: no se reenviará.`);
        this.emit('interrupted', job);
        this._followRecurrence(job);
        continue;
      }
      if (job.status !== 'pending') continue;
      if (job.runAt > t) {
        summary.resumed++;
      } else if (t - job.runAt <= job.graceMs) {
        summary.runNow++;
      } else {
        job.status = 'missed';
        job.lastError = `Venció ${Math.round((t - job.runAt) / 1000)}s antes de recuperarse (fuera de la ventana de gracia).`;
        summary.missed++;
        this.logger?.warn(`Trabajo ${job.id} perdido durante la caída; no se ejecuta.`);
        this.emit('missed', job);
        this._followRecurrence(job);
      }
    }
    this._prune();
    this.db.touch();
    this.recoverySummary = summary;
    this.logger?.info(
      `Scheduler: ${summary.resumed} reanudados, ${summary.runNow} a ejecutar ahora, ${summary.missed} perdidos, ${summary.interrupted} interrumpidos.`
    );
    await this.runDue();
    this._arm();
    return summary;
  }

  async stop() {
    this._stopped = true;
    this._started = false;
    if (this._timer) {
      this.clearTimer(this._timer);
      this._timer = null;
    }
    // Espera a los handlers en vuelo para no cortar un envío a medias.
    await Promise.allSettled([...this._inFlight]);
  }

  _arm() {
    if (this._stopped) return;
    if (this._timer) {
      this.clearTimer(this._timer);
      this._timer = null;
    }
    let earliest = Infinity;
    for (const job of this.pending()) if (job.runAt < earliest) earliest = job.runAt;
    if (earliest === Infinity) return;
    const delay = Math.min(MAX_TIMEOUT_MS, Math.max(0, earliest - this.now()));
    this._timer = this.setTimer(() => {
      this._timer = null;
      this.runDue().catch((err) => this.logger?.error('Error en el scheduler', err));
    }, delay);
    if (this._timer?.unref) this._timer.unref();
  }

  /** Ejecuta todos los trabajos pendientes cuya hora ya llegó. */
  async runDue() {
    if (this._running) return;
    this._running = true;
    try {
      const t = this.now();
      const due = this.pending()
        .filter((j) => j.runAt <= t)
        .sort((a, b) => a.runAt - b.runAt);
      for (const job of due) {
        if (this._stopped) break;
        await this._execute(job);
      }
    } finally {
      this._running = false;
      this._arm();
    }
  }

  async _execute(job) {
    if (job.status !== 'pending') return;
    const handler = this.handlers.get(job.type);
    if (!handler) {
      this.logger?.error(`No hay handler registrado para el tipo "${job.type}" (trabajo ${job.id}).`);
      job.status = 'failed';
      job.lastError = `Sin handler para ${job.type}`;
      this.db.touch();
      return;
    }

    // Reclamo persistente ANTES de ejecutar: si el proceso muere ahora, no habrá reenvío.
    job.status = 'sending';
    job.attempts += 1;
    this.db.touch();
    this.db.flush();

    const run = (async () => {
      try {
        await handler(job);
        job.status = 'done';
        job.firedAt = this.now();
        job.lastError = null;
        this.emit('done', job);
        this._followRecurrence(job);
      } catch (err) {
        job.lastError = err && err.message ? err.message : String(err);
        if (job.attempts < this.maxAttempts && this.now() - job.runAt < job.graceMs + this.retryBaseMs * 8) {
          job.status = 'pending';
          job.runAt = this.now() + this.retryBaseMs * 2 ** (job.attempts - 1);
          this.logger?.warn(`Trabajo ${job.id} falló (${job.lastError}); reintento ${job.attempts}/${this.maxAttempts}.`);
        } else {
          job.status = 'failed';
          this.logger?.error(`Trabajo ${job.id} falló definitivamente: ${job.lastError}`);
          this.emit('failed', job);
          this._followRecurrence(job);
        }
      } finally {
        this.db.touch();
        this.db.flush();
      }
    })();
    this._inFlight.add(run);
    try {
      await run;
    } finally {
      this._inFlight.delete(run);
    }
  }

  /** Para trabajos recurrentes terminados, programa la siguiente ocurrencia. */
  _followRecurrence(job) {
    const r = job.recurrence;
    if (!r || r.kind !== 'daily') return;
    // Evita que el trabajo siguiente dependa de que este haya terminado a tiempo.
    const afterMs = Math.max(this.now(), job.runAt);
    try {
      const next = time.nextDailyOccurrence({ hhmm: r.hhmm, tz: r.tz, afterMs, offsetMinutes: r.offsetMinutes });
      const id = `${r.baseId}_${next.localDate}_${next.localTime}`;
      this.schedule({
        id,
        type: job.type,
        runAt: next.runAt,
        payload: job.payload,
        graceMs: job.graceMs,
        recurrence: r,
      });
    } catch (err) {
      this.logger?.error(`No se pudo programar la siguiente ocurrencia de ${job.id}`, err);
    }
  }

  /** Elimina trabajos terminados antiguos para que la DB no crezca sin límite. */
  _prune() {
    const limit = this.now() - this.keepFinishedMs;
    const jobs = this._jobs();
    for (const [id, job] of Object.entries(jobs)) {
      if (FINAL_STATES.has(job.status) && (job.firedAt || job.runAt) < limit) delete jobs[id];
    }
  }

  stats() {
    const out = { pending: 0, sending: 0, done: 0, failed: 0, missed: 0, interrupted: 0, cancelled: 0 };
    for (const job of this.list()) out[job.status] = (out[job.status] || 0) + 1;
    return out;
  }
}

module.exports = { Scheduler, FINAL_STATES, MAX_TIMEOUT_MS };
