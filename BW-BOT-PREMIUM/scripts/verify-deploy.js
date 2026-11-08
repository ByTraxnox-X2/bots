'use strict';

// npm run verify-deploy: comprueba que los archivos de despliegue (Docker, PM2, Termux, docs)
// son coherentes con el código real, para que no sean documentación ficticia.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DOCS = {
  'README-TERMUX.md': ['install-termux.sh', 'termux-wake-lock', 'BOT_PHONE', 'npm start'],
  'README-HOSTING.md': ['pm2 start ecosystem.config.js', 'pm2 save', 'pm2 startup', 'npm ci', 'systemd'],
  'README-DOCKER.md': ['docker compose up -d', 'docker compose logs', 'bw_data', '/health'],
  'DEPLOYMENT.md': ['npm ci', 'npm run check', 'npm test', 'npm start', '/health', '/ready', 'SIGTERM'],
};

function read(root, rel) {
  try {
    return fs.readFileSync(path.join(root, rel), 'utf8');
  } catch {
    return null;
  }
}

function verify(root = path.resolve(__dirname, '..')) {
  const problems = [];
  const add = (msg) => problems.push(msg);

  // ---- package.json ----
  const pkgText = read(root, 'package.json');
  let pkg = null;
  try { pkg = JSON.parse(pkgText); } catch { add('package.json no existe o no es JSON válido.'); }
  if (pkg) {
    const major = Number((/(\d+)/.exec(pkg.engines && pkg.engines.node) || [])[1]);
    if (!(major >= 20)) add('package.json: engines.node debe exigir Node 20 o superior.');
    if (!pkg.scripts || pkg.scripts.start !== 'node index.js') add('package.json: el script "start" debe ser "node index.js".');
  }

  // ---- variables de entorno: todo lo que lee config debe estar en .env.example ----
  const configSrc = read(root, 'src/config/index.js') || '';
  const envExample = read(root, '.env.example');
  if (envExample === null) {
    add('Falta .env.example.');
  } else {
    const used = new Set([...configSrc.matchAll(/env\.([A-Z][A-Z0-9_]+)/g)].map((m) => m[1]));
    for (const name of used) {
      if (!new RegExp(`^#?\\s*${name}=`, 'm').test(envExample)) add(`.env.example no documenta ${name} (la lee src/config).`);
    }
  }

  // ---- entrada y apagado: kill_timeout / stop_grace_period deben superar el plazo de apagado ----
  let failsafeMs = 15000;
  try {
    ({ SHUTDOWN_FAILSAFE_MS: failsafeMs } = require(path.join(root, 'src/app.js')));
  } catch (err) {
    add(`No se pudo cargar src/app.js: ${err.message}`);
  }
  if (!fs.existsSync(path.join(root, 'index.js'))) add('Falta index.js.');

  // ---- PM2 ----
  const ecoPath = path.join(root, 'ecosystem.config.js');
  if (!fs.existsSync(ecoPath)) {
    add('Falta ecosystem.config.js.');
  } else {
    try {
      delete require.cache[require.resolve(ecoPath)];
      const eco = require(ecoPath);
      const app = eco.apps && eco.apps[0];
      if (!app) add('ecosystem.config.js: no define ninguna app.');
      else {
        if (!fs.existsSync(path.join(root, app.script || ''))) add(`ecosystem.config.js: el script "${app.script}" no existe.`);
        if (app.instances !== 1) add('ecosystem.config.js: instances debe ser 1 (una sola sesión de WhatsApp).');
        if (app.exec_mode !== 'fork') add('ecosystem.config.js: exec_mode debe ser "fork".');
        if (app.autorestart !== true) add('ecosystem.config.js: autorestart debe estar activo.');
        if (!(app.kill_timeout > failsafeMs)) add(`ecosystem.config.js: kill_timeout debe ser mayor que el plazo de apagado (${failsafeMs} ms).`);
      }
    } catch (err) {
      add(`ecosystem.config.js no se puede cargar: ${err.message}`);
    }
  }

  // ---- Docker ----
  const dockerfile = read(root, 'Dockerfile');
  const compose = read(root, 'docker-compose.yml');
  const dockerignore = read(root, '.dockerignore');
  let dockerPort = null;
  if (dockerfile === null) {
    add('Falta Dockerfile.');
  } else {
    const from = [...dockerfile.matchAll(/^FROM\s+node:(\d+)/gm)].map((m) => Number(m[1]));
    if (from.length === 0) add('Dockerfile: la imagen base debe ser node:<versión>.');
    if (from.some((v) => v < 20)) add('Dockerfile: la imagen base debe ser Node 20 o superior.');
    if (!/^HEALTHCHECK\b/m.test(dockerfile)) add('Dockerfile: falta HEALTHCHECK.');
    if (!/^USER\s+node\b/m.test(dockerfile)) add('Dockerfile: debe ejecutarse como usuario "node" (sin root).');
    if (!/^VOLUME\s+\["\/app\/data"\]/m.test(dockerfile)) add('Dockerfile: /app/data debe ser un volumen.');
    if (!/^CMD\s+\["node",\s*"index\.js"\]/m.test(dockerfile)) add('Dockerfile: CMD debe ser ["node", "index.js"].');
    if (!/git/.test(dockerfile)) add('Dockerfile: la etapa de dependencias necesita git (Baileys instala dependencias desde GitHub).');
    for (const v of ['DATA_DIR', 'SESSION_DIR', 'BACKUP_DIR', 'LOG_DIR', 'HEALTH_PORT', 'HEALTH_HOST']) {
      if (!new RegExp(`\\b${v}=`).test(dockerfile)) add(`Dockerfile: falta ENV ${v}.`);
    }
    dockerPort = (/HEALTH_PORT=(\d+)/.exec(dockerfile) || [])[1] || null;
    for (const f of ['index.js', 'src', 'scripts', 'package.json']) {
      if (!new RegExp(`^COPY\\b.*\\b${f.replace('.', '\\.')}\\b`, 'm').test(dockerfile)) add(`Dockerfile: no copia ${f}.`);
    }
  }
  if (compose === null) {
    add('Falta docker-compose.yml.');
  } else {
    if (!/restart:\s*unless-stopped/.test(compose)) add('docker-compose.yml: falta "restart: unless-stopped".');
    if (!/init:\s*true/.test(compose)) add('docker-compose.yml: falta "init: true".');
    const grace = /stop_grace_period:\s*(\d+)s/.exec(compose);
    if (!grace || Number(grace[1]) * 1000 <= failsafeMs) add('docker-compose.yml: stop_grace_period debe superar el plazo de apagado del bot.');
    if (!/-\s*bw_data:\/app\/data/.test(compose)) add('docker-compose.yml: /app/data debe montarse en el volumen bw_data.');
    if (!/^volumes:\s*\n\s+bw_data:/m.test(compose)) add('docker-compose.yml: falta declarar el volumen bw_data.');
    if (!/healthcheck:/.test(compose)) add('docker-compose.yml: falta healthcheck.');
    const composePort = (/HEALTH_PORT:\s*"?(\d+)"?/.exec(compose) || [])[1];
    if (dockerPort && composePort && dockerPort !== composePort) add('HEALTH_PORT difiere entre Dockerfile y docker-compose.yml.');
    if (/0\.0\.0\.0:\d+:\d+/.test(compose) || /-\s*"?\d+:\d+"?\s*$/m.test(compose.replace(/127\.0\.0\.1:\d+:\d+/g, ''))) {
      add('docker-compose.yml: el health check no debe publicarse a todas las interfaces.');
    }
  }
  if (dockerignore === null) {
    add('Falta .dockerignore.');
  } else {
    for (const entry of ['.env', 'node_modules', 'data']) {
      if (!new RegExp(`^${entry.replace('.', '\\.')}$`, 'm').test(dockerignore)) add(`.dockerignore debe excluir ${entry}.`);
    }
  }

  // ---- secretos fuera de git ----
  const gitignore = read(root, '.gitignore');
  if (gitignore === null) add('Falta .gitignore.');
  else for (const entry of ['.env', 'node_modules/', 'data/session/']) {
    if (!gitignore.split('\n').includes(entry)) add(`.gitignore debe incluir ${entry}.`);
  }

  // ---- Termux ----
  const sh = path.join(root, 'install-termux.sh');
  if (!fs.existsSync(sh)) {
    add('Falta install-termux.sh.');
  } else {
    if (!read(root, 'install-termux.sh').startsWith('#!')) add('install-termux.sh: falta el shebang.');
    if (process.platform !== 'win32' && !(fs.statSync(sh).mode & 0o111)) add('install-termux.sh: no es ejecutable (chmod +x).');
    const bash = spawnSync('bash', ['-n', sh], { encoding: 'utf8' });
    if (!bash.error && bash.status !== 0) add(`install-termux.sh: error de sintaxis: ${bash.stderr.trim()}`);
  }

  // ---- documentación ----
  const scripts = (pkg && pkg.scripts) || {};
  for (const [file, mustMention] of Object.entries(DOCS)) {
    const text = read(root, file);
    if (text === null || text.trim().length < 400) {
      add(`Falta ${file} o está vacío.`);
      continue;
    }
    for (const needle of mustMention) {
      if (!text.includes(needle)) add(`${file}: debería mencionar "${needle}".`);
    }
    for (const m of text.matchAll(/npm run ([a-z][a-z-]*)/g)) {
      if (!scripts[m[1]]) add(`${file}: menciona "npm run ${m[1]}" pero no existe en package.json.`);
    }
    for (const m of text.matchAll(/^[ \t]*([A-Z][A-Z0-9_]+)=/gm)) {
      const name = m[1];
      if (envExample && !new RegExp(`^#?\\s*${name}=`, 'm').test(envExample)) {
        add(`${file}: documenta la variable ${name}, que no existe en .env.example.`);
      }
    }
  }

  return problems;
}

module.exports = { verify };

if (require.main === module) {
  const problems = verify();
  if (problems.length) {
    for (const p of problems) console.error(`✗ ${p}`);
    console.error(`\nverify-deploy: ${problems.length} problema(s).`);
    process.exit(1);
  }
  console.log('verify-deploy: OK');
}
