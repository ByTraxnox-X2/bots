'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { UserService, UserError, xpForLevel, levelForXp, progress, sanitizeName, pickPrimary, MAX_LEVEL } = require('../src/services/users');
const { EventBus, EVENTS } = require('../src/events/bus');
const { Database } = require('../src/database');
const { buildConfig } = require('../src/config');
const { tmpDir, cleanup } = require('./helpers');

const A = '593991111111@s.whatsapp.net';
const B = '593992222222@s.whatsapp.net';

function env(extraEnv = {}) {
  const dir = tmpDir();
  let t = 1_700_000_000_000;
  const file = path.join(dir, 'db.json');
  const config = buildConfig({ ...extraEnv }, dir);
  const bus = new EventBus();
  const events = [];
  for (const e of Object.values(EVENTS)) bus.on(e, (p) => events.push([e, p]));
  const open = () => new Database({ file, saveDebounceMs: 0 }).load();
  const db = open();
  const users = new UserService({ db, config, bus, now: () => t });
  return { dir, db, users, events, advance: (ms) => { t += ms; }, reopen: () => { db.close(); const d2 = open(); return { db: d2, users: new UserService({ db: d2, config, bus, now: () => t }) }; } };
}

// ---------- fórmulas ----------

test('niveles: fórmula, límites y consistencia', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(xpForLevel), [0, 100, 300, 600, 1000]);
  assert.equal(levelForXp(0), 1);
  assert.equal(levelForXp(99), 1);
  assert.equal(levelForXp(100), 2);
  assert.equal(levelForXp(299), 2);
  assert.equal(levelForXp(300), 3);
  assert.equal(levelForXp(-50), 1);
  assert.equal(levelForXp('abc'), 1);
  assert.equal(levelForXp(1e12), MAX_LEVEL);
  for (let l = 1; l <= MAX_LEVEL; l++) {
    assert.equal(levelForXp(xpForLevel(l)), l, `nivel ${l} en su umbral exacto`);
    if (l > 1) assert.equal(levelForXp(xpForLevel(l) - 1), l - 1, `nivel ${l - 1} justo antes del umbral`);
  }
});

test('niveles: progreso dentro del nivel', () => {
  assert.deepEqual(progress({ xp: 150 }), { level: 2, xp: 150, into: 50, needed: 200, remaining: 150, percent: 25, atMax: false });
  const max = progress({ xp: xpForLevel(MAX_LEVEL) + 10 });
  assert.equal(max.atMax, true);
  assert.equal(max.percent, 100);
  assert.equal(max.remaining, 0);
});

test('nombres: se limpian caracteres de control y marcas de formato', () => {
  assert.equal(sanitizeName('  *Juan*_Pérez~  '), 'JuanPérez');
  assert.equal(sanitizeName('a\u0000b‮c'), 'abc');
  assert.equal(sanitizeName('x'.repeat(100)).length, 25);
  assert.equal(sanitizeName('   '), 'Jugador');
  assert.equal(sanitizeName(undefined, 'Anon'), 'Anon');
  assert.equal(sanitizeName('@todos'), 'todos');
});

test('identidad principal: prefiere JID de teléfono sobre @lid', () => {
  assert.equal(pickPrimary(['99@lid', A]), A);
  assert.equal(pickPrimary(['99@lid']), '99@lid');
  assert.equal(pickPrimary([]), '');
  assert.equal(pickPrimary(['basura']), '');
});

// ---------- registro ----------

test('registro: crea el perfil con todos los campos y da la recompensa una sola vez', () => {
  const e = env();
  try {
    const r = e.users.register({ identities: [A], name: 'Ana' });
    assert.equal(r.created, true);
    assert.deepEqual(r.reward, { coins: 100, xp: 50 });
    const u = r.user;
    assert.equal(u.jid, A);
    assert.equal(u.number, '593991111111');
    assert.equal(u.name, 'Ana');
    assert.equal(u.level, 1);
    assert.equal(u.xp, 50);
    assert.equal(u.coins, 100);
    assert.equal(u.ffUid, null);
    assert.deepEqual(u.stats, { wins: 0, losses: 0, matches: 0 });
    assert.equal(u.elo, 1000);
    assert.deepEqual([u.achievements, u.titles], [[], []]);
    assert.ok(u.registeredAt && u.lastActivity);

    const again = e.users.register({ identities: [A], name: 'Otro nombre' });
    assert.equal(again.created, false);
    assert.equal(again.reward, null);
    assert.equal(again.user.coins, 100, 'no se regalan monedas otra vez');
    assert.equal(again.user.name, 'Ana');
    assert.equal(e.events.filter(([n]) => n === EVENTS.userRegistered).length, 1);
  } finally { cleanup(e.dir); }
});

test('registro: nombre por defecto a partir del número y recompensas configurables', () => {
  const e = env({ REGISTER_BONUS_COINS: '0', REGISTER_BONUS_XP: '0' });
  try {
    const r = e.users.register({ identities: [A], name: '' });
    assert.equal(r.user.name, 'Jugador1111');
    assert.equal(r.user.coins, 0);
    assert.equal(r.user.xp, 0);
  } finally { cleanup(e.dir); }
});

test('registro: persiste tras recargar y se encuentra por cualquier identificador', () => {
  const e = env();
  try {
    e.users.register({ identities: [A, '555@lid'], name: 'Ana' });
    const { users } = e.reopen();
    assert.equal(users.isRegistered([A]), true);
    assert.equal(users.find(['999@lid', A]).name, 'Ana');
    assert.equal(users.isRegistered([B]), false);
    assert.equal(users.count(), 1);
  } finally { cleanup(e.dir); }
});

test('registro: JID inválido se rechaza con mensaje claro', () => {
  const e = env();
  try {
    assert.throws(() => e.users.register({ identities: ['basura'], name: 'x' }), (err) => err instanceof UserError && err.code === 'INVALID_JID');
    assert.throws(() => e.users.require([B]), (err) => err.code === 'NOT_REGISTERED' && /\.registro/.test(err.message));
  } finally { cleanup(e.dir); }
});

// ---------- actividad y XP ----------

test('actividad: actualiza contadores y concede XP como máximo una vez por cooldown (anti-farm)', () => {
  const e = env();
  try {
    e.users.register({ identities: [A], name: 'Ana' });
    const xp0 = e.users.find([A]).xp;
    const first = e.users.recordActivity([A], { kind: 'message' });
    assert.equal(first.xpGained, 5);
    for (let i = 0; i < 20; i++) assert.equal(e.users.recordActivity([A], { kind: 'message' }).xpGained, 0);
    assert.equal(e.users.find([A]).xp, xp0 + 5, 'spamear mensajes no da más XP');
    assert.equal(e.users.find([A]).activity.messages, 21);
    e.advance(61_000);
    assert.equal(e.users.recordActivity([A], { kind: 'command' }).xpGained, 5);
    assert.equal(e.users.find([A]).activity.commands, 1);
    assert.equal(e.users.find([A]).lastActivity, new Date(1_700_000_000_000 + 61_000).toISOString());
  } finally { cleanup(e.dir); }
});

test('actividad: ignora a no registrados y actualiza el nombre solo si era el genérico', () => {
  const e = env();
  try {
    assert.deepEqual(e.users.recordActivity([B]), { xpGained: 0, levelUps: [] });
    assert.equal(e.users.count(), 0, 'no crea usuarios');
    e.users.register({ identities: [A], name: '' });
    e.users.recordActivity([A], { name: 'Ana Real' });
    assert.equal(e.users.find([A]).name, 'Ana Real');
    e.users.recordActivity([A], { name: 'Otro' });
    assert.equal(e.users.find([A]).name, 'Ana Real');
  } finally { cleanup(e.dir); }
});

test('XP: subir de nivel entrega monedas por cada nivel y emite levelUp', () => {
  const e = env();
  try {
    e.users.register({ identities: [A], name: 'Ana' }); // 50 xp, 100 monedas
    const r = e.users.addXp([A], 260, 'prueba'); // 310 xp => nivel 3 (100 y 300)
    assert.equal(r.level, 3);
    assert.deepEqual(r.levelUps, [{ level: 2, coins: 50 }, { level: 3, coins: 75 }]);
    assert.equal(e.users.find([A]).coins, 100 + 50 + 75);
    const ups = e.events.filter(([n]) => n === EVENTS.levelUp);
    assert.deepEqual(ups.map(([, p]) => p.level), [2, 3]);
    assert.equal(e.users.progress([A]).level, 3);
  } finally { cleanup(e.dir); }
});

test('XP: valida cantidades y exige registro', () => {
  const e = env();
  try {
    e.users.register({ identities: [A], name: 'Ana' });
    for (const bad of [0, -5, 1.5, NaN, '10', null, Infinity]) {
      assert.throws(() => e.users.addXp([A], bad), (err) => err.code === 'INVALID_AMOUNT', String(bad));
    }
    assert.throws(() => e.users.addXp([B], 10), (err) => err.code === 'NOT_REGISTERED');
  } finally { cleanup(e.dir); }
});

// ---------- monedas ----------

test('monedas: sumar, gastar, saldo insuficiente y registro de movimientos', () => {
  const e = env();
  try {
    e.users.register({ identities: [A], name: 'Ana' });
    assert.equal(e.users.addCoins([A], 50, 'regalo'), 150);
    assert.equal(e.users.spendCoins([A], 120, 'tienda'), 30);
    assert.throws(() => e.users.spendCoins([A], 31), (err) => err.code === 'INSUFFICIENT_FUNDS' && /tienes 30/.test(err.message));
    assert.equal(e.users.find([A]).coins, 30, 'un gasto fallido no cambia el saldo');
    assert.throws(() => e.users.spendCoins([A], -1), (err) => err.code === 'INVALID_AMOUNT');
    const log = e.db.col('history').filter((h) => h.type === 'coins');
    assert.deepEqual(log.map((h) => [h.delta, h.reason]), [[100, 'registro'], [50, 'regalo'], [-120, 'tienda']]);
    assert.equal(log.at(-1).balance, 30);
  } finally { cleanup(e.dir); }
});

test('monedas: el saldo nunca supera el máximo seguro', () => {
  const e = env();
  try {
    e.users.register({ identities: [A], name: 'Ana' });
    e.users.addCoins([A], 1e12, 'x');
    assert.equal(e.users.addCoins([A], 1e12, 'x'), 1e12);
  } finally { cleanup(e.dir); }
});

// ---------- vincular Free Fire ----------

test('Free Fire: vincular guarda UID, región y snapshot; desvincular los limpia', () => {
  const e = env();
  try {
    e.users.register({ identities: [A], name: 'Ana' });
    const u = e.users.linkFreeFire([A], { uid: '123456789', region: 'sa', verified: true, snapshot: { nickname: 'Pro', fetchedAt: 1 } });
    assert.deepEqual([u.ffUid, u.ffRegion, u.ffVerified], ['123456789', 'sa', true]);
    assert.equal(u.ffSnapshot.nickname, 'Pro');
    assert.equal(e.users.findByFfUid('123456789').jid, A);
    assert.equal(e.users.unlinkFreeFire([A]), '123456789');
    const after = e.users.find([A]);
    assert.deepEqual([after.ffUid, after.ffRegion, after.ffVerified, after.ffSnapshot], [null, null, false, null]);
    assert.throws(() => e.users.unlinkFreeFire([A]), (err) => err.code === 'NOT_LINKED');
    assert.deepEqual(e.events.filter(([n]) => [EVENTS.userLinked, EVENTS.userUnlinked].includes(n)).map(([n]) => n), [EVENTS.userLinked, EVENTS.userUnlinked]);
  } finally { cleanup(e.dir); }
});

test('Free Fire: un UID no puede estar en dos usuarios, pero el mismo usuario puede re-vincularlo', () => {
  const e = env();
  try {
    e.users.register({ identities: [A], name: 'Ana' });
    e.users.register({ identities: [B], name: 'Beto' });
    e.users.linkFreeFire([A], { uid: '123456789' });
    assert.throws(() => e.users.linkFreeFire([B], { uid: '123456789' }), (err) => err.code === 'UID_TAKEN');
    e.users.linkFreeFire([A], { uid: '123456789', region: 'br' });
    assert.equal(e.users.find([A]).ffRegion, 'br');
    e.users.unlinkFreeFire([A]);
    e.users.linkFreeFire([B], { uid: '123456789' });
    assert.equal(e.users.find([B]).ffUid, '123456789');
  } finally { cleanup(e.dir); }
});

test('Free Fire: sin verificar queda marcado como no verificado; updateSnapshot lo verifica', () => {
  const e = env();
  try {
    e.users.register({ identities: [A], name: 'Ana' });
    assert.throws(() => e.users.updateSnapshot([A], { snapshot: {} }), (err) => err.code === 'NOT_LINKED');
    e.users.linkFreeFire([A], { uid: '123456789' });
    assert.equal(e.users.find([A]).ffVerified, false);
    e.users.updateSnapshot([A], { region: 'sa', snapshot: { nickname: 'X' } });
    const u = e.users.find([A]);
    assert.deepEqual([u.ffVerified, u.ffRegion], [true, 'sa']);
    e.users.updateSnapshot([A], { region: 'us', snapshot: { nickname: 'Y' } });
    assert.equal(e.users.find([A]).ffRegion, 'sa', 'no se pisa una región ya guardada');
  } finally { cleanup(e.dir); }
});
