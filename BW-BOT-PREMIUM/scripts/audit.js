'use strict';

// Auditoría estática del proyecto (Fase 12). Sale con código 1 si encuentra problemas.
//   - comandos sin handler o con definición inválida, plugins sin registrar
//   - acciones/botones que apuntan a comandos o subcomandos inexistentes
//   - marcadores de "pendiente"/relleno usados como funcionalidad
//   - nombres/alias duplicados
//   - secretos (claves, tokens) y archivos que no deben viajar (.env, sesión, node_modules, temporales)
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const { CommandRegistry } = require('../src/commands/registry');
const { registerPlugins, PLUGINS } = require('../src/plugins');

const problems = [];
const add = (m) => problems.push(m);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', 'data'].includes(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

// 1. Registro
let registry;
try {
  registry = registerPlugins(new CommandRegistry());
} catch (err) {
  add(`registro: ${err.message}`);
}

if (registry) {
  const seen = new Map();
  for (const d of registry.list()) {
    if (typeof d.handler !== 'function') add(`comando sin handler: ${d.name}`);
    for (const k of [d.name, ...d.aliases]) {
      if (seen.has(k)) add(`nombre/alias duplicado: ${k} (${seen.get(k)} y ${d.name})`);
      seen.set(k, d.name);
    }
    for (const sc of d.subcommands) if (typeof sc.handler !== 'function') add(`subcomando sin handler: ${d.name} ${sc.name}`);
  }
  // Todo directorio de plugin debe estar registrado
  const dirs = fs.readdirSync(path.join(ROOT, 'src', 'plugins'), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  const registered = new Set(PLUGINS.map((p) => p.name));
  for (const dname of dirs) {
    const mod = require(path.join(ROOT, 'src', 'plugins', dname));
    if (mod && typeof mod.build === 'function' && !PLUGINS.includes(mod)) add(`plugin no registrado: src/plugins/${dname}`);
  }
  void registered;

  // 2. Acciones estáticas: command: `${...prefix}nombre [sub]`
  const re = /command:\s*`\$\{[\w.]*prefix\}([a-z0-9]+)(?:\s+([a-z0-9]+))?/g;
  for (const file of walk(path.join(ROOT, 'src')).filter((f) => f.endsWith('.js'))) {
    const text = fs.readFileSync(file, 'utf8');
    let m;
    while ((m = re.exec(text))) {
      const def = registry.get(m[1]);
      const rel = path.relative(ROOT, file);
      if (!def) { add(`acción apunta a un comando inexistente: ${m[1]} (${rel})`); continue; }
      if (m[2] && def.subcommands.length && !/^\$/.test(m[2]) && !CommandRegistry.findSub(def, m[2]) && !/^(ayuda|\d+)$/.test(m[2])) {
        // un argumento normal también es válido (p. ej. "play 2"); solo se marca si el comando exige subcomando
        const requiresSub = def.subcommands.length > 0 && /<subcomando>|<acción>/.test(def.usage);
        if (requiresSub) add(`acción apunta a un subcomando inexistente: ${m[1]} ${m[2]} (${rel})`);
      }
    }
  }
}

// 3. Marcadores de relleno
// Las palabras se arman por partes para que este archivo no se marque a sí mismo.
const W = (...parts) => parts.join('');
const PLACEHOLDER_CS = new RegExp(`\\b(${W('TO', 'DO')}|${W('FIX', 'ME')}|${W('X', 'XX')}|${W('HA', 'CK')})\\b`); // sensible a mayúsculas: "todo" es una palabra normal en español
const PLACEHOLDER = new RegExp([W('lorem ', 'ipsum'), W('pr[oó]xima', 'mente'), W('not impl', 'emented'), W('no impl', 'ementado'), W('coming ', 'soon'), W('place', 'holder')].join('|'), 'i');
for (const file of walk(path.join(ROOT, 'src')).filter((f) => f.endsWith('.js'))) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if ((PLACEHOLDER.test(line) || PLACEHOLDER_CS.test(line)) && !line.includes('PLACEHOLDER')) add(`marcador de relleno en ${path.relative(ROOT, file)}:${i + 1}: ${line.trim().slice(0, 80)}`);
  });
}

// 4. Secretos y archivos prohibidos
const SECRET_RES = [
  [/AKIA[0-9A-Z]{16}/, 'clave AWS'],
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'clave privada'],
  [/\bsk-[A-Za-z0-9]{20,}/, 'clave tipo sk-'],
  [/\bghp_[A-Za-z0-9]{30,}/, 'token de GitHub'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, 'token de Slack'],
  [/(?:api[_-]?key|token|secret|password)\s*[:=]\s*['"][A-Za-z0-9_\-]{24,}['"]/i, 'credencial literal'],
];
const SKIP_EXT = new Set(['.png', '.jpg', '.zip', '.lock']);
for (const file of walk(ROOT)) {
  const rel = path.relative(ROOT, file);
  if (SKIP_EXT.has(path.extname(file)) || rel.startsWith('tests/fixtures')) continue;
  if (/^\.env($|\.(?!example))/.test(path.basename(file)) ) add(`archivo .env real presente: ${rel}`);
  if (/(^|\/)(creds\.json|session|auth_info)/.test(rel)) add(`posible sesión de WhatsApp: ${rel}`);
  if (rel.endsWith('.part') || /\.(tmp|log)$/.test(rel)) add(`archivo temporal: ${rel}`);
  if (rel.startsWith('tests/')) continue; // los tests usan claves de mentira a propósito
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
  for (const [r, name] of SECRET_RES) if (r.test(text)) add(`posible secreto (${name}) en ${rel}`);
}
if (fs.existsSync(path.join(ROOT, 'node_modules')) && process.env.AUDIT_FOR_ZIP) add('node_modules presente');

if (problems.length) {
  for (const p of problems) console.error(`✗ ${p}`);
  console.error(`audit: ${problems.length} problema(s).`);
  process.exit(1);
}
console.log(`audit: OK (${registry.size} comandos, ${PLUGINS.length} plugins, sin marcadores, duplicados, acciones rotas ni secretos)`);
