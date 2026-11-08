'use strict';

// Ejecuta todos los tests de tests/*.test.js con el runner nativo de Node.
// Lista los archivos explícitamente para funcionar igual en Node 20, 22 y en Termux.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const dir = path.resolve(__dirname, '..', 'tests');
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.test.js'))
  .sort()
  .map((f) => path.join(dir, f));

if (files.length === 0) {
  console.error('No se encontraron tests.');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status === null ? 1 : result.status);
