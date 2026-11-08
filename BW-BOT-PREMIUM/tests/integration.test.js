'use strict';

// Fase 12: auditoría estática, reposición idempotente de trabajos y limpieza tras reinicios.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { boot, say, P, GROUP } = require('./support');
const { harness } = require('./harness');

const ROOT = path.resolve(__dirname, '..');
const audit = (cwdRoot) => spawnSync(process.execPath, [path.join(cwdRoot, 'scripts', 'audit.js')], { encoding: 'utf8' });

test('auditoría: el proyecto real pasa (sin relleno, duplicados, acciones rotas ni secretos)', () => {
  const r = audit(ROOT);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /audit: OK/);
});

test('auditoría: detecta una acción rota, un marcador de relleno y un secreto plantados', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bw-audit-'));
  try {
    fs.cpSync(path.join(ROOT, 'src'), path.join(tmp, 'src'), { recursive: true });
    fs.cpSync(path.join(ROOT, 'scripts'), path.join(tmp, 'scripts'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(tmp, 'package.json'));
    fs.writeFileSync(path.join(tmp, 'src', 'extra.js'), [
      "const a = { label: 'x', command: `${ctx.prefix}comandoquenoexiste` };",
      `// ${'TO' + 'DO'}: terminar esto`,
      "const key = 'sk-abcdefghijklmnopqrstuvwxyz123456';",
    ].join('\n'));
    const r = audit(tmp);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /acción apunta a un comando inexistente: comandoquenoexiste/);
    assert.match(r.stderr, /marcador de relleno en src\/extra\.js:2/);
    assert.match(r.stderr, /posible secreto/);
    fs.writeFileSync(path.join(tmp, '.env'), 'X=1');
    assert.match(audit(tmp).stderr, /archivo \.env real presente/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('reinicio: syncAll de todos los servicios es idempotente (sin trabajos duplicados en el scheduler)', async () => {
  const h = await boot({ users: 4 });
  try {
    await say(h, '.equipo crear 4v4 Alfa', P[1]);
    const count = () => Object.keys(h.db.col('scheduled')).length;
    const run = () => { for (const svc of Object.values(h.services)) if (svc && typeof svc.syncAll === 'function') svc.syncAll(); };
    run();
    const first = count();
    run(); run();
    assert.equal(count(), first);
    // y tras "reiniciar" (misma base de datos, procesos nuevos), tampoco
    h.db.flush();
    const h2 = harness({ dir: h.dir, startAt: h.clock.t, gdc: true });
    try {
      for (const svc of Object.values(h2.services)) if (svc && typeof svc.syncAll === 'function') svc.syncAll();
      assert.equal(Object.keys(h2.db.col('scheduled')).length, first);
    } finally { h2.db.close(); }
  } finally { h.close(); }
});

test('reinicio: temporales de medios huérfanos se limpian al arrancar y los botones anteriores caducan', async () => {
  const h = await boot({ users: 3 });
  try {
    const dir = path.join(h.config.paths.tmp, 'media');
    fs.mkdirSync(dir, { recursive: true });
    const old = path.join(dir, 'viejo.part');
    const fresh = path.join(dir, 'reciente.part');
    fs.writeFileSync(old, 'x'); fs.writeFileSync(fresh, 'x');
    const past = new Date(Date.now() - 2 * 3600 * 1000);
    fs.utimesSync(old, past, past);
    h.services.media.syncAll();
    assert.equal(fs.existsSync(old), false);
    assert.equal(fs.existsSync(fresh), true);

    await say(h, '.menu', P[2]);
    const id = [...h.services.interactions.byToken.values()].pop().items[0].buttonId;
    h.db.flush();
    const h2 = harness({ dir: h.dir, startAt: h.clock.t, gdc: true });
    try {
      await h2.d.handleMessage({ key: { remoteJid: GROUP, participant: P[2], id: 'BTN1' }, pushName: 'x', messageTimestamp: Math.floor(h2.clock.t / 1000), message: { buttonsResponseMessage: { selectedButtonId: id } } });
      assert.match(h2.sent.map((s) => s.text).join('\n'), /ya expiró/);
    } finally { h2.db.close(); }
  } finally { h.close(); }
});

test('rate limit y permisos siguen aplicando a comandos de medios y tools', async () => {
  const h = await boot({ users: 3, env: { RATE_LIMIT_USER_MAX: '5', RATE_LIMIT_USER_WINDOW: '60' } });
  try {
    const out = [];
    for (let i = 0; i < 8; i += 1) { h.d.limiter.limiter.clear(`c:${P[2]}:ping`); h.sent.length = 0; await h.say('.ping', { group: GROUP, from: P[2], id: `rl${i}` }); out.push(h.sent.map((s) => s.text).join('')); }
    assert.ok(out.slice(0, 3).every((t) => /Pong/.test(t)));
    assert.ok(out.slice(3).some((t) => !/Pong/.test(t)), 'tras el tope el comando se frena');
    assert.match(await say(h, '.backup', P[2]), /No tienes permiso/);
    assert.match(await say(h, '.broadcast hola', P[2]), /No tienes permiso/);
  } finally { h.close(); }
});
