'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');

const { HealthServer } = require('../src/utils/health');
const { buildStatus } = require('../src/utils/status');
const { detectEnvironment } = require('../src/utils/env');
const { buildConfig, validateConfig } = require('../src/config');
const { Database } = require('../src/database');
const { Scheduler } = require('../src/scheduler');
const { tmpDir, cleanup } = require('./helpers');

function request(port, method, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function withServer(getStatus, fn) {
  const hs = new HealthServer({ getStatus });
  const port = await hs.start({ port: 0 });
  try { await fn(port); } finally { await hs.stop(); }
}

test('health: /health responde 200 y /ready depende de WhatsApp', async () => {
  let state = 'connecting';
  await withServer(() => ({ whatsapp: { state } }), async (port) => {
    assert.equal((await request(port, 'GET', '/health')).status, 200);
    const notReady = await request(port, 'GET', '/ready');
    assert.equal(notReady.status, 503);
    state = 'open';
    assert.equal((await request(port, 'GET', '/ready')).status, 200);
  });
});

test('health: /status devuelve JSON, rutas desconocidas 404, métodos no permitidos 405', async () => {
  await withServer(() => ({ whatsapp: { state: 'open' }, name: 'x' }), async (port) => {
    const s = await request(port, 'GET', '/status');
    assert.equal(s.status, 200);
    assert.equal(JSON.parse(s.body).name, 'x');
    assert.match(s.headers['content-type'], /json/);
    assert.equal((await request(port, 'GET', '/nada')).status, 404);
    assert.equal((await request(port, 'POST', '/health')).status, 405);
    const head = await request(port, 'HEAD', '/health');
    assert.equal(head.status, 200);
    assert.equal(head.body, '');
  });
});

test('health: un error interno responde 500 y el servidor sigue vivo', async () => {
  let fail = true;
  await withServer(() => { if (fail) throw new Error('boom'); return { whatsapp: { state: 'open' } }; }, async (port) => {
    assert.equal((await request(port, 'GET', '/status')).status, 500);
    fail = false;
    assert.equal((await request(port, 'GET', '/status')).status, 200);
  });
});

test('health: stop libera el puerto', async () => {
  const hs = new HealthServer({ getStatus: () => ({ whatsapp: { state: 'open' } }) });
  const port = await hs.start({ port: 0 });
  await hs.stop();
  await assert.rejects(() => request(port, 'GET', '/health'));
  await hs.stop(); // idempotente
});

test('status: incluye estado real y no filtra secretos', () => {
  const dir = tmpDir();
  try {
    const config = buildConfig({ FF_API_KEY: 'SECRETO-123', FF_API_URLS: 'https://api.ejemplo' }, dir);
    const db = new Database({ file: path.join(dir, 'db.json'), saveDebounceMs: 0 }).load();
    db.set('users', 'u1', {});
    const silent = { debug() {}, info() {}, warn() {}, error() {}, child() { return silent; } };
    const scheduler = new Scheduler({ db, logger: silent });
    const wa = { state: 'open', selfNumber: '593991111111', connectedAt: Date.now(), backoff: { attempts: 2 } };
    const status = buildStatus({
      config, wa, db, scheduler, environment: { runtime: 'docker' }, startedAt: Date.now() - 5000,
    });
    assert.equal(status.whatsapp.state, 'open');
    assert.equal(status.whatsapp.reconnectAttempts, 2);
    assert.equal(status.database.users, 1);
    assert.ok(status.uptimeSec >= 5);
    assert.ok(status.memory.rssMB > 0);
    assert.equal(status.environment.runtime, 'docker');
    assert.equal(JSON.stringify(status).includes('SECRETO-123'), false);
    assert.equal(JSON.stringify(status).includes('api.ejemplo'), false);
  } finally { cleanup(dir); }
});

test('env: detecta Termux, Docker, PM2 y Linux genérico', () => {
  const none = () => false;
  assert.equal(detectEnvironment({ env: { PREFIX: '/data/data/com.termux/files/usr' }, exists: none }).runtime, 'termux');
  assert.equal(detectEnvironment({ env: { TERMUX_VERSION: '0.118' }, exists: none }).runtime, 'termux');
  assert.equal(detectEnvironment({ env: {}, exists: (p) => p === '/.dockerenv' }).runtime, 'docker');
  assert.equal(detectEnvironment({ env: { BW_IN_DOCKER: '1' }, exists: none }).runtime, 'docker');
  assert.equal(detectEnvironment({ env: {}, exists: none, platform: 'linux' }).runtime, 'linux');
  assert.equal(detectEnvironment({ env: { pm_id: '0' }, exists: none }).processManager, 'pm2');
  assert.equal(detectEnvironment({ env: { INVOCATION_ID: 'x' }, exists: none }).processManager, 'systemd');
  assert.equal(detectEnvironment({ env: {}, exists: none }).processManager, 'none');
});

test('config: health, scheduler y zona horaria', () => {
  const cfg = buildConfig({ HEALTH_PORT: '3000', HEALTH_HOST: '0.0.0.0', SCHEDULER_GRACE_SECONDS: '60' }, '/x');
  assert.equal(cfg.health.port, 3000);
  assert.equal(cfg.health.host, '0.0.0.0');
  assert.equal(cfg.scheduler.graceMs, 60000);
  assert.equal(buildConfig({}, '/x').health.port, 0);
  const bad = buildConfig({ TZ_BOT: 'Mars/Olympus' }, '/x');
  assert.ok(validateConfig(bad).some((p) => p.includes('TZ_BOT')));
});
