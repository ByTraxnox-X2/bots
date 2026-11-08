'use strict';

// Fixture de pruebas: ejecuta la app REAL (src/app.js) en un proceso aparte con un Baileys simulado.
// Sirve para verificar arranque, health check, SIGTERM, bloqueo de instancia y recuperación del scheduler.
const fs = require('node:fs');
const { EventEmitter } = require('node:events');
const { buildConfig } = require('../../src/config');
const { Logger } = require('../../src/utils/logger');
const { createApp } = require('../../src/app');

const config = buildConfig(process.env, process.env.DATA_DIR);
const logger = new Logger({ level: 'warn', scope: 'fixture' });

const fakeBaileys = {
  makeWASocket() {
    const sock = {
      ev: new EventEmitter(),
      user: { id: '593991111111:1@s.whatsapp.net' },
      end() {},
    };
    setImmediate(() => sock.ev.emit('connection.update', { connection: 'open' }));
    return sock;
  },
  async useMultiFileAuthState() {
    return { state: { creds: { registered: true } }, saveCreds: async () => {} };
  },
  DisconnectReason: { loggedOut: 401, badSession: 500, restartRequired: 515 },
  async fetchLatestBaileysVersion() { return { version: [2, 3000, 1] }; },
};

const app = createApp({ config, logger, loadBaileys: async () => fakeBaileys });

app.scheduler.register('test.ping', async (job) => {
  fs.appendFileSync(process.env.FIRED_FILE, `${job.id}\n`);
});

app.wa.on('open', () => {
  if (process.env.SCHEDULE_ID && !app.scheduler.get(process.env.SCHEDULE_ID)) {
    app.scheduler.schedule({
      id: process.env.SCHEDULE_ID,
      type: 'test.ping',
      runAt: Date.now() + Number(process.env.SCHEDULE_IN_MS || 0),
    });
  }
  setTimeout(() => process.stdout.write('READY\n'), 100);
});

process.on('SIGTERM', () => app.shutdown('SIGTERM'));
process.on('SIGINT', () => app.shutdown('SIGINT'));

app.start().catch((err) => {
  if (err && err.code === 'ELOCKED') {
    process.stderr.write(`ELOCKED ${err.message}\n`);
    process.exit(2);
  }
  process.stderr.write(`ERROR ${err && err.stack}\n`);
  process.exit(1);
});
