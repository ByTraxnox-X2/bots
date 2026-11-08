'use strict';

// npm run check: valida la sintaxis de todos los .js y que los módulos principales se puedan cargar.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { listJsFiles, ROOT } = require('./files');

let failed = 0;
for (const file of listJsFiles()) {
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (r.status !== 0) {
    failed++;
    console.error(`✗ ${path.relative(ROOT, file)}\n${r.stderr}`);
  }
}

// Carga de módulos que no dependen de Baileys.
for (const mod of ['src/config', 'src/utils/logger', 'src/database', 'src/utils/lock', 'src/whatsapp/jid']) {
  try {
    require(path.join(ROOT, mod));
  } catch (err) {
    failed++;
    console.error(`✗ No se pudo cargar ${mod}: ${err.message}`);
  }
}

// Coherencia de los archivos de despliegue (Docker, PM2, Termux, docs) con el código.
try {
  const problems = require('./verify-deploy').verify();
  for (const p of problems) {
    failed++;
    console.error(`✗ [despliegue] ${p}`);
  }
} catch (err) {
  failed++;
  console.error(`✗ No se pudo verificar el despliegue: ${err.message}`);
}

// Comandos: definiciones completas, alias sin conflictos, probados y COMMANDS.md al día.
try {
  const { problems } = require('./verify-commands').verify();
  for (const p of problems) {
    failed++;
    console.error(`✗ [comandos] ${p}`);
  }
} catch (err) {
  failed++;
  console.error(`✗ No se pudo verificar los comandos: ${err.message}`);
}

if (failed) {
  console.error(`\ncheck: ${failed} problema(s).`);
  process.exit(1);
}
console.log(`check: OK (${listJsFiles().length} archivos .js)`);
