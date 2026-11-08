'use strict';

// npm run lint: reglas estáticas del proyecto, sin dependencias externas.
const fs = require('node:fs');
const path = require('node:path');
const { listJsFiles, ROOT } = require('./files');

const RULES = [
  { id: 'sin-todo', re: /\b(TODO|FIXME)\b/, msg: 'No se permite TODO/FIXME como sustituto de implementación.' },
  { id: 'sin-coming-soon', re: /coming soon|próximamente/i, msg: 'No se permiten funciones "coming soon".' },
  { id: 'sin-runfeature', re: /\brunFeature\s*\(/, msg: 'No se permite runFeature() genérico.' },
  { id: 'sin-eval', re: /\beval\s*\(|new Function\s*\(/, msg: 'No se permite eval/new Function.' },
  { id: 'sin-exec', re: /(?<![.\w])(exec|execSync)\s*\(|child_process['"]?\)?\.(exec|execSync)\s*\(/, msg: 'No uses exec/execSync: usa spawn/execFile con argumentos separados.' },
  { id: 'sin-espacios-finales', re: /[ \t]+$/m, msg: 'Espacios al final de línea.' },
];

// scripts/lint.js define los patrones, así que se excluye de las reglas de texto.
const SELF = path.join(ROOT, 'scripts', 'lint.js');

let problems = 0;
for (const file of listJsFiles()) {
  if (file === SELF) continue;
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const rule of RULES) {
      if (rule.id === 'sin-espacios-finales') continue;
      if (rule.re.test(line)) {
        problems++;
        console.error(`${path.relative(ROOT, file)}:${i + 1} [${rule.id}] ${rule.msg}`);
      }
    }
    if (/[ \t]+$/.test(line)) {
      problems++;
      console.error(`${path.relative(ROOT, file)}:${i + 1} [sin-espacios-finales] Espacios al final de línea.`);
    }
    if (/\t/.test(line)) {
      problems++;
      console.error(`${path.relative(ROOT, file)}:${i + 1} [sin-tabs] Usa espacios en lugar de tabuladores.`);
    }
  });
  if (!text.endsWith('\n')) {
    problems++;
    console.error(`${path.relative(ROOT, file)} [newline-final] Falta salto de línea al final.`);
  }
  if (!/^'use strict';/m.test(text.split('\n').slice(0, 3).join('\n'))) {
    problems++;
    console.error(`${path.relative(ROOT, file)} [use-strict] Falta 'use strict' al inicio.`);
  }
}

if (problems) {
  console.error(`\nlint: ${problems} problema(s).`);
  process.exit(1);
}
console.log('lint: OK');
