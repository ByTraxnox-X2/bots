'use strict';

// Pruebas con procesos reales: arranque, health check, SIGTERM, instancia única y reinicio.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const { tmpDir, cleanup } = require('./helpers');

const FIXTURE = path.join(__dirname, 'fixtures', 'run-app.js');

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: urlPath }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

function launch(dir, port, extra = {}) {
  const child = spawn(process.execPath, [FIXTURE], {
    env: {
      ...process.env,
      DATA_DIR: dir,
      SESSION_DIR: path.join(dir, 'session'),
      BACKUP_DIR: path.join(dir, 'backups'),
      LOG_DIR: path.join(dir, 'logs'),
      LOG_TO_FILE: 'false',
      HEALTH_PORT: String(port),
      DB_BACKUP_MINUTES: '0',
      DB_SAVE_DEBOUNCE_MS: '0',
      FIRED_FILE: path.join(dir, 'fired.txt'),
      ...extra,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const proc = { child, out: '', err: '', exit: null };
  child.stdout.on('data', (c) => (proc.out += c));
  child.stderr.on('data', (c) => (proc.err += c));
  proc.exited = new Promise((resolve) => child.on('exit', (code, signal) => { proc.exit = { code, signal }; resolve(proc.exit); }));
  proc.ready = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`No arrancó a tiempo.\nstdout: ${proc.out}\nstderr: ${proc.err}`)), 10000);
    const poll = setInterval(() => {
      if (proc.out.includes('READY')) { clearTimeout(t); clearInterval(poll); resolve(); }
      if (proc.exit) { clearTimeout(t); clearInterval(poll); reject(new Error(`Terminó antes de estar listo (${JSON.stringify(proc.exit)}).\nstderr: ${proc.err}`)); }
    }, 25);
  });
  proc.ready.catch(() => {}); // si nadie la espera (p. ej. instancia rechazada), no es un error sin manejar
  return proc;
}

async function terminate(proc) {
  if (!proc.exit) proc.child.kill('SIGTERM');
  return proc.exited;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('proceso real: arranca, responde health checks y se apaga limpio con SIGTERM', async () => {
  const dir = tmpDir();
  const port = await freePort();
  const proc = launch(dir, port, { SCHEDULE_ID: 'lejano', SCHEDULE_IN_MS: String(3600 * 1000) });
  try {
    await proc.ready;
    assert.equal((await get(port, '/health')).status, 200);
    assert.equal((await get(port, '/ready')).status, 200);
    const status = JSON.parse((await get(port, '/status')).body);
    assert.equal(status.whatsapp.state, 'open');
    assert.equal(status.whatsapp.selfNumber, '593991111111');
    assert.equal(status.scheduler.pending, 1);
    assert.ok(fs.existsSync(path.join(dir, 'bot.lock')));

    const exit = await terminate(proc);
    assert.deepEqual(exit, { code: 0, signal: null });
    assert.equal(fs.existsSync(path.join(dir, 'bot.lock')), false, 'el lock debe liberarse');
    const db = JSON.parse(fs.readFileSync(path.join(dir, 'database.json'), 'utf8'));
    assert.equal(db.scheduled.lejano.status, 'pending', 'el trabajo programado debe quedar guardado');
    await assert.rejects(() => get(port, '/health'), 'el health check debe cerrarse');
  } finally {
    if (!proc.exit) proc.child.kill('SIGKILL');
    cleanup(dir);
  }
});

test('proceso real: SIGINT (Ctrl+C) también apaga limpio, libera el lock y deja el trabajo programado guardado', async () => {
  const dir = tmpDir();
  const port = await freePort();
  const proc = launch(dir, port, { SCHEDULE_ID: 'lejano', SCHEDULE_IN_MS: String(3600 * 1000) });
  try {
    await proc.ready;
    proc.child.kill('SIGINT');
    const exit = await proc.exited;
    assert.deepEqual(exit, { code: 0, signal: null });
    assert.equal(fs.existsSync(path.join(dir, 'bot.lock')), false);
    const db = JSON.parse(fs.readFileSync(path.join(dir, 'database.json'), 'utf8'));
    assert.equal(db.scheduled.lejano.status, 'pending');
  } finally {
    if (!proc.exit) proc.child.kill('SIGKILL');
    cleanup(dir);
  }
});

test('proceso real: una segunda instancia con la misma sesión se rechaza', async () => {
  const dir = tmpDir();
  const port = await freePort();
  const first = launch(dir, port);
  let second;
  try {
    await first.ready;
    second = launch(dir, 0);
    const exit = await second.exited;
    assert.equal(exit.code, 2);
    assert.match(second.err, /ELOCKED/);
    assert.ok(fs.existsSync(path.join(dir, 'bot.lock')), 'la segunda instancia no debe borrar el lock de la primera');
    assert.equal((await get(port, '/health')).status, 200, 'la primera sigue viva');
  } finally {
    await terminate(first);
    if (second && !second.exit) second.child.kill('SIGKILL');
    cleanup(dir);
  }
});

test('proceso real: tras un kill -9 el lock obsoleto se recupera y la DB sigue íntegra', async () => {
  const dir = tmpDir();
  const port = await freePort();
  const first = launch(dir, port, { SCHEDULE_ID: 'persistente', SCHEDULE_IN_MS: String(3600 * 1000) });
  let second;
  try {
    await first.ready;
    first.child.kill('SIGKILL'); // caída brusca: no hay apagado limpio ni lock liberado
    await first.exited;
    assert.ok(fs.existsSync(path.join(dir, 'bot.lock')), 'queda un lock huérfano');

    second = launch(dir, port);
    await second.ready;
    const status = JSON.parse((await get(port, '/status')).body);
    assert.equal(status.scheduler.pending, 1, 'el trabajo programado sobrevivió a la caída');
    assert.deepEqual(await terminate(second), { code: 0, signal: null });
  } finally {
    if (!first.exit) first.child.kill('SIGKILL');
    if (second && !second.exit) second.child.kill('SIGKILL');
    cleanup(dir);
  }
});

test('proceso real: tareas vencidas durante la caída se ejecutan una sola vez tras reiniciar', async () => {
  const dir = tmpDir();
  const port = await freePort();
  const firedFile = path.join(dir, 'fired.txt');
  let run1; let run2; let run3;
  try {
    // 1) Programa un trabajo lejano y apaga limpio.
    run1 = launch(dir, port, { SCHEDULE_ID: 'aviso', SCHEDULE_IN_MS: String(3600 * 1000) });
    await run1.ready;
    await terminate(run1);
    assert.equal(fs.existsSync(firedFile), false);

    // 2) Simula que el servidor estuvo apagado y el aviso venció hace 30 s (dentro de la gracia de 5 min).
    const dbFile = path.join(dir, 'database.json');
    const db = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    db.scheduled.aviso.runAt = Date.now() - 30000;
    fs.writeFileSync(dbFile, JSON.stringify(db));

    // 3) Reinicio: debe enviarse exactamente una vez.
    run2 = launch(dir, port);
    await run2.ready;
    await sleep(300);
    assert.equal(fs.readFileSync(firedFile, 'utf8'), 'aviso\n');
    assert.deepEqual(await terminate(run2), { code: 0, signal: null });

    // 4) Otro reinicio: no debe repetirse.
    run3 = launch(dir, port);
    await run3.ready;
    await sleep(300);
    assert.equal(fs.readFileSync(firedFile, 'utf8'), 'aviso\n', 'no debe haber duplicados');
    await terminate(run3);
  } finally {
    for (const p of [run1, run2, run3]) if (p && !p.exit) p.child.kill('SIGKILL');
    cleanup(dir);
  }
});

test('proceso real: un aviso vencido hace demasiado se marca perdido y no se envía', async () => {
  const dir = tmpDir();
  const port = await freePort();
  const firedFile = path.join(dir, 'fired.txt');
  let run1; let run2;
  try {
    run1 = launch(dir, port, { SCHEDULE_ID: 'viejo', SCHEDULE_IN_MS: String(3600 * 1000) });
    await run1.ready;
    await terminate(run1);
    const dbFile = path.join(dir, 'database.json');
    const db = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    db.scheduled.viejo.runAt = Date.now() - 3 * 3600 * 1000;
    fs.writeFileSync(dbFile, JSON.stringify(db));

    run2 = launch(dir, port);
    await run2.ready;
    await sleep(300);
    assert.equal(fs.existsSync(firedFile), false);
    const status = JSON.parse((await get(port, '/status')).body);
    assert.equal(status.scheduler.missed, 1);
    await terminate(run2);
  } finally {
    for (const p of [run1, run2]) if (p && !p.exit) p.child.kill('SIGKILL');
    cleanup(dir);
  }
});
