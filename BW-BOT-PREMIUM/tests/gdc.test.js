'use strict';

// GDC: escuadras, invitaciones, permisos, honor/placas, historial, y programación persistente (reinicios incluidos).
const test = require('node:test');
const assert = require('node:assert/strict');

const { harness, fakeRes, ALICE, BOB, GROUP, OWNER } = require('./harness');
const { CommandRegistry } = require('../src/commands/registry');
const { parseOutcome, JOB_REMINDER, JOB_START } = require('../src/services/gdc');
const { registerPlugins } = require('../src/plugins');

const CAROL = '593993333333@s.whatsapp.net';
const DAVE = '593994444444@s.whatsapp.net';
const ERIN = '593995555555@s.whatsapp.net';
const FRANK = '593996666666@s.whatsapp.net';
const GROUP2 = '120363000000000002@g.us';
const CID = '555111';
const CID2 = '800001';
const NAMES = { [ALICE]: 'Alice', [BOB]: 'Bob', [CAROL]: 'Carol', [DAVE]: 'Dave', [ERIN]: 'Erin', [FRANK]: 'Frank' };

// 2026-10-05 12:00 en Guayaquil (UTC-5). GDC 19:00 local = 2026-10-06T00:00Z; recordatorio 18:50 = 2026-10-05T23:50Z.
const START = Date.parse('2026-10-05T17:00:00Z');
const REMINDER_AT = Date.parse('2026-10-05T23:50:00Z');
const START_AT = Date.parse('2026-10-06T00:00:00Z');

const clanFetch = async (url) => {
  const id = String(url).split('/').pop();
  if (id === CID) return fakeRes(200, { clanInfo: { clanId: CID, clanName: 'Los Test', clanLevel: 7 } });
  if (id === CID2) return fakeRes(200, { clanInfo: { clanId: CID2, clanName: 'Rival', clanLevel: 9 } });
  return fakeRes(404, { error: 'Clan not found' });
};

const participants = [ALICE, BOB, CAROL, DAVE, ERIN, FRANK].map((id) => ({ id, admin: id === ALICE ? 'admin' : null }));

/** Dice un comando saltándose cooldown y aviso de rechazo (los tests no esperan segundos reales). */
async function g(h, text, from = ALICE, opts = {}) {
  const cmd = text.split(/\s+/)[0].slice(1);
  h.d.limiter.limiter.clear(`c:${from}:${cmd}`);
  h.d.denyLimiter.clear(`d:${from}`);
  await h.say(text, { group: opts.group || GROUP, from, pushName: NAMES[from] || 'X', ...opts });
  return h.last();
}

async function setup(opts = {}) {
  const h = harness({
    gdc: true,
    startAt: START,
    clanFetch,
    groupAdmins: participants,
    env: { RATE_LIMIT_USER_MAX: '10000', RATE_LIMIT_GROUP_MAX: '10000', ...(opts.env || {}) },
    ...opts.harness,
  });
  for (const j of Object.keys(NAMES)) await h.say('.registro', { from: j, pushName: NAMES[j], id: `reg-${j}` });
  if (opts.verify !== false) await g(h, `.verificarclan ${CID}`);
  return h;
}

const pendingOf = (h, group = GROUP) => h.scheduler.pending().filter((j) => j.payload?.groupJid === group).sort((a, b) => a.runAt - b.runAt);
const sentTexts = (h, re) => h.sent.filter((s) => re.test(s.text));

// ---------- registro de comandos: subcomandos ----------

test('registro: valida subcomandos (handler, permisos, duplicados) y los resuelve por nombre o alias', () => {
  const base = { name: 'demo', aliases: [], description: 'Comando de prueba', usage: 'demo', example: 'demo', category: 'general', permissions: 'ADMIN', cooldown: 0, handler: () => 'x' };
  const sub = { name: 'a', description: 'Sub de prueba', usage: 'demo a', permissions: 'ADMIN', handler: () => 'x' };
  const r = new CommandRegistry();
  assert.throws(() => r.register({ ...base, subcommands: [{ ...sub, handler: undefined }] }), /falta el handler/);
  assert.throws(() => r.register({ ...base, subcommands: [{ ...sub, permissions: 'USER' }] }), /no puede exigir menos permiso/);
  assert.throws(() => r.register({ ...base, subcommands: [{ ...sub, permissionsWithArgs: 'USER' }] }), /permissionsWithArgs no puede ser menor/);
  assert.throws(() => r.register({ ...base, subcommands: [sub, { ...sub, name: 'b', aliases: ['a'] }] }), /repetido/);
  assert.throws(() => r.register({ ...base, subcommands: [] }), /no vacía/);
  assert.throws(() => r.register({ ...base, subcommands: [{ ...sub, name: 'Mala Sub' }] }), /nombre inválido/);
  const def = r.register({ ...base, subcommands: [{ ...sub, aliases: ['alfa'] }] });
  assert.equal(CommandRegistry.findSub(def, 'ALFA').name, 'a');
  assert.equal(CommandRegistry.findSub(def, 'zzz'), null);
  assert.equal(CommandRegistry.findSub(def, undefined), null);
  assert.equal(Object.isFrozen(def.subcommands[0]), true);
});

test('parseOutcome: variantes en español y valores no válidos', () => {
  assert.equal(parseOutcome('Victoria'), 'victoria');
  assert.equal(parseOutcome('GANAMOS'), 'victoria');
  assert.equal(parseOutcome('perdimos'), 'derrota');
  assert.equal(parseOutcome('empate'), 'empate');
  assert.equal(parseOutcome('inventado'), null);
});

// ---------- requisitos del clan ----------

test('sin clan verificado no hay GDC: aviso estándar para cualquier subcomando', async () => {
  const h = await setup({ verify: false });
  try {
    assert.match(await g(h, '.gdc'), /Este grupo no tiene un clan verificado/);
    assert.match(h.last(), /\.verificarclan IDCLAN/);
    assert.match(await g(h, '.gdc crear', BOB), /no tiene un clan verificado/);
    assert.match(await g(h, '.gdc estado', BOB), /no tiene un clan verificado/);
    assert.equal(h.scheduler.pending().length, 0, 'sin clan no se programa nada');
    await h.say('.gdc', { from: BOB });
    assert.match(h.last(), /solo funciona en grupos/);
  } finally { h.close(); }
});

// ---------- panel, configuración, permisos ----------

test('panel y configuración por defecto: 19:00, recordatorio 10 min (18:50), sin honor, placas sin definir', async () => {
  const h = await setup();
  try {
    const panel = await g(h, '.gdc', BOB);
    assert.match(panel, /GDC — Los Test/);
    assert.match(panel, /Próxima GDC: hoy a las 19:00/);
    assert.match(panel, /Placas obligatorias: sin definir/);
    assert.ok(!/Honor/.test(panel), 'con honor desactivado no se muestra como requisito');
    assert.match(panel, /Escuadras: 0/);

    const cfg = await g(h, '.gdc config', BOB);
    assert.match(cfg, /Hora de inicio: \*19:00\* \(America\/Guayaquil\)/);
    assert.match(cfg, /Recordatorio: \*10 min antes\* \(18:50\)/);
    assert.match(cfg, /exactamente 4 jugadores/);
    assert.match(cfg, /Honor: \*desactivado\*/);
    assert.match(await g(h, '.gdc estado', BOB), /Próxima GDC: hoy a las 19:00/);
    assert.match(await g(h, '.gdc desconocido', BOB), /No conozco el subcomando/);
  } finally { h.close(); }
});

test('permisos: ver es de todos, cambiar es de ADMIN (validado por el dispatcher, no por el handler)', async () => {
  const h = await setup();
  try {
    for (const cmd of ['hora 20:00', 'placas 10', 'recordatorio 15', 'honor activar', 'honor 100', 'activar', 'desactivar', 'finalizar', 'resultado victoria', 'admin']) {
      const out = await g(h, `.gdc ${cmd}`, BOB);
      assert.match(out, /No tienes permiso/, `.gdc ${cmd}`);
      assert.match(out, /Requiere rol ADMIN/);
    }
    assert.equal(h.clans.clanOfGroup(GROUP).config.gdcTime, '19:00');
    assert.match(await g(h, '.gdc hora', BOB), /Hora de la GDC: \*19:00\*/);
    assert.match(await g(h, '.gdc placas', BOB), /sin definir/);
    assert.match(await g(h, '.gdc honor', BOB), /desactivado/);
    assert.match(await g(h, '.gdc recordatorio', BOB), /10 min antes/);
    assert.match(await g(h, '.gdc resultado', BOB), /Todavía no hay un resultado/);
    // El OWNER también puede
    assert.match(await g(h, '.gdc hora 21:00', OWNER), /Hora de la GDC: \*21:00\*/);
  } finally { h.close(); }
});

test('hora, recordatorio y placas: validación y valores guardados por grupo', async () => {
  const h = await setup();
  try {
    assert.match(await g(h, '.gdc hora 20:30'), /\*20:30\*/);
    assert.match(h.last(), /Recordatorio a las 20:20/);
    assert.match(await g(h, '.gdc hora 25:00'), /formato HH:MM/);
    assert.match(await g(h, '.gdc hora abc'), /formato HH:MM/);
    assert.equal(h.clans.clanOfGroup(GROUP).config.gdcTime, '20:30');

    assert.match(await g(h, '.gdc recordatorio 20'), /\*20 min antes\* \(a las 20:10\)/);
    assert.match(await g(h, '.gdc recordatorio 0'), /entre 1 y 120/);
    assert.match(await g(h, '.gdc recordatorio 500'), /entre 1 y 120/);
    assert.match(await g(h, '.gdc recordatorio mucho'), /entero/);

    assert.match(await g(h, '.gdc placas 10'), /Placas obligatorias: 10/);
    assert.equal(h.gdc.doc(GROUP).platesRequired, 10);
    assert.match(await g(h, '.gdc placas 0'), /entre 1 y 999/);
    assert.match(await g(h, '.gdc placas -3'), /entero/);
    assert.match(await g(h, '.gdc placas diez'), /entero/);
    assert.equal(h.gdc.doc(GROUP).platesRequired, 10);
    assert.match(await g(h, '.gdc placas borrar'), /sin definir/);
    assert.equal(h.gdc.doc(GROUP).platesRequired, null);
    // No existen mínimos ni máximos de placas
    const cfgText = await g(h, '.gdc config');
    assert.ok(!/mínim|máxim/i.test(cfgText));
  } finally { h.close(); }
});

test('honor opcional por clan: activar, valor requerido, desactivar y aviso de que no se valida', async () => {
  const h = await setup();
  try {
    assert.match(await g(h, '.gdc honor'), /desactivado/);
    assert.match(h.last(), /El honor no se exige/);
    assert.match(h.last(), /NO comprueba el honor/);
    assert.match(h.last(), /requiere una API compatible/);

    assert.match(await g(h, '.gdc honor 100'), /sigue desactivado/);
    assert.equal(h.clans.clanOfGroup(GROUP).config.honorRequired, 100);
    assert.match(await g(h, '.gdc honor activar'), /activado/);
    assert.match(h.last(), /Honor requerido: 100/);
    assert.match(await g(h, '.gdc reglas', BOB), /Honor requerido: 100/);
    assert.match(await g(h, '.gdc honor abc'), /activar o desactivar/);
    assert.match(await g(h, '.gdc honor -5'), /Indica activar o desactivar/);
    assert.match(await g(h, '.gdc honor desactivar'), /desactivado/);
    assert.ok(!/Honor requerido/.test(await g(h, '.gdc reglas', BOB)), 'desactivado: no aparece como requisito');
    assert.equal(h.clans.clanOfGroup(GROUP).config.honorRequired, 100, 'el valor se conserva');
  } finally { h.close(); }
});

test('el honor es por clan: otro clan en otro grupo no se ve afectado', async () => {
  const h = await setup();
  try {
    await g(h, '.gdc honor activar');
    await g(h, '.gdc honor 100');
    await g(h, '.gdc placas 10');
    await g(h, `.verificarclan ${CID2}`, ALICE, { group: GROUP2 });
    assert.match(await g(h, '.gdc config', BOB, { group: GROUP2 }), /Honor: \*desactivado\*/);
    assert.match(await g(h, '.gdc placas', BOB, { group: GROUP2 }), /sin definir/);
    assert.match(await g(h, '.gdc config', BOB), /Honor: \*activado\* \(requerido 100\)/);
  } finally { h.close(); }
});

// ---------- escuadras ----------

test('crear / unirse: estados 1/4..4/4, escuadra completa y rechazos', async () => {
  const h = await setup();
  try {
    assert.match(await g(h, '.gdc crear', ALICE), /\*Escuadra #1 creada\* \(1\/4\)/);
    assert.match(await g(h, '.gdc crear', ALICE), /Ya perteneces a la escuadra #1/);
    assert.match(await g(h, '.gdc unirse 1', BOB), /\(2\/4\)/);
    assert.match(await g(h, '.gdc unirse 1', CAROL), /\(3\/4\)/);
    const last = await g(h, '.gdc unirse 1', DAVE);
    assert.match(last, /ESCUADRA COMPLETA/);
    const s = h.sent[h.sent.length - 1];
    assert.deepEqual([...s.mentions].sort(), [ALICE, BOB, CAROL, DAVE].sort(), 'solo JIDs reales de los 4 miembros');
    assert.match(await g(h, '.gdc unirse 1', ERIN), /ya está completa \(4\/4\)/);
    assert.match(await g(h, '.gdc unirse 77', ERIN), /No existe la escuadra #77/);
    assert.match(await g(h, '.gdc unirse', ERIN), /Uso: \*\.gdc unirse N/);
    assert.match(await g(h, '.gdc unirse abc', ERIN), /número entero/);
    assert.match(await g(h, '.gdc unirse 1', BOB), /Ya perteneces/);
    assert.equal(h.gdc.squads(GROUP)[0].members.length, 4, 'nunca más de 4');
  } finally { h.close(); }
});

test('exigencias: registrados, GDC activa y una sola escuadra a la vez (incluso entre grupos)', async () => {
  const h = await setup();
  try {
    await h.say('.gdc crear', { group: GROUP, from: '593990000001@s.whatsapp.net', pushName: 'Nadie', id: 'x1' });
    assert.match(h.last(), /Primero debes registrarte/);

    await g(h, '.gdc crear', ALICE);
    await g(h, `.verificarclan ${CID2}`, ALICE, { group: GROUP2 });
    assert.match(await g(h, '.gdc crear', ALICE, { group: GROUP2 }), /Ya perteneces a la escuadra #1 en otro grupo/);
    assert.match(await g(h, '.gdc crear', BOB, { group: GROUP2 }), /Escuadra #1 creada/);
    assert.match(await g(h, '.gdc unirse 1', BOB), /Ya perteneces a la escuadra #1 en otro grupo/);
    assert.match(await g(h, '.gdc salir', BOB), /Tu escuadra está en otro grupo/);

    await g(h, '.gdc desactivar');
    assert.match(await g(h, '.gdc crear', CAROL), /GDC está desactivada/);
    assert.match(await g(h, '.gdc unirse 1', CAROL), /GDC está desactivada/);
    assert.match(await g(h, '.gdc invitar @x', ALICE, { mentions: [CAROL] }), /GDC está desactivada/);
    await g(h, '.gdc activar');
    assert.match(await g(h, '.gdc crear', CAROL), /Escuadra #2 creada/);
  } finally { h.close(); }
});

test('salir: capitán nuevo, escuadra vacía eliminada y errores', async () => {
  const h = await setup();
  try {
    assert.match(await g(h, '.gdc salir', BOB), /No perteneces a ninguna escuadra/);
    await g(h, '.gdc crear', ALICE);
    await g(h, '.gdc unirse 1', BOB);
    await g(h, '.gdc unirse 1', CAROL);
    assert.match(await g(h, '.gdc salir', ALICE), /nuevo capitán es @593992222222/);
    assert.deepEqual(h.sent[h.sent.length - 1].mentions, [BOB]);
    assert.equal(h.gdc.squads(GROUP)[0].captain, BOB);
    await g(h, '.gdc salir', BOB);
    assert.match(await g(h, '.gdc salir', CAROL), /quedó vacía, se eliminó/);
    assert.equal(h.gdc.squads(GROUP).length, 0);
    assert.match(await g(h, '.gdc crear', ALICE), /Escuadra #2 creada/, 'los números no se reutilizan dentro de la misma GDC');
  } finally { h.close(); }
});

test('expulsar: capitán, administrador y rechazos', async () => {
  const h = await setup();
  try {
    await g(h, '.gdc crear', BOB);
    await g(h, '.gdc unirse 1', CAROL);
    await g(h, '.gdc unirse 1', DAVE);
    await g(h, '.gdc crear', ERIN);

    assert.match(await g(h, '.gdc expulsar', BOB), /Menciona a la persona/);
    assert.match(await g(h, '.gdc expulsar @c', CAROL, { mentions: [DAVE] }), /Solo el capitán/);
    assert.match(await g(h, '.gdc expulsar @b', BOB, { mentions: [BOB] }), /No puedes expulsarte/);
    assert.match(await g(h, '.gdc expulsar @f', BOB, { mentions: [FRANK] }), /no pertenece a ninguna escuadra/);
    assert.match(await g(h, '.gdc expulsar @e', BOB, { mentions: [ERIN] }), /Solo el capitán/, 'no se expulsa de otra escuadra');

    const ok = await g(h, '.gdc expulsar @c', BOB, { mentions: [CAROL] });
    assert.match(ok, /fue expulsado de la escuadra #1/);
    assert.deepEqual(h.sent[h.sent.length - 1].mentions, [CAROL]);
    assert.ok(!h.gdc.squads(GROUP)[0].members.includes(CAROL));

    // Un administrador expulsa de cualquier escuadra, incluso al capitán
    assert.match(await g(h, '.gdc expulsar @b', ALICE, { mentions: [BOB] }), /expulsado de la escuadra #1/);
    assert.equal(h.gdc.squads(GROUP)[0].captain, DAVE);
    assert.equal(h.gdc.membership(BOB), null, 'queda libre para otra escuadra');
    // También por respuesta a un mensaje
    assert.match(await g(h, '.gdc expulsar', ALICE, { quoted: ERIN }), /expulsado de la escuadra #2/);
  } finally { h.close(); }
});

test('abrir / cerrar: escuadra cerrada solo entra por invitación', async () => {
  const h = await setup();
  try {
    await g(h, '.gdc crear', BOB);
    assert.match(await g(h, '.gdc cerrar', CAROL), /Solo el capitán/);
    assert.match(await g(h, '.gdc cerrar', BOB), /cerrada/);
    assert.match(await g(h, '.gdc unirse 1', CAROL), /está cerrada: solo se entra por invitación/);
    assert.match(await g(h, '.gdc equipos', CAROL), /🔒 Cerrada/);
    await g(h, '.gdc invitar @c', BOB, { mentions: [CAROL] });
    assert.match(await g(h, '.gdc aceptar', CAROL), /se unió a la escuadra #1/);
    assert.match(await g(h, '.gdc abrir', BOB), /abierta/);
    assert.match(await g(h, '.gdc unirse 1', DAVE), /\(3\/4\)/);
    assert.match(await g(h, '.gdc cerrar 1', ALICE), /cerrada/, 'el admin indica el número');
    assert.match(await g(h, '.gdc cerrar 9', ALICE), /No existe la escuadra #9/);
  } finally { h.close(); }
});

test('invitaciones: validaciones, aceptar, rechazar, vigencia y mensaje con menciones reales', async () => {
  const h = await setup();
  try {
    assert.match(await g(h, '.gdc invitar @b', BOB, { mentions: [CAROL] }), /Solo el capitán/);
    await g(h, '.gdc crear', BOB);
    assert.match(await g(h, '.gdc invitar', BOB), /Menciona a la persona/);
    assert.match(await g(h, '.gdc invitar @b', BOB, { mentions: [BOB] }), /No puedes invitarte/);
    assert.match(await g(h, '.gdc invitar @x', BOB, { mentions: ['593999999999@s.whatsapp.net'] }), /no está registrada/);

    const inv = await g(h, '.gdc invitar @c', BOB, { mentions: [CAROL] });
    assert.match(inv, /INVITACIÓN GDC/);
    assert.match(inv, /@593992222222 te invitó a su escuadra #1 \(1\/4\), @593993333333/);
    assert.match(inv, /\.gdc aceptar 1/);
    assert.match(inv, /\.gdc rechazar 1/);
    assert.match(inv, /Vigente 10 minutos/);
    assert.deepEqual([...h.sent[h.sent.length - 1].mentions].sort(), [BOB, CAROL].sort());
    assert.match(await g(h, '.gdc invitar @c', BOB, { mentions: [CAROL] }), /invitación vigente/);

    // Rechazar
    assert.match(await g(h, '.gdc rechazar', CAROL), /rechazó la invitación a la escuadra #1/);
    assert.match(await g(h, '.gdc aceptar', CAROL), /No tienes invitaciones vigentes/);

    // Vigencia: caduca a los 10 minutos
    await g(h, '.gdc invitar @c', BOB, { mentions: [CAROL] });
    h.clock.t += 11 * 60 * 1000;
    assert.match(await g(h, '.gdc aceptar', CAROL), /No tienes invitaciones vigentes/);

    // Invitar a alguien que ya está en una escuadra
    await g(h, '.gdc crear', DAVE);
    assert.match(await g(h, '.gdc invitar @d', BOB, { mentions: [DAVE] }), /ya pertenece a una escuadra/);

    // Aceptar con número, y que se cancelen las demás invitaciones
    await g(h, '.gdc invitar @c', BOB, { mentions: [CAROL] });
    await g(h, '.gdc invitar @c', DAVE, { mentions: [CAROL] });
    assert.match(await g(h, '.gdc aceptar 9', CAROL), /No tienes una invitación vigente de la escuadra #9/);
    assert.match(await g(h, '.gdc aceptar 1', CAROL), /se unió a la escuadra #1 \(2\/4\)/);
    assert.match(await g(h, '.gdc aceptar', CAROL), /No tienes invitaciones vigentes/, 'la invitación de la otra escuadra se canceló');
  } finally { h.close(); }
});

test('invitaciones: escuadra llena al aceptar y escuadra eliminada', async () => {
  const h = await setup();
  try {
    await g(h, '.gdc crear', BOB);
    await g(h, '.gdc invitar @e', BOB, { mentions: [ERIN] });
    await g(h, '.gdc unirse 1', CAROL);
    await g(h, '.gdc unirse 1', DAVE);
    await g(h, '.gdc unirse 1', FRANK);
    assert.match(await g(h, '.gdc invitar @a', BOB, { mentions: [ALICE] }), /ya está completa/);
    assert.match(await g(h, '.gdc aceptar', ERIN), /ya se completó/);
    assert.equal(h.gdc.membership(ERIN), null);

    // Si la escuadra desaparece, la invitación deja de valer
    await g(h, '.gdc crear', ERIN);
    await g(h, '.gdc invitar @a', ERIN, { mentions: [ALICE] });
    await g(h, '.gdc salir', ERIN);
    assert.match(await g(h, '.gdc aceptar', ALICE), /No tienes invitaciones vigentes/);
  } finally { h.close(); }
});

test('equipos / equipo / miembros: nombres reales, nick de Free Fire solo si existe y paginación', async () => {
  const h = await setup();
  try {
    assert.match(await g(h, '.gdc equipos', BOB), /Todavía no hay escuadras/);
    await g(h, '.gdc crear', BOB);
    await g(h, '.gdc unirse 1', CAROL);
    h.users.find([CAROL]).ffUid = '123456789';
    h.users.find([CAROL]).ffVerified = true;
    h.users.find([BOB]).ffSnapshot = { fetchedAt: new Date().toISOString(), data: { nickname: 'BobPro' } };

    const t = await g(h, '.gdc equipos', ERIN);
    assert.match(t, /Escuadra #1\* — 2\/4/);
    assert.match(t, /👑 Bob \(FF: BobPro\)/);
    assert.match(t, /👤 Carol/);
    assert.match(t, /⬜ libre/);
    assert.ok(!/Carol \(FF/.test(t), 'sin ficha no se inventa un nick');

    assert.match(await g(h, '.gdc equipo', CAROL), /Escuadra #1/);
    assert.match(await g(h, '.gdc equipo', ERIN), /No perteneces a ninguna escuadra/);
    assert.match(await g(h, '.gdc equipo 1', ERIN), /Escuadra #1/);
    const mem = await g(h, '.gdc miembros', BOB);
    assert.match(mem, /Carol — UID 123456789 ✅/);
    assert.ok(!/Bob.*UID/.test(mem), 'sin UID vinculado no se muestra');
    assert.match(await g(h, '.gdc miembros', ERIN), /No perteneces a una escuadra/);

    // Paginación (6 por página): 7 escuadras
    for (const j of [ALICE, DAVE, ERIN, FRANK]) await g(h, '.gdc crear', j);
    assert.match(await g(h, '.gdc equipos', BOB), /Página 1\/1|Escuadra #5/);
    await h.say('.registro', { from: '593997777777@s.whatsapp.net', pushName: 'G', id: 'rg1' });
    for (let i = 0; i < 3; i++) {
      const j = `59399888000${i}@s.whatsapp.net`;
      await h.say('.registro', { from: j, pushName: `P${i}`, id: `rp${i}` });
      await g(h, '.gdc crear', j);
    }
    const p1 = await g(h, '.gdc equipos', BOB);
    assert.match(p1, /Página 1\/2/);
    assert.match(await g(h, '.gdc equipos 2', BOB), /Escuadra #7/);
    assert.match(await g(h, '.gdc equipos 9', BOB), /entre 1 y 2/);
  } finally { h.close(); }
});

// ---------- resultados, historial, finalizar, reglas, admin ----------

test('resultado manual, finalizar e historial: nada inventado y escuadras limpias', async () => {
  const h = await setup();
  try {
    assert.match(await g(h, '.gdc historial', BOB), /Aún no hay GDC finalizadas/);
    await g(h, '.gdc crear', BOB);
    await g(h, '.gdc unirse 1', CAROL);
    await g(h, '.gdc crear', DAVE);
    await g(h, '.gdc placas 10');

    assert.match(await g(h, '.gdc resultado inventado'), /Resultado no válido/);
    assert.match(await g(h, '.gdc resultado victoria 3 kills de diferencia'), /Resultado registrado: \*Victoria\*/);
    assert.match(await g(h, '.gdc resultado', BOB), /Resultado: \*Victoria\*\n📝 3 kills de diferencia/);
    assert.match(await g(h, '.gdc estado', BOB), /Resultado registrado: Victoria/);

    const fin = await g(h, '.gdc finalizar');
    assert.match(fin, /GDC finalizada/);
    assert.match(fin, /2 escuadras archivadas, Victoria/);
    assert.equal(h.gdc.squads(GROUP).length, 0);
    assert.equal(h.gdc.membership(BOB), null);
    assert.match(await g(h, '.gdc resultado', BOB), /Todavía no hay un resultado/);

    const hist = await g(h, '.gdc historial', BOB);
    assert.match(hist, /2026-10-05 — 2 escuadras, 3 jugadores — Victoria \(3 kills de diferencia\)/);
    const entry = h.gdc.history(GROUP)[0];
    assert.equal(entry.platesRequired, 10);
    assert.deepEqual(entry.squads[0].names, ['Bob', 'Carol']);

    // Finalizar con resultado directo y sin resultado
    assert.match(await g(h, '.gdc crear', ERIN), /Escuadra #1 creada/, 'la numeración vuelve a empezar');
    assert.match(await g(h, '.gdc finalizar derrota'), /1 escuadras archivadas, Derrota/);
    assert.match(await g(h, '.gdc finalizar'), /0 escuadras archivadas, sin resultado registrado/);
    assert.match(await g(h, '.gdc historial 1', BOB), /sin resultado/);
    assert.match(await g(h, '.gdc historial 0', BOB), /entre 1 y 15/);
    assert.equal(h.gdc.history(GROUP, 10).length, 3);
  } finally { h.close(); }
});

test('historial: se limita a GDC_HISTORY_KEEP entradas', async () => {
  const h = await setup({ env: { GDC_HISTORY_KEEP: '2' } });
  try {
    for (let i = 0; i < 4; i++) await g(h, '.gdc finalizar');
    assert.equal(h.gdc.doc(GROUP).history.length, 2);
  } finally { h.close(); }
});

test('reglas, ayuda por rol y panel admin con auditoría', async () => {
  const h = await setup();
  try {
    await g(h, '.gdc placas 10');
    await g(h, '.setclanreglas Respeto y puntualidad');
    const rules = await g(h, '.gdc reglas', BOB);
    assert.match(rules, /exactamente 4 jugadores/);
    assert.match(rules, /una escuadra a la vez/);
    assert.match(rules, /Placas obligatorias: 10/);
    assert.match(rules, /Respeto y puntualidad/);

    const userHelp = await g(h, '.gdc ayuda', BOB);
    assert.match(userHelp, /gdc crear/);
    assert.ok(!/gdc finalizar/.test(userHelp) && !/gdc admin/.test(userHelp), 'un USER no ve subcomandos de ADMIN');
    assert.match(await g(h, '.gdc ayuda', ALICE), /gdc finalizar/);

    await g(h, '.gdc crear', BOB);
    const admin = await g(h, '.gdc admin');
    assert.match(admin, /gdc placas/);
    assert.match(admin, /placas: sin definir → 10/);
    assert.match(admin, /crear: escuadra #1/);
    assert.match(admin, /@593992222222/);

    const audit = h.gdc.doc(GROUP).audit.map((a) => a.action);
    assert.ok(audit.includes('placas') && audit.includes('crear'));
    assert.ok(h.db.col('logs').some((l) => l.type === 'gdc' && l.action === 'crear'), 'también queda en el registro global');
  } finally { h.close(); }
});

test('menú dinámico con el módulo real: próxima GDC, placas y escuadras; desactivada se indica', async () => {
  const h = await setup();
  try {
    await g(h, '.gdc placas 10');
    await g(h, '.gdc crear', BOB);
    await g(h, '.gdc unirse 1', CAROL);
    await g(h, '.gdc unirse 1', DAVE);
    await g(h, '.gdc unirse 1', ERIN);
    const menu = await g(h, '.menu', BOB);
    assert.match(menu, /Próxima GDC: hoy a las 19:00/);
    assert.match(menu, /Placas obligatorias: 10/);
    assert.match(menu, /Escuadras: 1 \(1 completas\)/);
    assert.match(menu, /GDC: \.gdc/);
    assert.match(await g(h, '.menu gdc', BOB), /Subcomandos: .*crear/);
    assert.match(await g(h, '.help guerradeclanes', BOB), /Subcomandos:/);
    await g(h, '.gdc desactivar');
    assert.match(await g(h, '.menu', BOB), /Próxima GDC: desactivada/);
  } finally { h.close(); }
});

// ---------- programación ----------

test('scheduler: al verificar el clan se programan recordatorio (18:50) e inicio (19:00) con ids únicos', async () => {
  const h = await setup();
  try {
    const jobs = pendingOf(h);
    assert.equal(jobs.length, 2);
    assert.deepEqual(jobs.map((j) => j.id), [`GDC_REM_${GROUP}_2026-10-05_18:50`, `GDC_START_${GROUP}_2026-10-05_19:00`]);
    assert.deepEqual(jobs.map((j) => j.type), [JOB_REMINDER, JOB_START]);
    assert.equal(jobs[0].runAt, REMINDER_AT);
    assert.equal(jobs[1].runAt, START_AT);
    assert.ok(jobs[0].graceMs <= 10 * 60000, 'el recordatorio no se envía tras empezar la GDC');
    // Idempotente: reconciliar muchas veces no duplica
    for (let i = 0; i < 3; i++) assert.deepEqual(h.gdc.syncGroup(GROUP), { cancelled: 0, created: 0 });
    assert.equal(pendingOf(h).length, 2);
    assert.deepEqual(h.gdc.syncAll(), { groups: 1, created: 0, cancelled: 0 });
  } finally { h.close(); }
});

test('scheduler: cambios de hora, recordatorio, activar/desactivar y desverificar reprograman sin duplicar', async () => {
  const h = await setup();
  try {
    await g(h, '.gdc hora 20:00');
    assert.deepEqual(pendingOf(h).map((j) => j.id), [`GDC_REM_${GROUP}_2026-10-05_19:50`, `GDC_START_${GROUP}_2026-10-05_20:00`]);
    assert.equal(h.scheduler.list((j) => j.status === 'cancelled').length, 2);

    await g(h, '.gdc recordatorio 30');
    assert.deepEqual(pendingOf(h).map((j) => j.id), [`GDC_REM_${GROUP}_2026-10-05_19:30`, `GDC_START_${GROUP}_2026-10-05_20:00`]);

    await g(h, '.setclan hora 21:15'); // el comando de la Fase 3 también reprograma
    assert.deepEqual(pendingOf(h).map((j) => j.id), [`GDC_REM_${GROUP}_2026-10-05_20:45`, `GDC_START_${GROUP}_2026-10-05_21:15`]);

    await g(h, '.gdc desactivar');
    assert.equal(pendingOf(h).length, 0);
    await g(h, '.gdc activar');
    assert.equal(pendingOf(h).length, 2);
    assert.equal(pendingOf(h).filter((j) => j.id.includes('GDC_REM')).length, 1, 'un solo recordatorio pendiente');

    await g(h, '.gdc crear', BOB);
    await g(h, '.desverificarclan');
    assert.equal(pendingOf(h).length, 0, 'sin clan no hay avisos');
    assert.equal(h.gdc.squads(GROUP).length, 0, 'las escuadras se archivaron');
    assert.equal(h.gdc.history(GROUP)[0].reason, 'clan desverificado');
    assert.equal(h.gdc.membership(BOB), null);
  } finally { h.close(); }
});

test('scheduler: cada grupo/clan tiene su propia hora', async () => {
  const h = await setup();
  try {
    await g(h, `.verificarclan ${CID2}`, ALICE, { group: GROUP2 });
    await g(h, '.gdc hora 20:00', ALICE, { group: GROUP2 });
    assert.equal(pendingOf(h, GROUP).length, 2);
    assert.deepEqual(pendingOf(h, GROUP2).map((j) => j.id.split('_').slice(-1)[0]), ['19:50', '20:00']);
    assert.equal(h.clans.clanOfGroup(GROUP).config.gdcTime, '19:00');
  } finally { h.close(); }
});

test('recordatorio 18:50: se envía aunque no existan escuadras, con menciones reales y sin @todos', async () => {
  const h = await setup({ harness: { self: '593990000099@s.whatsapp.net' } });
  try {
    await g(h, '.gdc placas 10');
    h.sent.length = 0;
    await h.scheduler.runDue();
    assert.equal(h.sent.length, 0, 'todavía no es la hora');

    h.clock.t = REMINDER_AT;
    await h.scheduler.runDue();
    assert.equal(h.sent.length, 1);
    const m = h.sent[0];
    assert.equal(m.to, GROUP);
    assert.match(m.text, /GDC EN 10 MINUTOS/);
    assert.match(m.text, /Inicio: 19:00/);
    assert.match(m.text, /Placas obligatorias: 10/);
    assert.match(m.text, /Formen sus escuadras de 4 jugadores/);
    assert.match(m.text, /Entren a Free Fire y prepárense/);
    assert.ok(!/Escuadras registradas/.test(m.text), 'sin escuadras no se muestra la cantidad');
    assert.ok(!/Honor/.test(m.text), 'honor desactivado: no se muestra');
    assert.ok(!/@todos|@everyone|@all/i.test(m.text));
    assert.deepEqual([...m.mentions].sort(), participants.map((p) => p.id).sort(), 'exactamente los participantes reales');
    for (const j of m.mentions) assert.ok(m.text.includes(`@${j.split('@')[0]}`), 'cada mención tiene su @número en el texto');
    assert.equal(h.gdc.doc(GROUP).sent.reminder, '2026-10-05');
  } finally { h.close(); }
});

test('recordatorio: con escuadras muestra la cantidad y con honor activado muestra el requisito', async () => {
  const h = await setup();
  try {
    await g(h, '.gdc crear', BOB);
    await g(h, '.gdc crear', CAROL);
    await g(h, '.gdc unirse 1', DAVE);
    await g(h, '.gdc unirse 1', ERIN);
    await g(h, '.gdc unirse 1', FRANK);
    await g(h, '.gdc honor activar');
    await g(h, '.gdc honor 100');
    await g(h, '.gdc recordatorio 5');
    h.clock.t = Date.parse('2026-10-05T23:55:00Z');
    await h.scheduler.runDue();
    const m = h.sent[h.sent.length - 1];
    assert.match(m.text, /GDC EN 5 MINUTOS/);
    assert.match(m.text, /Escuadras registradas: 2 \(1 completa\)/);
    assert.match(m.text, /Honor requerido: 100/);
    // Primero los miembros de escuadras
    assert.deepEqual(m.mentions.slice(0, 5), [BOB, DAVE, ERIN, FRANK, CAROL]);
  } finally { h.close(); }
});

test('inicio 19:00: GDC INICIADA con placas, escuadras y menciones; honor solo si está activo', async () => {
  const h = await setup();
  try {
    await g(h, '.gdc placas 10');
    await g(h, '.gdc crear', BOB);
    h.clock.t = START_AT;
    await h.scheduler.runDue(); // recordatorio (pendiente de hace 10 min, dentro de la gracia) + inicio
    const texts = h.sent.map((s) => s.text).filter((t) => /GDC/.test(t) && /EN 10 MINUTOS|INICIADA/.test(t));
    assert.equal(texts.length, 2);
    const start = h.sent.find((s) => /GDC INICIADA/.test(s.text));
    assert.match(start.text, /Placas obligatorias: 10/);
    assert.match(start.text, /Escuadras registradas: 1/);
    assert.match(start.text, /La GDC ha comenzado/);
    assert.ok(!/Honor/.test(start.text));
    assert.equal(start.mentions.length, 6);
    assert.equal(h.gdc.doc(GROUP).sent.start, '2026-10-05');
  } finally { h.close(); }
});

test('idempotencia: ni runDue repetido ni reprogramar ni cambiar la hora reenvían el aviso del día', async () => {
  const h = await setup();
  try {
    h.clock.t = REMINDER_AT;
    await h.scheduler.runDue();
    await h.scheduler.runDue();
    h.gdc.syncAll();
    await h.scheduler.runDue();
    assert.equal(sentTexts(h, /EN 10 MINUTOS/).length, 1);

    // El admin mueve la hora más tarde ese mismo día: el recordatorio de hoy ya salió y no se repite
    await g(h, '.gdc hora 20:00');
    h.clock.t = Date.parse('2026-10-06T00:50:00Z'); // 19:50 local
    await h.scheduler.runDue();
    assert.equal(sentTexts(h, /EN 10 MINUTOS/).length, 1, 'no se duplica el recordatorio del día');
    h.clock.t = Date.parse('2026-10-06T01:00:00Z'); // 20:00 local
    await h.scheduler.runDue();
    assert.equal(sentTexts(h, /INICIADA/).length, 1);
    assert.equal(sentTexts(h, /INICIADA/)[0].text.includes('Placas'), true);
  } finally { h.close(); }
});

test('siguiente día: tras ejecutarse se programa la ocurrencia siguiente y se vuelve a avisar', async () => {
  const h = await setup();
  try {
    h.clock.t = START_AT;
    await h.scheduler.runDue();
    assert.deepEqual(pendingOf(h).map((j) => j.id), [`GDC_REM_${GROUP}_2026-10-06_18:50`, `GDC_START_${GROUP}_2026-10-06_19:00`]);
    h.clock.t = START_AT + 24 * 3600 * 1000;
    await h.scheduler.runDue();
    assert.equal(sentTexts(h, /INICIADA/).length, 2);
    assert.equal(sentTexts(h, /EN 10 MINUTOS/).length, 2);
  } finally { h.close(); }
});

test('envío fallido: el scheduler reintenta y el mensaje sale una sola vez', async () => {
  const h = await setup();
  try {
    const real = h.wa.sendText;
    let fail = true;
    h.wa.sendText = async (...a) => { if (fail) throw new Error('WhatsApp no está conectado.'); return real(...a); };
    h.clock.t = REMINDER_AT;
    await h.scheduler.runDue();
    assert.equal(h.sent.filter((s) => /EN 10/.test(s.text)).length, 0);
    assert.equal(h.gdc.doc(GROUP).sent.reminder, null, 'sin entrega no se marca como enviado');
    const job = h.scheduler.list((j) => j.type === JOB_REMINDER && j.status === 'pending')[0];
    assert.ok(job && job.attempts === 1, 'queda pendiente para reintento');
    fail = false;
    h.clock.t += 20000;
    await h.scheduler.runDue();
    assert.equal(h.sent.filter((s) => /EN 10/.test(s.text)).length, 1);
    h.clock.t += 60000;
    await h.scheduler.runDue();
    assert.equal(h.sent.filter((s) => /EN 10/.test(s.text)).length, 1);
  } finally { h.close(); }
});

test('si no se pueden leer los participantes, el aviso sale igual mencionando solo a las escuadras', async () => {
  const h = await setup();
  try {
    await g(h, '.gdc crear', BOB);
    h.wa.groupMetadata = async () => { throw new Error('sin conexión'); };
    h.d.groupCache.clear();
    h.clock.t = REMINDER_AT;
    await h.scheduler.runDue();
    const m = h.sent[h.sent.length - 1];
    assert.match(m.text, /GDC EN 10 MINUTOS/);
    assert.deepEqual(m.mentions, [BOB]);
    assert.ok(h.logger.logs.warn.length >= 1);
  } finally { h.close(); }
});

test('menciones: tope GDC_MAX_MENTIONS y 0 = sin menciones', async () => {
  const h = await setup({ env: { GDC_MAX_MENTIONS: '3' } });
  try {
    h.clock.t = REMINDER_AT;
    await h.scheduler.runDue();
    assert.equal(h.sent[h.sent.length - 1].mentions.length, 3);
  } finally { h.close(); }
  const h0 = await setup({ env: { GDC_MAX_MENTIONS: '0' } });
  try {
    h0.clock.t = REMINDER_AT;
    await h0.scheduler.runDue();
    assert.deepEqual(h0.sent[h0.sent.length - 1].mentions, []);
    assert.ok(!/@\d/.test(h0.sent[h0.sent.length - 1].text));
  } finally { h0.close(); }
});

test('un trabajo viejo (hora ya cambiada) no envía nada y se reconcilia', async () => {
  const h = await setup();
  try {
    await g(h, '.gdc hora 20:00');
    // Se cuela un trabajo con la hora anterior (p. ej. restaurado de una copia de seguridad)
    h.scheduler.schedule({
      id: `GDC_REM_${GROUP}_stale`,
      type: JOB_REMINDER,
      runAt: REMINDER_AT,
      payload: { groupJid: GROUP, clanId: CID },
      recurrence: { kind: 'daily', baseId: `GDC_REM_${GROUP}`, hhmm: '19:00', tz: 'America/Guayaquil', offsetMinutes: -10 },
    });
    h.clock.t = REMINDER_AT;
    await h.scheduler.runDue();
    assert.equal(h.sent.filter((s) => /EN 10 MINUTOS/.test(s.text)).length, 0);
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(pendingOf(h).map((j) => j.id.split('_').slice(-1)[0]), ['19:50', '20:00']);
  } finally { h.close(); }
});

test('escuadras sin actividad más de GDC_SQUAD_TTL_HOURS se archivan al enviar el aviso', async () => {
  const h = await setup({ env: { GDC_SQUAD_TTL_HOURS: '12' } });
  try {
    await g(h, '.gdc crear', BOB);
    h.gdc.doc(GROUP).squads['1'].updatedAt = new Date(START - 13 * 3600 * 1000).toISOString();
    h.clock.t = REMINDER_AT;
    await h.scheduler.runDue();
    assert.equal(h.gdc.squads(GROUP).length, 0);
    assert.ok(!/Escuadras registradas/.test(h.sent[h.sent.length - 1].text));
    assert.equal(h.gdc.membership(BOB), null);
  } finally { h.close(); }
});

// ---------- reinicios y recuperación ----------

/** Cierra la base de datos (simula la caída del proceso) y levanta un stack nuevo sobre los mismos archivos. */
async function restart(h, { at, env, harness: extra = {} } = {}) {
  h.db.close();
  const h2 = harness({
    dir: h.dir,
    gdc: true,
    startAt: at ?? h.clock.t,
    clanFetch,
    groupAdmins: participants,
    env: { RATE_LIMIT_USER_MAX: '10000', RATE_LIMIT_GROUP_MAX: '10000', ...(env || {}) },
    ...extra,
  });
  h2.gdc.syncAll(); // igual que app.start() tras cargar la base
  return h2;
}

test('reinicio: escuadras, configuración y avisos programados persisten y no se duplican', async () => {
  const h = await setup();
  await g(h, '.gdc placas 10');
  await g(h, '.gdc honor activar');
  await g(h, '.gdc honor 100');
  await g(h, '.gdc crear', BOB);
  await g(h, '.gdc unirse 1', CAROL);
  const before = pendingOf(h).map((j) => j.id);
  const h2 = await restart(h);
  try {
    assert.deepEqual(pendingOf(h2).map((j) => j.id), before, 'mismos ids tras reiniciar');
    assert.equal(h2.scheduler.pending().length, 2, 'sin duplicados');
    assert.equal(h2.gdc.doc(GROUP).platesRequired, 10);
    assert.equal(h2.clans.clanOfGroup(GROUP).config.honorRequired, 100);
    assert.deepEqual(h2.gdc.squads(GROUP)[0].members, [BOB, CAROL]);
    assert.deepEqual(h2.gdc.syncAll(), { groups: 1, created: 0, cancelled: 0 });

    // El proceso sigue: llega la hora y el aviso sale exactamente una vez
    await h2.scheduler.start();
    h2.clock.t = REMINDER_AT;
    await h2.scheduler.runDue();
    assert.equal(sentTexts(h2, /EN 10 MINUTOS/).length, 1);
    assert.match(h2.sent[h2.sent.length - 1].text, /Escuadras registradas: 1/);
  } finally { h2.close(); }
});

test('recuperación: caída durante el recordatorio pero dentro de la gracia → se envía tarde, una vez', async () => {
  const h = await setup();
  const h2 = await restart(h, { at: REMINDER_AT + 3 * 60000 }); // vuelve 3 min después de las 18:50
  try {
    const summary = await h2.scheduler.start();
    assert.equal(summary.runNow, 1);
    assert.equal(sentTexts(h2, /EN 10 MINUTOS/).length, 1);
    await h2.scheduler.runDue();
    assert.equal(sentTexts(h2, /EN 10 MINUTOS/).length, 1);
    assert.equal(pendingOf(h2).filter((j) => j.type === JOB_START).length, 1, 'el inicio sigue programado');
  } finally { h2.close(); }
});

test('recuperación: avisos vencidos fuera de la gracia se marcan perdidos, no se envían y se programa el día siguiente', async () => {
  const h = await setup();
  const h2 = await restart(h, { at: START_AT + 30 * 60000 }); // vuelve a las 19:30
  try {
    const summary = await h2.scheduler.start();
    assert.equal(summary.missed, 2);
    assert.equal(h2.sent.length, 0, 'no se envía "en 10 minutos" ni "iniciada" media hora tarde');
    assert.deepEqual(pendingOf(h2).map((j) => j.id), [`GDC_REM_${GROUP}_2026-10-06_18:50`, `GDC_START_${GROUP}_2026-10-06_19:00`]);
    assert.equal(h2.scheduler.list((j) => j.status === 'missed').length, 2);
  } finally { h2.close(); }
});

test('recuperación: el recordatorio se perdió pero el inicio llega dentro de su gracia → solo se envía el inicio', async () => {
  const h = await setup();
  const h2 = await restart(h, { at: START_AT + 2 * 60000 }); // 19:02
  try {
    const summary = await h2.scheduler.start();
    assert.equal(summary.missed, 1);
    assert.equal(summary.runNow, 1);
    assert.equal(sentTexts(h2, /EN 10 MINUTOS/).length, 0);
    assert.equal(sentTexts(h2, /INICIADA/).length, 1);
  } finally { h2.close(); }
});

test('recuperación: si el proceso murió mientras enviaba, NO se reenvía (preferimos perder un aviso a duplicarlo)', async () => {
  const h = await setup();
  h.clock.t = REMINDER_AT;
  // Simula la caída: el trabajo quedó reclamado ("sending") en disco y el aviso pudo haber salido
  const job = pendingOf(h).find((j) => j.type === JOB_REMINDER);
  job.status = 'sending';
  job.attempts = 1;
  h.db.touch();
  const h2 = await restart(h, { at: REMINDER_AT + 60000 });
  try {
    const summary = await h2.scheduler.start();
    assert.equal(summary.interrupted, 1);
    assert.equal(sentTexts(h2, /EN 10 MINUTOS/).length, 0);
    assert.equal(h2.scheduler.get(job.id).status, 'interrupted');
    assert.ok(pendingOf(h2).some((j) => j.id.includes('2026-10-06_18:50')), 'el día siguiente queda programado');
    assert.ok(pendingOf(h2).some((j) => j.type === JOB_START), 'el inicio de hoy sigue vigente');
  } finally { h2.close(); }
});

test('recuperación: lo ya enviado antes de la caída no se reenvía tras reiniciar', async () => {
  const h = await setup();
  h.clock.t = REMINDER_AT;
  await h.scheduler.runDue();
  assert.equal(sentTexts(h, /EN 10 MINUTOS/).length, 1);
  const h2 = await restart(h, { at: REMINDER_AT + 120000 });
  try {
    await h2.scheduler.start();
    assert.equal(sentTexts(h2, /EN 10 MINUTOS/).length, 0);
    assert.equal(h2.gdc.doc(GROUP).sent.reminder, '2026-10-05');
    h2.clock.t = START_AT;
    await h2.scheduler.runDue();
    assert.equal(sentTexts(h2, /INICIADA/).length, 1);
    assert.equal(sentTexts(h2, /EN 10 MINUTOS/).length, 0);
  } finally { h2.close(); }
});

test('recuperación: si faltan trabajos en el scheduler, syncAll los repone sin duplicar', async () => {
  const h = await setup();
  await g(h, `.verificarclan ${CID2}`, ALICE, { group: GROUP2 });
  // Se pierde la colección programada (p. ej. copia de seguridad antigua)
  for (const id of Object.keys(h.db.col('scheduled'))) h.db.delete('scheduled', id);
  const h2 = await restart(h);
  try {
    assert.equal(h2.scheduler.pending().length, 4, 'dos por clan');
    assert.deepEqual(h2.gdc.syncAll(), { groups: 2, created: 0, cancelled: 0 });
  } finally { h2.close(); }
});

test('recuperación: un clan desactivado o desverificado antes de caer no recibe avisos al volver', async () => {
  const h = await setup();
  await g(h, '.gdc desactivar');
  const h2 = await restart(h, { at: REMINDER_AT });
  try {
    await h2.scheduler.start();
    assert.equal(h2.sent.length, 0);
    assert.equal(h2.scheduler.pending().length, 0);
  } finally { h2.close(); }
});

test('app real: createApp deja la GDC sincronizada y los handlers registrados en el scheduler', async () => {
  const { createApp } = require('../src/app');
  const { buildConfig } = require('../src/config');
  const { tmpDir, cleanup } = require('./helpers');
  const dir = tmpDir();
  const logger = { debug() {}, info() {}, warn() {}, error() {}, close() {}, child() { return logger; } };
  const config = buildConfig({ DATA_DIR: dir, LOG_TO_FILE: 'false', HEALTH_PORT: '0' }, dir);
  const app = createApp({ config, logger, loadBaileys: async () => { throw new Error('sin Baileys'); }, exit: () => {} });
  try {
    assert.ok(app.scheduler.handlers.has(JOB_REMINDER));
    assert.ok(app.scheduler.handlers.has(JOB_START));
    assert.ok(app.registry.has('gdc'));
    assert.equal(app.services.gdc, app.gdc);
  } finally { cleanup(dir); }
});
