'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const time = require('../src/utils/time');
const { Database } = require('../src/database');
const { Scheduler, MAX_TIMEOUT_MS } = require('../src/scheduler');
const { tmpDir, cleanup } = require('./helpers');

const TZ = 'America/Guayaquil';
const silent = { debug() {}, info() {}, warn() {}, error() {}, child() { return silent; } };

// ---------- zona horaria ----------

test('time: 19:00 en Guayaquil es 00:00 UTC del día siguiente', () => {
  const utc = time.zonedToUtc({ year: 2026, month: 10, day: 4, hour: 19, minute: 0 }, TZ);
  assert.equal(new Date(utc).toISOString(), '2026-10-05T00:00:00.000Z');
});

test('time: localParts/localTimeString son coherentes', () => {
  const utc = Date.UTC(2026, 9, 5, 0, 0, 0);
  assert.equal(time.localTimeString(utc, TZ), '19:00');
  assert.equal(time.localDateString(utc, TZ), '2026-10-04');
});

test('time: parseHHMM valida', () => {
  assert.deepEqual(time.parseHHMM('19:00'), { hour: 19, minute: 0 });
  assert.deepEqual(time.parseHHMM('7:05'), { hour: 7, minute: 5 });
  assert.equal(time.parseHHMM('25:00'), null);
  assert.equal(time.parseHHMM('19:60'), null);
  assert.equal(time.parseHHMM('abc'), null);
});

test('time: próxima ocurrencia con recordatorio 10 min antes', () => {
  // Domingo 2026-10-04 16:05 hora Ecuador
  const after = time.zonedToUtc({ year: 2026, month: 10, day: 4, hour: 16, minute: 5 }, TZ);
  const r = time.nextDailyOccurrence({ hhmm: '19:00', tz: TZ, afterMs: after, offsetMinutes: -10 });
  assert.equal(r.localDate, '2026-10-04');
  assert.equal(r.localTime, '18:50');
});

test('time: si la hora de hoy ya pasó, usa mañana', () => {
  const after = time.zonedToUtc({ year: 2026, month: 10, day: 4, hour: 19, minute: 30 }, TZ);
  const r = time.nextDailyOccurrence({ hhmm: '19:00', tz: TZ, afterMs: after });
  assert.equal(r.localDate, '2026-10-05');
});

test('time: zona con horario de verano se resuelve bien', () => {
  const utc = time.zonedToUtc({ year: 2026, month: 7, day: 1, hour: 12, minute: 0 }, 'America/New_York');
  assert.equal(new Date(utc).toISOString(), '2026-07-01T16:00:00.000Z');
  assert.equal(time.isValidTimeZone('Mars/Olympus'), false);
});

// ---------- scheduler ----------

function env() {
  const dir = tmpDir();
  const file = path.join(dir, 'db.json');
  let clock = time.zonedToUtc({ year: 2026, month: 10, day: 4, hour: 16, minute: 0 }, TZ);
  const timers = [];
  const make = () => {
    const db = new Database({ file, backupDir: path.join(dir, 'bk'), saveDebounceMs: 0 }).load();
    const sched = new Scheduler({
      db,
      logger: silent,
      now: () => clock,
      setTimer: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; },
      clearTimer: (t) => { t.cleared = true; },
      retryBaseMs: 1000,
    });
    return { db, sched };
  };
  return { dir, make, timers, advance: (ms) => { clock += ms; }, setNow: (v) => { clock = v; }, now: () => clock };
}

test('scheduler: ejecuta un trabajo a su hora, una sola vez', async () => {
  const e = env();
  try {
    const { sched } = e.make();
    const fired = [];
    sched.register('t', async (job) => fired.push(job.id));
    await sched.start();
    sched.schedule({ id: 'a', type: 't', runAt: e.now() + 1000 });
    await sched.runDue();
    assert.deepEqual(fired, []);
    e.advance(1500);
    await sched.runDue();
    await sched.runDue();
    assert.deepEqual(fired, ['a']);
    assert.equal(sched.get('a').status, 'done');
  } finally { cleanup(e.dir); }
});

test('scheduler: mismo id no crea duplicados', async () => {
  const e = env();
  try {
    const { sched } = e.make();
    const first = sched.schedule({ id: 'x', type: 't', runAt: e.now() + 5000 });
    const second = sched.schedule({ id: 'x', type: 't', runAt: e.now() + 9999 });
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(sched.list().length, 1);
    assert.equal(sched.get('x').runAt, first.job.runAt);
    sched.schedule({ id: 'x', type: 't', runAt: e.now() + 9999, reschedule: true });
    assert.equal(sched.get('x').runAt, e.now() + 9999);
  } finally { cleanup(e.dir); }
});

test('scheduler: tras reiniciar se reconstruyen pendientes y no se repite lo ya enviado', async () => {
  const e = env();
  try {
    let { db, sched } = e.make();
    const fired = [];
    sched.register('t', async (job) => fired.push(job.id));
    await sched.start();
    sched.schedule({ id: 'ya-enviado', type: 't', runAt: e.now() + 1000 });
    sched.schedule({ id: 'futuro', type: 't', runAt: e.now() + 3600000 });
    e.advance(2000);
    await sched.runDue();
    assert.deepEqual(fired, ['ya-enviado']);
    await sched.stop();
    db.close();

    // "Reinicio del servidor"
    ({ db, sched } = e.make());
    sched.register('t', async (job) => fired.push(job.id));
    const summary = await sched.start();
    assert.equal(summary.resumed, 1);
    assert.deepEqual(fired, ['ya-enviado']); // no se reenvió
    e.advance(3600000);
    await sched.runDue();
    assert.deepEqual(fired, ['ya-enviado', 'futuro']);
    await sched.stop();
    db.close();
  } finally { cleanup(e.dir); }
});

test('scheduler: vencido dentro de la ventana de gracia se ejecuta al recuperar', async () => {
  const e = env();
  try {
    let { db, sched } = e.make();
    sched.register('t', async () => {});
    sched.schedule({ id: 'a', type: 't', runAt: e.now() + 60000, graceMs: 5 * 60000 });
    db.close();

    e.advance(3 * 60000); // el servidor estuvo caído 3 minutos
    ({ db, sched } = e.make());
    const fired = [];
    sched.register('t', async (j) => fired.push(j.id));
    const summary = await sched.start();
    assert.equal(summary.runNow, 1);
    assert.deepEqual(fired, ['a']);
    db.close();
  } finally { cleanup(e.dir); }
});

test('scheduler: vencido fuera de la ventana se marca perdido y NO se ejecuta', async () => {
  const e = env();
  try {
    let { db, sched } = e.make();
    sched.register('t', async () => {});
    sched.schedule({ id: 'a', type: 't', runAt: e.now() + 60000, graceMs: 60000 });
    db.close();

    e.advance(2 * 3600000);
    ({ db, sched } = e.make());
    const fired = [];
    const missed = [];
    sched.register('t', async (j) => fired.push(j.id));
    sched.on('missed', (j) => missed.push(j.id));
    const summary = await sched.start();
    assert.equal(summary.missed, 1);
    assert.deepEqual(fired, []);
    assert.deepEqual(missed, ['a']);
    assert.equal(sched.get('a').status, 'missed');
    db.close();
  } finally { cleanup(e.dir); }
});

test('scheduler: caída durante el envío no reenvía (estado interrupted)', async () => {
  const e = env();
  try {
    let { db, sched } = e.make();
    await sched.start();
    let release;
    const started = new Promise((r) => { release = r; });
    sched.register('t', () => new Promise(() => release())); // nunca termina: simula un crash a mitad de envío
    sched.schedule({ id: 'a', type: 't', runAt: e.now() });
    sched.runDue(); // no se espera: queda colgado
    await started;
    assert.equal(sched.get('a').status, 'sending');
    // El estado "sending" ya está en disco aunque el proceso muera ahora.

    ({ db, sched } = e.make());
    const fired = [];
    sched.register('t', async (j) => fired.push(j.id));
    const summary = await sched.start();
    assert.equal(summary.interrupted, 1);
    assert.deepEqual(fired, []);
    assert.equal(sched.get('a').status, 'interrupted');
    db.close();
  } finally { cleanup(e.dir); }
});

test('scheduler: si el handler lanza, reintenta con espera y luego queda done', async () => {
  const e = env();
  try {
    const { sched } = e.make();
    let calls = 0;
    sched.register('t', async () => { calls++; if (calls < 3) throw new Error('WhatsApp no está conectado.'); });
    await sched.start();
    sched.schedule({ id: 'a', type: 't', runAt: e.now(), graceMs: 10 * 60000 });
    await sched.runDue();
    assert.equal(sched.get('a').status, 'pending');
    assert.equal(sched.get('a').attempts, 1);
    e.advance(1000);
    await sched.runDue();
    assert.equal(sched.get('a').attempts, 2);
    e.advance(2000);
    await sched.runDue();
    assert.equal(calls, 3);
    assert.equal(sched.get('a').status, 'done');
  } finally { cleanup(e.dir); }
});

test('scheduler: agota reintentos y queda failed', async () => {
  const e = env();
  try {
    const { sched } = e.make();
    sched.register('t', async () => { throw new Error('siempre falla'); });
    const failed = [];
    sched.on('failed', (j) => failed.push(j.id));
    await sched.start();
    sched.schedule({ id: 'a', type: 't', runAt: e.now(), graceMs: 60 * 60000 });
    for (let i = 0; i < 5; i++) { await sched.runDue(); e.advance(60000); }
    assert.equal(sched.get('a').status, 'failed');
    assert.equal(sched.get('a').attempts, 3);
    assert.deepEqual(failed, ['a']);
  } finally { cleanup(e.dir); }
});

test('scheduler: tipo sin handler falla de forma controlada', async () => {
  const e = env();
  try {
    const { sched } = e.make();
    await sched.start();
    sched.schedule({ id: 'a', type: 'desconocido', runAt: e.now() });
    await sched.runDue();
    assert.equal(sched.get('a').status, 'failed');
  } finally { cleanup(e.dir); }
});

test('scheduler: cancel y cancelWhere', async () => {
  const e = env();
  try {
    const { sched } = e.make();
    sched.register('t', async () => {});
    await sched.start();
    sched.schedule({ id: 'a', type: 't', runAt: e.now() + 1000, payload: { g: 1 } });
    sched.schedule({ id: 'b', type: 't', runAt: e.now() + 1000, payload: { g: 1 } });
    sched.schedule({ id: 'c', type: 't', runAt: e.now() + 1000, payload: { g: 2 } });
    assert.equal(sched.cancel('a'), true);
    assert.equal(sched.cancel('a'), false);
    assert.equal(sched.cancelWhere((j) => j.payload.g === 1), 1);
    assert.equal(sched.pending().length, 1);
  } finally { cleanup(e.dir); }
});

test('scheduler: scheduleDaily usa el id con fecha y hora locales y programa el siguiente día', async () => {
  const e = env();
  try {
    const { sched } = e.make();
    const fired = [];
    sched.register('gdc.reminder', async (j) => fired.push(j.id));
    await sched.start();
    const { job } = sched.scheduleDaily({
      baseId: 'GDC_120363@g.us', type: 'gdc.reminder', hhmm: '19:00', tz: TZ, offsetMinutes: -10, payload: { groupId: '120363@g.us' },
    });
    assert.equal(job.id, 'GDC_120363@g.us_2026-10-04_18:50');
    // Llamarlo otra vez antes de que dispare no duplica
    sched.scheduleDaily({ baseId: 'GDC_120363@g.us', type: 'gdc.reminder', hhmm: '19:00', tz: TZ, offsetMinutes: -10 });
    assert.equal(sched.list().length, 1);

    e.setNow(job.runAt + 1000);
    await sched.runDue();
    assert.deepEqual(fired, ['GDC_120363@g.us_2026-10-04_18:50']);
    const next = sched.pending();
    assert.equal(next.length, 1);
    assert.equal(next[0].id, 'GDC_120363@g.us_2026-10-05_18:50');
  } finally { cleanup(e.dir); }
});

test('scheduler: recurrente perdido en una caída larga programa la próxima ocurrencia futura', async () => {
  const e = env();
  try {
    let { db, sched } = e.make();
    sched.register('r', async () => {});
    sched.scheduleDaily({ baseId: 'R', type: 'r', hhmm: '19:00', tz: TZ, graceMs: 60000 });
    db.close();
    e.advance(3 * 24 * 3600000); // 3 días caído
    ({ db, sched } = e.make());
    const fired = [];
    sched.register('r', async (j) => fired.push(j.id));
    await sched.start();
    assert.deepEqual(fired, []);
    assert.equal(sched.pending().length, 1);
    assert.ok(sched.pending()[0].runAt > e.now());
    db.close();
  } finally { cleanup(e.dir); }
});

test('scheduler: espera larga se trocea al máximo de setTimeout', async () => {
  const e = env();
  try {
    const { sched, db } = e.make();
    sched.register('t', async () => {});
    await sched.start();
    e.timers.length = 0;
    sched.schedule({ id: 'lejano', type: 't', runAt: e.now() + 90 * 24 * 3600000 });
    assert.equal(e.timers.at(-1).ms, MAX_TIMEOUT_MS);
    db.close();
  } finally { cleanup(e.dir); }
});

test('scheduler: stop cancela el temporizador y espera handlers en vuelo', async () => {
  const e = env();
  try {
    const { sched } = e.make();
    let finished = false;
    sched.register('t', async () => { await new Promise((r) => setTimeout(r, 30)); finished = true; });
    await sched.start();
    sched.schedule({ id: 'a', type: 't', runAt: e.now() });
    const running = sched.runDue();
    await new Promise((r) => setImmediate(r));
    await sched.stop();
    assert.equal(finished, true);
    await running;
    assert.equal(e.timers.at(-1).cleared, true);
  } finally { cleanup(e.dir); }
});

test('scheduler: valida argumentos y limpia terminados antiguos', async () => {
  const e = env();
  try {
    const { sched } = e.make();
    assert.throws(() => sched.schedule({ type: 't', runAt: 1 }), /id/);
    assert.throws(() => sched.schedule({ id: 'a', runAt: 1 }), /tipo/);
    assert.throws(() => sched.schedule({ id: 'a', type: 't', runAt: 'x' }), /runAt/);
    assert.throws(() => sched.register('t', null), /función/);
    sched.register('t', async () => {});
    await sched.start();
    sched.schedule({ id: 'viejo', type: 't', runAt: e.now() });
    await sched.runDue();
    e.advance(8 * 24 * 3600000);
    sched._prune();
    assert.equal(sched.get('viejo'), null);
  } finally { cleanup(e.dir); }
});

test('scheduler: un trabajo cancelado puede reprogramarse con el mismo id; uno terminado no', async () => {
  const e = env();
  try {
    const { sched } = e.make();
    const fired = [];
    sched.register('t', async (job) => fired.push(job.id));
    await sched.start();
    sched.schedule({ id: 'c', type: 't', runAt: e.now() + 5000 });
    assert.equal(sched.cancel('c'), true);
    assert.equal(sched.pending().length, 0);
    const again = sched.schedule({ id: 'c', type: 't', runAt: e.now() + 5000 });
    assert.equal(again.created, true);
    assert.equal(sched.pending().length, 1);
    e.advance(6000);
    await sched.runDue();
    assert.deepEqual(fired, ['c']);
    // Ya ejecutado: reprogramar el mismo id no lo repite (idempotencia)
    assert.equal(sched.schedule({ id: 'c', type: 't', runAt: e.now() + 1000 }).created, false);
    e.advance(2000);
    await sched.runDue();
    assert.deepEqual(fired, ['c']);
  } finally { e.dir && require('./helpers').cleanup(e.dir); }
});
