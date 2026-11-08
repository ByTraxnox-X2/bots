'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const jid = require('../src/whatsapp/jid');
const { WhatsAppConnection } = require('../src/whatsapp/connection');
const { Backoff } = require('../src/utils/backoff');
const { buildConfig } = require('../src/config');
const { tmpDir, cleanup } = require('./helpers');

// ---------- jid ----------

test('jid: decode/normalize quitan sufijo de dispositivo', () => {
  assert.equal(jid.normalize('593990192338:12@s.whatsapp.net'), '593990192338@s.whatsapp.net');
  assert.equal(jid.normalize('basura'), '');
  assert.equal(jid.normalize(''), '');
  assert.equal(jid.normalize(undefined), '');
});

test('jid: tipos', () => {
  assert.equal(jid.isGroup('120363@g.us'), true);
  assert.equal(jid.isGroup('1@s.whatsapp.net'), false);
  assert.equal(jid.isLid('99@lid'), true);
  assert.equal(jid.isUser('1@s.whatsapp.net'), true);
});

test('jid: toNumber solo para usuarios con teléfono', () => {
  assert.equal(jid.toNumber('593990192338:3@s.whatsapp.net'), '593990192338');
  assert.equal(jid.toNumber('99@lid'), '');
  assert.equal(jid.toNumber('120363@g.us'), '');
});

test('jid: fromNumber valida longitud y limpia símbolos', () => {
  assert.equal(jid.fromNumber('+593 99-019-2338'), '593990192338@s.whatsapp.net');
  assert.equal(jid.fromNumber('123'), '');
  assert.equal(jid.fromNumber('1234567890123456'), '');
});

test('jid: sameUser y mentionTag', () => {
  assert.equal(jid.sameUser('1234567890:5@s.whatsapp.net', '1234567890@s.whatsapp.net'), true);
  assert.equal(jid.sameUser('', ''), false);
  assert.equal(jid.mentionTag('593990192338@s.whatsapp.net'), '@593990192338');
});

// ---------- conexión con Baileys simulado ----------

const DisconnectReason = { loggedOut: 401, badSession: 500, restartRequired: 515, connectionClosed: 428 };

function makeFakeBaileys({ registered = true } = {}) {
  const created = [];
  const api = {
    created,
    makeWASocket() {
      const sock = {
        ev: new EventEmitter(),
        user: { id: '593991111111:7@s.whatsapp.net' },
        ended: false,
        pairingFor: null,
        end() { this.ended = true; },
        async requestPairingCode(phone) { this.pairingFor = phone; return 'ABCD1234'; },
        async sendMessage(to, content) { return { to, content }; },
        async groupMetadata(j) { return { id: j }; },
        async groupParticipantsUpdate(g, list, action) { return list.map((j) => ({ status: '200', jid: j, action })); },
      };
      created.push(sock);
      return sock;
    },
    async useMultiFileAuthState() {
      return { state: { creds: { registered } }, saveCreds: async () => {} };
    },
    DisconnectReason,
    async fetchLatestBaileysVersion() { return { version: [2, 3000, 1] }; },
    Browsers: { ubuntu: (n) => ['Ubuntu', n, '1.0'] },
  };
  return api;
}

function silentLogger() {
  const l = { debug() {}, info() {}, warn() {}, error() {}, child() { return l; } };
  return l;
}

function setup(extraEnv = {}, fakeOpts = {}) {
  const dir = tmpDir();
  const config = buildConfig({ DATA_DIR: dir, SESSION_DIR: path.join(dir, 'session'), ...extraEnv }, dir);
  const fake = makeFakeBaileys(fakeOpts);
  const timers = [];
  const conn = new WhatsAppConnection({
    config,
    logger: silentLogger(),
    loadBaileys: async () => fake,
    backoff: new Backoff({ baseMs: 1000, maxMs: 8000, jitter: 0, maxAttempts: 3 }),
    setTimer: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; },
    clearTimer: (t) => { t.cleared = true; },
  });
  return { dir, config, fake, conn, timers };
}

const tick = () => new Promise((r) => setImmediate(r));

test('conexión: abre y detecta su propio JID dinámicamente', async () => {
  const { dir, fake, conn } = setup();
  try {
    await conn.start();
    fake.created[0].ev.emit('connection.update', { connection: 'open' });
    await tick();
    assert.equal(conn.state, 'open');
    assert.equal(conn.selfJid, '593991111111@s.whatsapp.net');
    assert.equal(conn.selfNumber, '593991111111');
  } finally { cleanup(dir); }
});

test('conexión: reenvía mensajes y eventos de grupo', async () => {
  const { dir, fake, conn } = setup();
  try {
    await conn.start();
    const got = [];
    conn.on('message', (m) => got.push(['m', m]));
    conn.on('group-participants', (g) => got.push(['g', g]));
    fake.created[0].ev.emit('messages.upsert', { messages: [] });
    fake.created[0].ev.emit('group-participants.update', { id: 'x@g.us' });
    assert.equal(got.length, 2);
  } finally { cleanup(dir); }
});

test('conexión: reconecta con backoff y lo reinicia al abrir', async () => {
  const { dir, fake, conn, timers } = setup();
  try {
    await conn.start();
    fake.created[0].ev.emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: { output: { statusCode: 428 }, message: 'cerrada' } },
    });
    await tick();
    assert.equal(timers.at(-1).ms, 1000);
    await timers.at(-1).fn();
    await tick();
    assert.equal(fake.created.length, 2);
    fake.created[1].ev.emit('connection.update', { connection: 'open' });
    await tick();
    assert.equal(conn.backoff.attempts, 0);
  } finally { cleanup(dir); }
});

test('conexión: reconexión inmediata en restartRequired (515)', async () => {
  const { dir, fake, conn, timers } = setup();
  try {
    await conn.start();
    fake.created[0].ev.emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: { output: { statusCode: 515 }, message: 'restart' } },
    });
    await tick();
    assert.equal(timers.at(-1).ms, 500);
    assert.equal(conn.backoff.attempts, 0);
  } finally { cleanup(dir); }
});

test('conexión: logged out no reconecta', async () => {
  const { dir, fake, conn, timers } = setup();
  try {
    await conn.start();
    const events = [];
    conn.on('logged-out', () => events.push('logged-out'));
    conn.on('close', (c) => events.push(['close', c.willReconnect]));
    const before = timers.length;
    fake.created[0].ev.emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: { output: { statusCode: 401 }, message: 'out' } },
    });
    await tick();
    assert.equal(conn.state, 'logged-out');
    assert.equal(timers.length, before);
    assert.deepEqual(events, ['logged-out', ['close', false]]);
  } finally { cleanup(dir); }
});

test('conexión: se detiene tras agotar intentos y emite fatal', async () => {
  const { dir, fake, conn } = setup();
  try {
    await conn.start();
    let fatal = null;
    conn.on('fatal', (e) => { fatal = e; });
    for (let i = 0; i < 4; i++) {
      const sock = fake.created.at(-1);
      sock.ev.emit('connection.update', {
        connection: 'close',
        lastDisconnect: { error: { output: { statusCode: 428 }, message: 'x' } },
      });
      await tick();
      if (i < 3) {
        // ejecutar el reintento programado
        await conn._connect();
      }
    }
    assert.ok(fatal);
    assert.equal(conn.state, 'closed');
  } finally { cleanup(dir); }
});

test('conexión: sin sesión pide pairing code con BOT_PHONE', async () => {
  const { dir, fake, conn, timers } = setup({ BOT_PHONE: '593991111111' }, { registered: false });
  try {
    const codes = [];
    conn.on('pairing-code', (c) => codes.push(c));
    const starting = conn.start();
    await tick();
    // liberar la espera de 3s del pairing
    timers.find((t) => t.ms === 3000).fn();
    await starting;
    assert.equal(fake.created[0].pairingFor, '593991111111');
    assert.deepEqual(codes, ['ABCD-1234']);
  } finally { cleanup(dir); }
});

test('conexión: sin sesión y sin BOT_PHONE emite fatal claro', async () => {
  const { dir, conn } = setup({}, { registered: false });
  try {
    let err = null;
    conn.on('fatal', (e) => { err = e; });
    await conn.start();
    assert.match(err.message, /BOT_PHONE/);
  } finally { cleanup(dir); }
});

test('conexión: acciones fallan si no está conectado y funcionan si lo está', async () => {
  const { dir, fake, conn } = setup();
  try {
    await conn.start();
    await assert.rejects(() => conn.sendText('x@s.whatsapp.net', 'hola'), /no está conectado/);
    fake.created[0].ev.emit('connection.update', { connection: 'open' });
    await tick();
    const sent = await conn.sendText('x@g.us', 'hola @a', { mentions: ['a@s.whatsapp.net'] });
    assert.deepEqual(sent.content.mentions, ['a@s.whatsapp.net']);
    const res = await conn.removeParticipants('x@g.us', ['b@s.whatsapp.net']);
    assert.equal(res[0].action, 'remove');
  } finally { cleanup(dir); }
});

test('conexión: stop cancela reconexión y cierra socket', async () => {
  const { dir, fake, conn, timers } = setup();
  try {
    await conn.start();
    fake.created[0].ev.emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: { output: { statusCode: 428 }, message: 'x' } },
    });
    await tick();
    await conn.stop();
    assert.equal(timers.at(-1).cleared, true);
    assert.equal(conn.state, 'closed');
  } finally { cleanup(dir); }
});
