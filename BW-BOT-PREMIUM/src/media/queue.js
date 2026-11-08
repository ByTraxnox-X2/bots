'use strict';

const { MediaError } = require('./provider');

/** Cola de trabajos con concurrencia limitada, tope de espera y un máximo de trabajos por usuario. */
class MediaQueue {
  constructor({ maxConcurrent = 2, maxQueue = 10, maxPerUser = 1 } = {}) {
    this.maxConcurrent = maxConcurrent;
    this.maxQueue = maxQueue;
    this.maxPerUser = maxPerUser;
    this.running = 0;
    this.waiting = [];
    this.perUser = new Map();
    this.done = 0;
    this.failed = 0;
  }

  stats() {
    return { running: this.running, waiting: this.waiting.length, done: this.done, failed: this.failed };
  }

  /** Ejecuta fn() cuando haya hueco. Rechaza con QUEUE_FULL o USER_BUSY si no es posible. */
  run(fn, { userKey = null } = {}) {
    if (userKey && (this.perUser.get(userKey) || 0) >= this.maxPerUser) return Promise.reject(new MediaError('USER_BUSY', 'ya tienes una descarga en curso'));
    if (this.running >= this.maxConcurrent && this.waiting.length >= this.maxQueue) return Promise.reject(new MediaError('QUEUE_FULL', 'la cola de descargas está llena'));
    if (userKey) this.perUser.set(userKey, (this.perUser.get(userKey) || 0) + 1);
    return new Promise((resolve, reject) => {
      const job = {
        start: () => {
          this.running++;
          Promise.resolve()
            .then(fn)
            .then((v) => { this.done++; resolve(v); }, (e) => { this.failed++; reject(e); })
            .finally(() => {
              this.running--;
              if (userKey) {
                const n = (this.perUser.get(userKey) || 1) - 1;
                if (n <= 0) this.perUser.delete(userKey);
                else this.perUser.set(userKey, n);
              }
              this._next();
            });
        },
      };
      if (this.running < this.maxConcurrent) job.start();
      else this.waiting.push(job);
    });
  }

  position() {
    return this.waiting.length;
  }

  _next() {
    while (this.running < this.maxConcurrent && this.waiting.length) this.waiting.shift().start();
  }
}

module.exports = { MediaQueue };
