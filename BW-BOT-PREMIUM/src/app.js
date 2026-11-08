'use strict';

const { InstanceLock } = require('./utils/lock');
const { detectEnvironment } = require('./utils/env');
const { buildStatus } = require('./utils/status');
const { HealthServer } = require('./utils/health');
const { Database } = require('./database');
const { Scheduler } = require('./scheduler');
const { WhatsAppConnection } = require('./whatsapp/connection');
const { EventBus } = require('./events/bus');
const { CommandRegistry } = require('./commands/registry');
const { PermissionService } = require('./middleware/permissions');
const { CommandLimiter } = require('./middleware/ratelimit');
const { UserService } = require('./services/users');
const { FreeFireService } = require('./providers/freefire/service');
const { ClanApiService } = require('./providers/clans/service');
const { ClanService } = require('./services/clans');
const { GdcService } = require('./services/gdc');
const { buildExtras } = require('./services/extras');
const { Dispatcher } = require('./handlers/dispatcher');
const { registerPlugins } = require('./plugins');

const SHUTDOWN_FAILSAFE_MS = 15000;

/**
 * Ensambla todos los componentes del bot. Es el mismo código en Termux, VPS, Docker y PM2:
 * lo único que cambia es la configuración (.env).
 *
 * Los componentes se crean aquí (para que los plugins puedan registrar handlers del scheduler
 * antes de arrancar) y se activan en start().
 */
function createApp({ config, logger, loadBaileys, environment = detectEnvironment(), exit = process.exit }) {
  const startedAt = Date.now();

  const lock = new InstanceLock(config.paths.lock);
  const db = new Database({
    file: config.paths.database,
    backupDir: config.paths.backups,
    backupKeep: config.db.backupKeep,
    saveDebounceMs: config.db.saveDebounceMs,
    logger: logger.child('db'),
  });
  const wa = new WhatsAppConnection({ config, logger: logger.child('whatsapp'), loadBaileys });
  const scheduler = new Scheduler({
    db,
    logger: logger.child('scheduler'),
    defaultGraceMs: config.scheduler.graceMs,
  });

  // Servicios y comandos. Todo comando pasa por el registro central y el dispatcher.
  const bus = new EventBus({ logger: logger.child('events') });
  const permissions = new PermissionService({ db, config });
  const users = new UserService({ db, config, bus, logger: logger.child('users') });
  const ff = new FreeFireService({ config, logger: logger.child('freefire') });
  const clanApi = new ClanApiService({ config, logger: logger.child('clanapi') });
  const clans = new ClanService({ db, bus, logger: logger.child('clans') });
  const gdc = new GdcService({ db, config, clans, users, scheduler, wa, bus, logger: logger.child('gdc') }).register();
  const extras = buildExtras({ db, config, bus, logger, users, clans, scheduler, wa, permissions });
  const registry = registerPlugins(new CommandRegistry());
  const limiter = new CommandLimiter({ config });
  const services = { config, db, bus, permissions, users, ff, clanApi, clans, gdc, ...extras, scheduler, wa, registry, startedAt, logger: logger.child('commands') };
  const dispatcher = new Dispatcher({ config, logger: logger.child('dispatcher'), wa, registry, permissions, users, limiter, services });

  services.dispatcher = dispatcher; // para comandos de administración (reload)

  const getStatus = () => buildStatus({ config, wa, db, scheduler, environment, startedAt, commands: registry.size });

  let health = null;
  let backupTimer = null;
  let schedulerStarted = false;
  let shuttingDown = false;

  async function shutdown(signal, code = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Apagando (${signal})...`);
    // Si algo se cuelga no dejamos un proceso zombi: salida forzada tras el plazo.
    const failsafe = setTimeout(() => {
      logger.error('El apagado excedió el tiempo límite; salida forzada.');
      lock.release();
      exit(code || 1);
    }, SHUTDOWN_FAILSAFE_MS);
    try {
      if (backupTimer) clearInterval(backupTimer);
      if (health) await health.stop();
      dispatcher.stop(); // no se aceptan mensajes nuevos
      await dispatcher.drain(); // se termina de responder a los que están en curso
      await scheduler.stop(); // espera a que termine un envío en curso
      await wa.stop();
      db.close(); // vuelca cambios pendientes a disco
    } catch (err) {
      logger.error('Error durante el apagado', err);
    } finally {
      clearTimeout(failsafe);
      lock.release();
      logger.close();
      exit(code);
    }
  }

  async function start() {
    // 1. Protección contra múltiples instancias (lanza ELOCKED si ya hay otra).
    lock.acquire();

    // 2. Base de datos persistente (recupera .bak si hace falta y aplica migraciones).
    db.load();

    // 2b. Deja en el scheduler los avisos de GDC que correspondan a la configuración guardada (sin duplicar).
    try {
      const r = gdc.syncAll();
      logger.info(`GDC: ${r.groups} grupos sincronizados (${r.created} avisos programados, ${r.cancelled} cancelados).`);
    } catch (err) {
      logger.error('No se pudo sincronizar la GDC con el scheduler', err);
    }

    // 2c. Vencimientos de partidas y demás trabajos de las fases 5+ (idempotente).
    for (const [name, svc] of Object.entries(extras)) {
      if (typeof svc.syncAll !== 'function') continue;
      try {
        svc.syncAll();
      } catch (err) {
        logger.error(`No se pudo sincronizar ${name} con el scheduler`, err);
      }
    }

    // 3. Health check opcional.
    if (config.health.port > 0) {
      health = new HealthServer({ getStatus, logger: logger.child('health') });
      try {
        await health.start({ port: config.health.port, host: config.health.host });
      } catch (err) {
        logger.error(`No se pudo iniciar el health check en ${config.health.host}:${config.health.port}`, err);
        health = null;
      }
    }

    // 4. El scheduler se reanuda cuando WhatsApp ya está conectado, para que los avisos
    //    vencidos durante una caída no fallen por no tener conexión todavía.
    wa.on('open', () => {
      if (schedulerStarted) return;
      schedulerStarted = true;
      scheduler.start().catch((err) => logger.error('No se pudo iniciar el scheduler', err));
    });
    wa.on('message', (upsert) => dispatcher.handleUpsert(upsert));
    wa.on('group-participants', (u) => {
      dispatcher.invalidateGroup(u?.id);
      extras.groups.onParticipants(u).catch((err) => logger.error('Error en bienvenida/despedida', err));
    });
    wa.on('fatal', (err) => {
      logger.error('Error fatal de WhatsApp', err);
      shutdown('fatal', 1);
    });

    // 5. Backups automáticos.
    if (config.db.backupEveryMinutes > 0) {
      backupTimer = setInterval(() => {
        try {
          db.backup('auto');
        } catch (err) {
          logger.error('Fallo el backup automático', err);
        }
      }, config.db.backupEveryMinutes * 60 * 1000);
      backupTimer.unref();
    }

    // 6. Conexión a WhatsApp (Pairing Code si no hay sesión).
    try {
      await wa.start();
    } catch (err) {
      logger.error(err.message, err);
      await shutdown('error-de-arranque', 1);
    }
  }

  return { config, logger, db, wa, scheduler, lock, bus, registry, users, permissions, ff, clanApi, clans, gdc, ...extras, dispatcher, services, getStatus, start, shutdown, get health() { return health; } };
}

module.exports = { createApp, SHUTDOWN_FAILSAFE_MS };
