'use strict';

// npm run format: normaliza espacios finales, tabuladores y salto de línea final en los .js.
const fs = require('node:fs');
const path = require('node:path');
const { listJsFiles, ROOT } = require('./files');

let changed = 0;
for (const file of listJsFiles()) {
  const original = fs.readFileSync(file, 'utf8');
  let text = original
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, '').replace(/^\t+/, (m) => '  '.repeat(m.length)))
    .join('\n');
  text = text.replace(/\n+$/, '') + '\n';
  if (text !== original) {
    fs.writeFileSync(file, text);
    changed++;
    console.log(`formateado: ${path.relative(ROOT, file)}`);
  }
}
console.log(`format: ${changed} archivo(s) modificado(s).`);
