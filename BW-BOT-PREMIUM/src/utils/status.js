'use strict';

/**
 * Construye el estado del bot a partir de los componentes reales. No incluye secretos
 * (claves de API, credenciales, rutas de sesión). Lo usan el health check y, más adelante, .botstatus.
 */
function buildStatus({ config, wa, db, scheduler, environment, startedAt, commands = null, now = Date.now }) {
  const mem = process.memoryUsage();
  const mb = (n) => Math.round((n / 1024 / 1024) * 10) / 10;

  let dbCounts = null;
  try {
    dbCounts = db ? db.stats() : null;
  } catch {
    dbCounts = null;
  }

  return {
    name: config.name,
    version: config.version,
    node: process.version,
    environment,
    pid: process.pid,
    uptimeSec: Math.floor((now() - startedAt) / 1000),
    whatsapp: {
      state: wa ? wa.state : 'idle',
      selfNumber: wa && wa.selfNumber ? wa.selfNumber : null,
      connectedSince: wa && wa.connectedAt ? new Date(wa.connectedAt).toISOString() : null,
      reconnectAttempts: wa ? wa.backoff.attempts : 0,
    },
    database: dbCounts
      ? { ok: true, users: dbCounts.users, groups: dbCounts.groups, clans: dbCounts.clans }
      : { ok: false },
    commands,
    scheduler: scheduler ? scheduler.stats() : null,
    memory: { rssMB: mb(mem.rss), heapUsedMB: mb(mem.heapUsed) },
    time: new Date(now()).toISOString(),
  };
}

module.exports = { buildStatus };
