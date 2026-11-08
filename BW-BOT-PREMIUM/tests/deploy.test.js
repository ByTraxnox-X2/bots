'use strict';

// Verifica que los archivos de despliegue sean coherentes con el código y que el instalador funcione.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { verify } = require('../scripts/verify-deploy');
const { SHUTDOWN_FAILSAFE_MS } = require('../src/app');
const { tmpDir, cleanup } = require('./helpers');

const ROOT = path.resolve(__dirname, '..');

function copyProject() {
  const dir = tmpDir('bwbot-deploy-');
  fs.cpSync(ROOT, dir, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(ROOT, src);
      return !(rel === 'node_modules' || rel === 'data' || rel === '.git' || rel.startsWith('node_modules' + path.sep));
    },
  });
  return dir;
}

function mutate(dir, file, fn) {
  const p = path.join(dir, file);
  fs.writeFileSync(p, fn(fs.readFileSync(p, 'utf8')));
}

test('despliegue: el proyecto real no tiene incoherencias', () => {
  assert.deepEqual(verify(ROOT), []);
});

test('despliegue: PM2 y compose dan más margen que el apagado del bot', () => {
  const eco = require('../ecosystem.config.js').apps[0];
  assert.ok(eco.kill_timeout > SHUTDOWN_FAILSAFE_MS);
  const grace = Number(/stop_grace_period:\s*(\d+)s/.exec(fs.readFileSync(path.join(ROOT, 'docker-compose.yml'), 'utf8'))[1]);
  assert.ok(grace * 1000 > SHUTDOWN_FAILSAFE_MS);
});

const NEGATIVE_CASES = [
  ['Dockerfile sin HEALTHCHECK', 'Dockerfile', (t) => t.replace(/^HEALTHCHECK[\s\S]*?\n(?=STOPSIGNAL)/m, ''), /HEALTHCHECK/],
  ['Dockerfile como root', 'Dockerfile', (t) => t.replace('USER node', '# sin usuario'), /usuario "node"/],
  ['PM2 con varias instancias', 'ecosystem.config.js', (t) => t.replace('instances: 1', 'instances: 2'), /instances/],
  ['PM2 sin margen de apagado', 'ecosystem.config.js', (t) => t.replace('kill_timeout: 20000', 'kill_timeout: 1000'), /kill_timeout/],
  ['compose sin volumen de datos', 'docker-compose.yml', (t) => t.replace('- bw_data:/app/data', '- ./nada:/tmp/nada'), /bw_data/],
  ['compose sin reinicio automático', 'docker-compose.yml', (t) => t.replace('restart: unless-stopped', 'restart: "no"'), /restart/],
  ['compose con gracia corta', 'docker-compose.yml', (t) => t.replace('stop_grace_period: 30s', 'stop_grace_period: 5s'), /stop_grace_period/],
  ['compose publica el puerto a todas las interfaces', 'docker-compose.yml', (t) => t.replace('127.0.0.1:3000:3000', '0.0.0.0:3000:3000'), /interfaces/],
  ['.dockerignore sin .env', '.dockerignore', (t) => t.replace(/^\.env$/m, ''), /\.env/],
  ['.gitignore sin sesión', '.gitignore', (t) => t.replace('data/session/\n', ''), /data\/session/],
  ['.env.example sin una variable que usa el código', '.env.example', (t) => t.replace(/^HEALTH_PORT=.*$/m, ''), /HEALTH_PORT/],
  ['guía que menciona un script inexistente', 'DEPLOYMENT.md', (t) => t + '\n`npm run inventado`\n', /inventado/],
  ['guía que documenta una variable inexistente', 'README-DOCKER.md', (t) => t + '\nVARIABLE_FANTASMA=1\n', /VARIABLE_FANTASMA/],
  ['guía que olvida el comando de arranque', 'DEPLOYMENT.md', (t) => t.replace(/npm start/g, 'node x'), /npm start/],
  ['package.json con Node antiguo', 'package.json', (t) => t.replace('>=20', '>=16'), /Node 20/],
];

for (const [name, file, fn, expected] of NEGATIVE_CASES) {
  test(`despliegue: detecta ${name}`, () => {
    const dir = copyProject();
    try {
      mutate(dir, file, fn);
      const problems = verify(dir);
      assert.ok(problems.length > 0, 'debería haber detectado el problema');
      assert.ok(problems.some((p) => expected.test(p)), `ningún problema coincide con ${expected}: ${problems.join(' | ')}`);
    } finally { cleanup(dir); }
  });
}

test('despliegue: detecta una guía ausente', () => {
  const dir = copyProject();
  try {
    fs.rmSync(path.join(dir, 'README-TERMUX.md'));
    assert.ok(verify(dir).some((p) => p.includes('README-TERMUX.md')));
  } finally { cleanup(dir); }
});

// ---------- instalador (con npm y node simulados para no tocar la red) ----------

function fakeBin(dir, { nodeMajor = null } = {}) {
  const bin = path.join(dir, 'fakebin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'npm'), '#!/bin/sh\nif [ "$1" = "-v" ]; then echo 10.0.0; exit 0; fi\necho "$@" >> "$FAKE_NPM_LOG"\nexit 0\n', { mode: 0o755 });
  if (nodeMajor !== null) {
    const realNode = process.execPath;
    fs.writeFileSync(
      path.join(bin, 'node'),
      `#!/bin/sh\nif [ "$1" = "-v" ]; then echo v${nodeMajor}.0.0; exit 0; fi\nif [ "$1" = "-p" ]; then echo ${nodeMajor}; exit 0; fi\nexec "${realNode}" "$@"\n`,
      { mode: 0o755 }
    );
  }
  return bin;
}

function runInstaller(dir, bin) {
  return spawnSync('bash', ['install-termux.sh'], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${path.dirname(process.execPath)}:${process.env.PATH}`,
      FAKE_NPM_LOG: path.join(dir, 'npm.log'),
      TERMUX_VERSION: '',
      PREFIX: '',
    },
  });
}

test('instalador: crea directorios y .env, instala dependencias y verifica el proyecto', () => {
  const dir = copyProject();
  try {
    const r = runInstaller(dir, fakeBin(dir));
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(fs.existsSync(path.join(dir, '.env')));
    for (const d of ['session', 'backups', 'logs', 'tmp']) assert.ok(fs.statSync(path.join(dir, 'data', d)).isDirectory());
    assert.equal(fs.statSync(path.join(dir, 'data', 'session')).mode & 0o777, 0o700);
    assert.match(fs.readFileSync(path.join(dir, 'npm.log'), 'utf8'), /(install|ci) --omit=dev/);
    assert.match(r.stdout, /BOT_PHONE/);
  } finally { cleanup(dir); }
});

test('instalador: no pisa un .env existente y usa npm ci si hay package-lock.json', () => {
  const dir = copyProject();
  try {
    fs.writeFileSync(path.join(dir, '.env'), 'BOT_PHONE=593990000000\n');
    fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}');
    const r = runInstaller(dir, fakeBin(dir));
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(fs.readFileSync(path.join(dir, '.env'), 'utf8'), 'BOT_PHONE=593990000000\n');
    assert.match(fs.readFileSync(path.join(dir, 'npm.log'), 'utf8'), /ci --omit=dev/);
  } finally { cleanup(dir); }
});

test('instalador: rechaza Node.js menor que 20', () => {
  const dir = copyProject();
  try {
    const r = runInstaller(dir, fakeBin(dir, { nodeMajor: 18 }));
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /Node\.js 20/);
    assert.equal(fs.existsSync(path.join(dir, '.env')), false, 'no debe seguir instalando');
  } finally { cleanup(dir); }
});
