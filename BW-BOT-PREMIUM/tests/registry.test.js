'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { CommandRegistry, validateDefinition, CATEGORIES } = require('../src/commands/registry');
const { PermissionService, ROLES, roleLevel, hasRole } = require('../src/middleware/permissions');
const { RateLimiter, CommandLimiter } = require('../src/middleware/ratelimit');
const { EventBus, EVENTS } = require('../src/events/bus');
const v = require('../src/utils/validators');
const { Database } = require('../src/database');
const { buildConfig } = require('../src/config');
const { tmpDir, cleanup } = require('./helpers');

function def(over = {}) {
  return {
    name: 'prueba',
    aliases: ['test'],
    description: 'Comando de prueba',
    usage: '.prueba',
    example: '.prueba',
    category: 'general',
    permissions: 'USER',
    cooldown: 0,
    handler: async () => {},
    ...over,
  };
}

// ---------- registry ----------

test('registry: registra y resuelve por nombre y alias (sin importar mayúsculas)', () => {
  const r = new CommandRegistry();
  r.register(def());
  assert.equal(r.get('prueba').name, 'prueba');
  assert.equal(r.get('TEST').name, 'prueba');
  assert.equal(r.get('nada'), null);
  assert.equal(r.has('test'), true);
  assert.equal(r.size, 1);
});

test('registry: rechaza duplicados de nombre y conflictos de alias', () => {
  const r = new CommandRegistry();
  r.register(def());
  assert.throws(() => r.register(def()), /Conflicto/);
  assert.throws(() => r.register(def({ name: 'otro', aliases: ['test'] })), /Conflicto/);
  assert.throws(() => r.register(def({ name: 'test', aliases: [] })), /Conflicto/);
  assert.equal(r.size, 1);
});

test('registry: un registro fallido no deja rastro parcial', () => {
  const r = new CommandRegistry();
  r.register(def());
  assert.throws(() => r.register(def({ name: 'nuevo', aliases: ['alias-ok', 'test'].map((a) => a.replace('-', '')) })));
  assert.equal(r.has('nuevo'), false);
  assert.equal(r.has('aliasok'), false);
});

const INVALID = [
  ['sin nombre', { name: undefined }, /nombre/],
  ['nombre con prefijo', { name: '.menu' }, /nombre/],
  ['nombre en mayúsculas', { name: 'Menu' }, /nombre/],
  ['alias igual al nombre', { aliases: ['prueba'] }, /repite el nombre/],
  ['aliases repetidos', { aliases: ['a1', 'a1'] }, /repetidos/],
  ['alias inválido', { aliases: ['con espacio'] }, /alias inválido/],
  ['sin descripción', { description: '' }, /description/],
  ['sin uso', { usage: undefined }, /usage/],
  ['sin ejemplo', { example: '' }, /example/],
  ['categoría inválida', { category: 'inventada' }, /categoría/],
  ['permiso inválido', { permissions: 'REY' }, /permissions/],
  ['cooldown negativo', { cooldown: -1 }, /cooldown/],
  ['cooldown no numérico', { cooldown: 'x' }, /cooldown/],
  ['sin handler', { handler: undefined }, /handler/],
  ['scope inválido', { scope: 'canal' }, /scope/],
  ['requiresRegistration no booleano', { requiresRegistration: 'si' }, /requiresRegistration/],
];
for (const [name, over, re] of INVALID) {
  test(`registry: rechaza definición ${name}`, () => {
    const errors = validateDefinition(def(over));
    assert.ok(errors.some((e) => re.test(e)), errors.join(' | '));
    assert.throws(() => new CommandRegistry().register(def(over)));
  });
}

test('registry: la definición registrada es inmutable y trae valores por defecto', () => {
  const r = new CommandRegistry();
  const d = r.register(def({ aliases: undefined }));
  assert.equal(d.scope, 'any');
  assert.equal(d.requiresRegistration, false);
  assert.deepEqual([...d.aliases], []);
  assert.ok(Object.isFrozen(d));
});

test('registry: list ordena y byCategory agrupa', () => {
  const r = new CommandRegistry();
  r.register(def({ name: 'zeta', aliases: [], category: 'tools' }));
  r.register(def({ name: 'alfa', aliases: [], category: 'general' }));
  r.register(def({ name: 'beta', aliases: [], category: 'general' }));
  assert.deepEqual(r.list().map((c) => c.name), ['alfa', 'beta', 'zeta']);
  assert.deepEqual(Object.keys(r.byCategory()).sort(), ['general', 'tools']);
  assert.ok(CATEGORIES.includes('freefire'));
});

// ---------- permisos ----------

function permEnv() {
  const dir = tmpDir();
  const db = new Database({ file: path.join(dir, 'db.json'), saveDebounceMs: 0 }).load();
  const config = buildConfig({ OWNER_NUMBER: '593990192338' }, dir);
  return { dir, db, perms: new PermissionService({ db, config }) };
}

test('permisos: jerarquía de roles', () => {
  assert.deepEqual([...ROLES], ['USER', 'MOD', 'ADMIN', 'SUPERADMIN', 'OWNER']);
  assert.equal(hasRole('OWNER', 'ADMIN'), true);
  assert.equal(hasRole('ADMIN', 'ADMIN'), true);
  assert.equal(hasRole('MOD', 'ADMIN'), false);
  assert.equal(hasRole('USER', 'USER'), true);
  assert.equal(hasRole('USER', 'inexistente'), false);
  assert.equal(roleLevel('x'), -1);
});

test('permisos: el OWNER se detecta por número, incluso con sufijo de dispositivo', () => {
  const { dir, perms } = permEnv();
  try {
    assert.equal(perms.resolve(['593990192338@s.whatsapp.net']).role, 'OWNER');
    assert.equal(perms.resolve(['593990192338:12@s.whatsapp.net']).role, 'OWNER');
    // Un @lid solo es OWNER si también llega su JID de teléfono
    assert.equal(perms.resolve(['999@lid']).role, 'USER');
    assert.equal(perms.resolve(['999@lid', '593990192338@s.whatsapp.net']).role, 'OWNER');
    assert.equal(perms.resolve(['593990192339@s.whatsapp.net']).role, 'USER');
  } finally { cleanup(dir); }
});

test('permisos: roles guardados y admin de grupo', () => {
  const { dir, perms } = permEnv();
  try {
    const u = '593991111111@s.whatsapp.net';
    assert.equal(perms.resolve([u]).role, 'USER');
    perms.setRole(u, 'MOD');
    assert.equal(perms.resolve([u]).role, 'MOD');
    assert.equal(perms.resolve([u], { isGroupAdmin: true }).role, 'ADMIN');
    perms.setRole(u, 'SUPERADMIN');
    assert.equal(perms.resolve([u], { isGroupAdmin: true }).role, 'SUPERADMIN');
    perms.setRole(u, 'USER');
    assert.equal(perms.resolve([u]).role, 'USER');
  } finally { cleanup(dir); }
});

test('permisos: el rol guardado por @lid se reconoce si llega junto al JID de teléfono', () => {
  const { dir, perms } = permEnv();
  try {
    perms.setRole('777@lid', 'ADMIN');
    assert.equal(perms.resolve(['777@lid', '593991111111@s.whatsapp.net']).role, 'ADMIN');
  } finally { cleanup(dir); }
});

test('permisos: baneos, y el OWNER no puede ser baneado ni degradado', () => {
  const { dir, perms } = permEnv();
  try {
    const u = '593991111111@s.whatsapp.net';
    perms.setBanned(u, true, { reason: 'spam' });
    assert.equal(perms.resolve([u]).banned, true);
    assert.equal(perms.getRecord(u).bannedReason, 'spam');
    perms.setBanned(u, false);
    assert.equal(perms.resolve([u]).banned, false);
    assert.equal(perms.getRecord(u).bannedReason, '');
    assert.throws(() => perms.setBanned('593990192338@s.whatsapp.net', true), /OWNER/);
    assert.throws(() => perms.setRole('593990192338@s.whatsapp.net', 'ADMIN'), /OWNER/);
    assert.throws(() => perms.setRole(u, 'OWNER'), /no asignable/);
    assert.throws(() => perms.setRole('basura', 'ADMIN'), /inválido/);
  } finally { cleanup(dir); }
});

test('permisos: persisten tras recargar la base de datos', () => {
  const { dir, db, perms } = permEnv();
  try {
    perms.setRole('593991111111@s.whatsapp.net', 'ADMIN');
    db.close();
    const db2 = new Database({ file: path.join(dir, 'db.json'), saveDebounceMs: 0 }).load();
    const perms2 = new PermissionService({ db: db2, config: buildConfig({}, dir) });
    assert.equal(perms2.resolve(['593991111111@s.whatsapp.net']).role, 'ADMIN');
  } finally { cleanup(dir); }
});

// ---------- rate limit ----------

test('ratelimit: ventana fija, aviso único y reinicio al terminar la ventana', () => {
  let t = 1000;
  const rl = new RateLimiter({ now: () => t });
  assert.equal(rl.hit('k', 2, 1000).allowed, true);
  assert.equal(rl.hit('k', 2, 1000).allowed, true);
  const third = rl.hit('k', 2, 1000);
  assert.equal(third.allowed, false);
  assert.equal(third.notify, true);
  assert.equal(third.retryAfterMs, 1000);
  const fourth = rl.hit('k', 2, 1000);
  assert.equal(fourth.allowed, false);
  assert.equal(fourth.notify, false, 'no se avisa dos veces en la misma ventana');
  t += 1000;
  assert.equal(rl.hit('k', 2, 1000).allowed, true);
});

test('ratelimit: cooldown y limpieza de entradas caducadas', () => {
  let t = 0;
  const rl = new RateLimiter({ now: () => t });
  rl.setCooldown('c', 5000);
  assert.equal(rl.cooldownLeft('c'), 5000);
  t = 4000;
  assert.equal(rl.cooldownLeft('c'), 1000);
  t = 6000;
  assert.equal(rl.cooldownLeft('c'), 0);
  rl.hit('a', 1, 100);
  rl.setCooldown('b', 100);
  t = 100000;
  rl.cleanup();
  assert.equal(rl.size, 0);
  rl.setCooldown('z', 0);
  assert.equal(rl.size, 0, 'un cooldown de 0 no se guarda');
});

test('ratelimit: la limpieza automática evita crecer sin límite', () => {
  let t = 0;
  const rl = new RateLimiter({ now: () => t, maxEntries: 50 });
  for (let i = 0; i < 40; i++) rl.hit(`k${i}`, 1, 10);
  t = 1000;
  for (let i = 0; i < 40; i++) rl.hit(`n${i}`, 1, 10);
  assert.ok(rl.size <= 50 + 1);
});

function limiterEnv(extra = {}) {
  let t = 0;
  const config = buildConfig({ RATE_LIMIT_USER_MAX: '3', RATE_LIMIT_USER_WINDOW: '10', RATE_LIMIT_GROUP_MAX: '5', RATE_LIMIT_GROUP_WINDOW: '10', ...extra }, '/x');
  const limiter = new CommandLimiter({ config, limiter: new RateLimiter({ now: () => t }) });
  return { limiter, advance: (ms) => { t += ms; } };
}

test('limiter: por usuario, aviso único y OWNER exento', () => {
  const { limiter } = limiterEnv();
  const base = { userKey: 'u1', command: 'x', cooldownSec: 0 };
  for (let i = 0; i < 3; i++) assert.equal(limiter.check(base).allowed, true);
  const denied = limiter.check(base);
  assert.deepEqual([denied.allowed, denied.reason, denied.notify], [false, 'user', true]);
  assert.equal(limiter.check(base).notify, false);
  for (let i = 0; i < 20; i++) assert.equal(limiter.check({ ...base, isOwner: true }).allowed, true);
  assert.equal(limiter.check({ ...base, userKey: 'u2' }).allowed, true);
});

test('limiter: por grupo (varios usuarios) y reinicio de ventana', () => {
  const { limiter, advance } = limiterEnv();
  let allowed = 0;
  for (let i = 0; i < 8; i++) if (limiter.check({ userKey: `u${i}`, groupKey: 'g1', command: 'x' }).allowed) allowed++;
  assert.equal(allowed, 5);
  const r = limiter.check({ userKey: 'nuevo', groupKey: 'g1', command: 'x' });
  assert.equal(r.reason, 'group');
  advance(10000);
  assert.equal(limiter.check({ userKey: 'nuevo2', groupKey: 'g1', command: 'x' }).allowed, true);
});

test('limiter: cooldown por comando y usuario, con aviso único', () => {
  // Ventana de usuario amplia: aquí solo se prueba el cooldown (los intentos rechazados también cuentan en la ventana).
  const { limiter, advance } = limiterEnv({ RATE_LIMIT_USER_MAX: '50', RATE_LIMIT_GROUP_MAX: '50' });
  const base = { userKey: 'u1', command: 'daily', cooldownSec: 5 };
  assert.equal(limiter.check(base).allowed, true);
  const d1 = limiter.check(base);
  assert.deepEqual([d1.allowed, d1.reason, d1.notify], [false, 'cooldown', true]);
  assert.equal(d1.retryAfterSec, 5);
  assert.equal(limiter.check(base).notify, false);
  assert.equal(limiter.check({ ...base, command: 'otro' }).allowed, true, 'otro comando no comparte cooldown');
  assert.equal(limiter.check({ ...base, userKey: 'u2' }).allowed, true, 'otro usuario no comparte cooldown');
  advance(5000);
  assert.equal(limiter.check(base).allowed, true);
});

// ---------- bus de eventos ----------

test('bus: entrega eventos, permite desuscribir y aísla errores de listeners', async () => {
  const errors = [];
  const bus = new EventBus({ logger: { error: (m) => errors.push(m) } });
  const got = [];
  const off = bus.on(EVENTS.levelUp, (p) => got.push(p));
  bus.on(EVENTS.levelUp, () => { throw new Error('roto'); });
  bus.on(EVENTS.levelUp, async () => { throw new Error('async roto'); });
  bus.emit(EVENTS.levelUp, { level: 2 });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(got, [{ level: 2 }]);
  assert.equal(errors.length, 2);
  off();
  bus.emit(EVENTS.levelUp, { level: 3 });
  assert.equal(got.length, 1);
  assert.equal(bus.listenerCount(EVENTS.levelUp), 2);
  assert.throws(() => bus.on('inventado', () => {}), /desconocido/);
  assert.throws(() => bus.emit('inventado'), /desconocido/);
  assert.throws(() => bus.on(EVENTS.levelUp, 'no'), /función/);
});

// ---------- validadores ----------

test('validadores: UID', () => {
  assert.deepEqual(v.parseUid('123456789'), { ok: true, value: '123456789' });
  assert.equal(v.parseUid('').ok, false);
  assert.equal(v.parseUid(undefined).ok, false);
  assert.match(v.parseUid('12ab34').error, /números/);
  assert.match(v.parseUid('1234').error, /entre 5 y 15/);
  assert.match(v.parseUid('1'.repeat(16)).error, /entre 5 y 15/);
  assert.equal(v.looksLikeUid('123456789'), true);
  assert.equal(v.looksLikeUid('@usuario'), false);
});

test('validadores: región con lista permitida', () => {
  assert.deepEqual(v.parseRegion('SA'), { ok: true, value: 'sa' });
  assert.equal(v.parseRegion('s').ok, false);
  assert.equal(v.parseRegion('s4').ok, false);
  assert.equal(v.parseRegion('sa', ['br', 'us']).ok, false);
  assert.match(v.parseRegion('sa', ['br', 'us']).error, /br, us/);
  assert.equal(v.parseRegion('br', ['br']).ok, true);
});

test('validadores: enteros con rango', () => {
  assert.equal(v.parseInteger('10', { min: 1, max: 20 }).value, 10);
  assert.equal(v.parseInteger('abc').ok, false);
  assert.equal(v.parseInteger('-5').ok, false);
  assert.equal(v.parseInteger('99999999999999999999').ok, false);
  assert.match(v.parseInteger('50', { max: 20, label: 'Las placas' }).error, /Las placas/);
  assert.equal(v.formatNumber(12450), '12,450');
});
