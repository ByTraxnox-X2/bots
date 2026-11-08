'use strict';

// npm run backup: crea un backup de la base de datos sin iniciar el bot.
const { loadConfig } = require('../src/config');
const { Database } = require('../src/database');
const fs = require('node:fs');

const config = loadConfig();
if (!fs.existsSync(config.paths.database)) {
  console.error(`No existe la base de datos en ${config.paths.database}`);
  process.exit(1);
}

const db = new Database({
  file: config.paths.database,
  backupDir: config.paths.backups,
  backupKeep: config.db.backupKeep,
  saveDebounceMs: 0,
}).load();
const name = db.backup('manual');
db.close();
console.log(`Backup creado: ${name}`);
