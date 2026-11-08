'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildConfig, validateConfig, toList } = require('../src/config');
const { Logger, redact } = require('../src/utils/logger');
const { Database } = require('../src/database');
const schema = require('../src/database/schema');
const { InstanceLock } = require('../src/utils/lock');
const { Backoff } = require('../src/utils/backoff');
const { tmpDir, cleanup } = require('./helpers');

// ---------- config ----------

test('config: valores por defecto y owner', () => {
  const cfg = buildConfig({}, '/x');
  assert.equal(cfg.ownerNumber, '593990192338');
  assert.equal(cfg.timezone, 'America/Guayaquil');
  assert.equal(cfg.botPhone, '');
  assert.deepEqual(validateConfig(cfg), []);
});

test('config: normaliza números y listas', () => {
  const cfg = buildConfig({ BOT_PHONE: '+593 99 123 4567', FF_API_URLS: 'a, b;c\nd', FF_REGIONS: 'SA,ME' }, '/x');
  assert.equal(cfg.botPhone, '593991234567');
  assert.deepEqual(cfg.freefire.apiUrls, ['a', 'b', 'c', 'd']);
  assert.deepEqual(cfg.freefire.regions, ['sa', 'me']);
  assert.deepEqual(toList(''), []);
});

test('config: detecta valores inválidos', () => {
  const cfg = buildConfig({ OWNER_NUMBER: '12', LOG_LEVEL: 'ruidoso', RECONNECT_BASE_MS: '9000', RECONNECT_MAX_MS: '5000' }, '/x');
  const problems = validateConfig(cfg);
  assert.ok(problems.some((p) => p.includes('OWNER_NUMBER')));
  assert.ok(problems.some((p) => p.includes('LOG_LEVEL')));
});

test('config: límites numéricos se acotan', () => {
  const cfg = buildConfig({ MAX_PLAY_QUEUE: '99999', MAX_PLAY_CONCURRENT: 'abc' }, '/x');
  assert.equal(cfg.play.maxQueue, 500);
  assert.equal(cfg.play.maxConcurrent, 2);
});

// ---------- logger ----------

test('logger: respeta nivel y censura secretos', () => {
  const records = [];
  const log = new Logger({ level: 'warn', sink: (r) => records.push(r) });
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  process.stdout.write = () => true;
  process.stderr.write = () => true;
  try {
    log.info('no debe salir');
    log.warn('sí', { apiKey: 'SECRETO', ok: 1 });
    log.error('fallo', new Error('boom'));
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
  assert.equal(records.length, 2);
  assert.equal(records[0].meta.apiKey, '[REDACTED]');
  assert.equal(records[0].meta.ok, 1);
  assert.equal(records[1].meta.message, 'boom');
});

test('logger: escribe archivo diario', () => {
  const dir = tmpDir();
  try {
    const log = new Logger({ level: 'info', dir, toFile: true });
    const origOut = process.stdout.write;
    process.stdout.write = () => true;
    try { log.info('hola archivo'); } finally { process.stdout.write = origOut; }
    log.close();
    return new Promise((resolve) => setTimeout(() => {
      const files = fs.readdirSync(dir);
      assert.equal(files.length, 1);
      assert.match(fs.readFileSync(path.join(dir, files[0]), 'utf8'), /hola archivo/);
      cleanup(dir);
      resolve();
    }, 100));
  } catch (e) { cleanup(dir); throw e; }
});

test('redact: anidados', () => {
  const out = redact({ a: { token: 'x', b: [{ password: 'y' }] } });
  assert.equal(out.a.token, '[REDACTED]');
  assert.equal(out.a.b[0].password, '[REDACTED]');
});

// ---------- base de datos ----------

function newDb(dir, extra = {}) {
  return new Database({ file: path.join(dir, 'db.json'), backupDir: path.join(dir, 'bk'), saveDebounceMs: 0, ...extra });
}

test('db: crea DB nueva con todas las colecciones', () => {
  const dir = tmpDir();
  try {
    const db = newDb(dir).load();
    assert.equal(db.data.meta.schemaVersion, schema.SCHEMA_VERSION);
    for (const n of schema.OBJECT_COLLECTIONS) assert.ok(db.col(n));
    assert.ok(Array.isArray(db.col('logs')));
    assert.ok(fs.existsSync(path.join(dir, 'db.json')));
  } finally { cleanup(dir); }
});

test('db: set/get/update/delete persisten tras recargar', () => {
  const dir = tmpDir();
  try {
    const db = newDb(dir).load();
    db.set('users', '1@s.whatsapp.net', { name: 'A', coins: 5 });
    db.update('users', '1@s.whatsapp.net', { coins: 9 });
    db.push('logs', { a: 1 });
    db.close();
    const db2 = newDb(dir).load();
    assert.equal(db2.get('users', '1@s.whatsapp.net').coins, 9);
    assert.equal(db2.col('logs').length, 1);
    db2.delete('users', '1@s.whatsapp.net');
    assert.equal(db2.has('users', '1@s.whatsapp.net'), false);
  } finally { cleanup(dir); }
});

test('db: rechaza claves peligrosas y colecciones desconocidas', () => {
  const dir = tmpDir();
  try {
    const db = newDb(dir).load();
    assert.throws(() => db.set('users', '__proto__', {}));
    assert.throws(() => db.col('noexiste'));
    assert.throws(() => db.update('users', 'nadie', {}));
  } finally { cleanup(dir); }
});

test('db: recupera desde .bak si el principal se corrompe', () => {
  const dir = tmpDir();
  try {
    const db = newDb(dir).load();
    db.set('users', 'u1', { name: 'Uno' });
    db.set('users', 'u2', { name: 'Dos' }); // segundo guardado genera .bak con u1
    db.close();
    fs.writeFileSync(path.join(dir, 'db.json'), '{ esto no es json');
    const db2 = newDb(dir).load();
    assert.equal(db2.recoveredFrom, 'bak');
    assert.equal(db2.get('users', 'u1').name, 'Uno');
    const quarantined = fs.readdirSync(dir).filter((f) => f.includes('.corrupt-'));
    assert.equal(quarantined.length, 1);
  } finally { cleanup(dir); }
});

test('db: sin .bak válido inicia una DB nueva y aísla el archivo corrupto', () => {
  const dir = tmpDir();
  try {
    fs.writeFileSync(path.join(dir, 'db.json'), 'basura');
    const db = newDb(dir).load();
    assert.equal(db.recoveredFrom, 'fresh');
    assert.equal(Object.keys(db.col('users')).length, 0);
  } finally { cleanup(dir); }
});

test('db: ignora .tmp de escritura interrumpida', () => {
  const dir = tmpDir();
  try {
    const db = newDb(dir).load();
    db.set('users', 'u1', { name: 'Uno' });
    db.close();
    fs.writeFileSync(path.join(dir, 'db.json.tmp'), '{"parcial":');
    const db2 = newDb(dir).load();
    assert.equal(db2.get('users', 'u1').name, 'Uno');
    assert.equal(fs.existsSync(path.join(dir, 'db.json.tmp')), false);
  } finally { cleanup(dir); }
});

test('db: migra una DB antigua sin versión y conserva datos', () => {
  const dir = tmpDir();
  try {
    fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ users: { u1: { name: 'Viejo' } } }));
    const db = newDb(dir).load();
    assert.equal(db.get('users', 'u1').name, 'Viejo');
    assert.equal(db.data.meta.schemaVersion, schema.SCHEMA_VERSION);
    assert.ok(db.col('market'));
  } finally { cleanup(dir); }
});

test('db: rechaza una DB de versión futura', () => {
  assert.throws(() => schema.migrate({ meta: { schemaVersion: 999 } }), /más nueva/);
});

test('db: validate detecta tipos erróneos', () => {
  const data = schema.emptyData();
  data.users = [];
  data.logs = {};
  const errors = schema.validate(data);
  assert.equal(errors.length, 2);
});

test('db: guardado diferido y flush', async () => {
  const dir = tmpDir();
  try {
    const db = newDb(dir, { saveDebounceMs: 50 }).load();
    db.set('users', 'u1', { name: 'X' });
    const before = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'));
    assert.equal(before.users.u1, undefined);
    db.flush();
    const after = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'));
    assert.equal(after.users.u1.name, 'X');
    db.close();
  } finally { cleanup(dir); }
});

test('db: backups con rotación y restauración', () => {
  const dir = tmpDir();
  try {
    const db = newDb(dir, { backupKeep: 2 }).load();
    db.set('users', 'u1', { name: 'Original' });
    const name = db.backup('manual');
    db.set('users', 'u1', { name: 'Cambiado' });
    // Nombres distintos aunque el reloj no avance entre llamadas
    for (let i = 0; i < 3; i++) {
      fs.copyFileSync(path.join(dir, 'bk', name), path.join(dir, 'bk', `db-2000-01-0${i + 1}-x.json`));
    }
    db._prune();
    assert.equal(db.listBackups().length, 2);

    const survivors = db.listBackups();
    const target = survivors.find((b) => b.name === name) ? name : survivors[0].name;
    db.restore(target);
    assert.equal(db.get('users', 'u1').name, 'Original');
  } finally { cleanup(dir); }
});

test('db: restore valida el nombre (path traversal)', () => {
  const dir = tmpDir();
  try {
    const db = newDb(dir).load();
    assert.throws(() => db.restore('../db.json'), /inválido/);
    assert.throws(() => db.restore('db-../../x.json'), /inválido/);
    assert.throws(() => db.restore('otro.txt'), /inválido/);
    assert.throws(() => db.restore('db-noexiste.json'), /vacío o corrupto/);
  } finally { cleanup(dir); }
});

test('db: stats cuenta colecciones', () => {
  const dir = tmpDir();
  try {
    const db = newDb(dir).load();
    db.set('users', 'a', {});
    db.set('users', 'b', {});
    assert.equal(db.stats().users, 2);
  } finally { cleanup(dir); }
});

// ---------- lock ----------

test('lock: adquiere y libera', () => {
  const dir = tmpDir();
  try {
    const lock = new InstanceLock(path.join(dir, 'a.lock'));
    assert.equal(lock.acquire(), true);
    assert.ok(fs.existsSync(path.join(dir, 'a.lock')));
    lock.release();
    assert.equal(fs.existsSync(path.join(dir, 'a.lock')), false);
  } finally { cleanup(dir); }
});

test('lock: bloquea si otro proceso vivo lo tiene', () => {
  const dir = tmpDir();
  try {
    const file = path.join(dir, 'a.lock');
    fs.writeFileSync(file, JSON.stringify({ pid: 4242 }));
    const lock = new InstanceLock(file, { pid: 1111, isAlive: (pid) => pid === 4242 });
    assert.throws(() => lock.acquire(), (e) => e.code === 'ELOCKED' && e.pid === 4242);
  } finally { cleanup(dir); }
});

test('lock: reemplaza un lock obsoleto', () => {
  const dir = tmpDir();
  try {
    const file = path.join(dir, 'a.lock');
    fs.writeFileSync(file, JSON.stringify({ pid: 4242 }));
    const lock = new InstanceLock(file, { pid: 1111, isAlive: () => false });
    assert.equal(lock.acquire(), true);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).pid, 1111);
  } finally { cleanup(dir); }
});

test('lock: reemplaza un lock ilegible y no borra el de otro al liberar', () => {
  const dir = tmpDir();
  try {
    const file = path.join(dir, 'a.lock');
    fs.writeFileSync(file, 'basura');
    const lock = new InstanceLock(file, { pid: 1111, isAlive: () => false });
    assert.equal(lock.acquire(), true);
    fs.writeFileSync(file, JSON.stringify({ pid: 9999 }));
    lock.release();
    assert.ok(fs.existsSync(file));
  } finally { cleanup(dir); }
});

// ---------- backoff ----------

test('backoff: crece, se acota y se reinicia', () => {
  const b = new Backoff({ baseMs: 1000, maxMs: 8000, jitter: 0, random: () => 0.5 });
  assert.deepEqual([b.next(), b.next(), b.next(), b.next(), b.next()], [1000, 2000, 4000, 8000, 8000]);
  b.reset();
  assert.equal(b.next(), 1000);
});

test('backoff: respeta maxAttempts', () => {
  const b = new Backoff({ baseMs: 10, maxMs: 100, maxAttempts: 2, jitter: 0 });
  assert.notEqual(b.next(), null);
  assert.notEqual(b.next(), null);
  assert.equal(b.next(), null);
});

test('backoff: jitter se mantiene dentro de límites', () => {
  const b = new Backoff({ baseMs: 1000, maxMs: 1000, jitter: 0.2, random: () => 1 });
  assert.ok(b.next() <= 1000);
});
