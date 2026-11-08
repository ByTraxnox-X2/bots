'use strict';

// npm run verify-commands [-- --write]
// Comprueba que cada comando registrado está completo y consistente, y que COMMANDS.md coincide con el registro.
//  - definición válida (nombre, alias sin conflictos, descripción, uso, ejemplo, categoría, permiso, cooldown, handler)
//  - el uso y el ejemplo empiezan por el nombre del comando
//  - el comando aparece en al menos un archivo de tests (no hay comandos sin probar)
//  - COMMANDS.md está al día (con --write lo regenera)
const fs = require('node:fs');
const path = require('node:path');
const { CommandRegistry } = require('../src/commands/registry');
const { registerPlugins } = require('../src/plugins');
const { generateCommandsDoc } = require('../src/commands/docs');
const { buildConfig } = require('../src/config');

const ROOT = path.resolve(__dirname, '..');
const DOC = path.join(ROOT, 'COMMANDS.md');

function verify({ write = false } = {}) {
  const problems = [];
  const registry = new CommandRegistry();
  try {
    registerPlugins(registry);
  } catch (err) {
    return { problems: [err.message], registry };
  }

  const testsDir = path.join(ROOT, 'tests');
  const testsText = fs
    .readdirSync(testsDir)
    .filter((f) => f.endsWith('.test.js'))
    .map((f) => fs.readFileSync(path.join(testsDir, f), 'utf8'))
    .join('\n');

  for (const d of registry.list()) {
    const firstWord = (text) => String(text).trim().split(/\s+/)[0].toLowerCase();
    if (firstWord(d.usage) !== d.name) problems.push(`"${d.name}": el uso debe empezar por el nombre del comando ("${d.usage}").`);
    if (!registry.has(firstWord(d.example))) problems.push(`"${d.name}": el ejemplo no empieza por un comando o alias válido ("${d.example}").`);
    if (!testsText.includes(`.${d.name}`) && !testsText.includes(`'${d.name}'`)) {
      problems.push(`"${d.name}": ningún test lo ejecuta.`);
    }
    for (const sub of d.subcommands) {
      if (typeof sub.handler !== 'function') problems.push(`"${d.name} ${sub.name}": subcomando sin handler.`);
      if (!testsText.includes(`.${d.name} ${sub.name}`)) problems.push(`"${d.name} ${sub.name}": ningún test lo ejecuta.`);
    }
    if (d.description.length > 220) problems.push(`"${d.name}": la descripción es demasiado larga (${d.description.length} > 220).`);
  }

  const prefix = buildConfig({}, ROOT).prefix;
  const doc = generateCommandsDoc(registry, prefix) + '\n';
  if (write) {
    fs.writeFileSync(DOC, doc);
  } else if (!fs.existsSync(DOC)) {
    problems.push('Falta COMMANDS.md. Genera con: npm run docs:commands');
  } else if (fs.readFileSync(DOC, 'utf8') !== doc) {
    problems.push('COMMANDS.md está desactualizado. Regenera con: npm run docs:commands');
  }
  return { problems, registry };
}

module.exports = { verify };

if (require.main === module) {
  const write = process.argv.includes('--write');
  const { problems, registry } = verify({ write });
  if (problems.length) {
    for (const p of problems) console.error(`✗ ${p}`);
    process.exit(1);
  }
  console.log(`verify-commands: OK (${registry.size} comandos${write ? ', COMMANDS.md regenerado' : ''})`);
}
