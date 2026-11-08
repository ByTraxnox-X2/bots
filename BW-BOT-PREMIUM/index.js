'use strict';

const { loadConfig, validateConfig } = require('./src/config');
const { Logger } = require('./src/utils/logger');
const { detectEnvironment } = require('./src/utils/env');
const { createApp } = require('./src/app');

async function main() {
  const config = loadConfig();
  const problems = validateConfig(config);
  const logger = new Logger({
    level: config.log.level,
    dir: config.paths.logs,
    toFile: config.log.toFile,
    scope: 'bw-bot',
  });

  if (problems.length) {
    for (const p of problems) logger.error('Configuración inválida:', p);
    process.exit(1);
  }

  const environment = detectEnvironment();
  logger.info(
    `${config.name} v${config.version} iniciando (Node ${process.version}, entorno: ${environment.runtime}, gestor: ${environment.processManager})`
  );

  // Anti-crash: se registran y no se ocultan. Un error aislado no tumba el bot.
  process.on('uncaughtException', (err) => {
    logger.error('uncaughtException', err);
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('unhandledRejection', reason instanceof Error ? reason : new Error(String(reason)));
  });

  const app = createApp({ config, logger, environment });
  // Los plugins registrarán aquí sus handlers (app.scheduler.register(tipo, handler)) antes de start().

  process.on('SIGINT', () => app.shutdown('SIGINT'));
  process.on('SIGTERM', () => app.shutdown('SIGTERM'));
  process.on('exit', () => app.lock.release());

  try {
    await app.start();
  } catch (err) {
    if (err && err.code === 'ELOCKED') {
      logger.error(err.message);
      process.exit(2);
    }
    logger.error('Error al iniciar', err);
    await app.shutdown('error-de-arranque', 1);
  }
}

main().catch((err) => {
  // Último recurso: el logger puede no existir todavía.
  process.stderr.write(`Error al iniciar: ${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
});
