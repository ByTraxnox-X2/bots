'use strict';

// Integración: mensajes simulados de WhatsApp → parser → dispatcher → comandos reales → respuestas.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { parseIncoming, parseCommand } = require('../src/handlers/message');
const { Dispatcher, GENERIC_ERROR } = require('../src/handlers/dispatcher');
const { CommandRegistry } = require('../src/commands/registry');
const { PermissionService } = require('../src/middleware/permissions');
const { CommandLimiter } = require('../src/middleware/ratelimit');
const { UserService, UserError } = require('../src/services/users');
const { FreeFireService } = require('../src/providers/freefire/service');
const { registerPlugins } = require('../src/plugins');
const { EventBus } = require('../src/events/bus');
const { Database } = require('../src/database');
const { buildConfig } = require('../src/config');
const { createApp } = require('../src/app');
const { tmpDir, cleanup } = require('./helpers');

const { OWNER, ALICE, BOB, GROUP, UID, silentLogger, fakeRes, harness, playerApi } = require('./harness');

// ---------- parser ----------

test('parseCommand: prefijo, alias en minúsculas, argumentos y rechazos', () => {
  assert.deepEqual(parseCommand('.Perfil  @a   b '), { name: 'perfil', args: ['@a', 'b'], argText: '@a b' });
  assert.equal(parseCommand('hola .perfil'), null);
  assert.equal(parseCommand('... mira'), null);
  assert.equal(parseCommand('. perfil'), null);
  assert.equal(parseCommand('.'), null);
  assert.equal(parseCommand('.!x'), null);
  assert.equal(parseCommand('!ping', '!').name, 'ping');
  assert.equal(parseCommand('.ping', '!'), null);
});

test('parseIncoming: privado, grupo, @lid, mensajes ignorados y envolturas', () => {
  const priv = parseIncoming({ key: { remoteJid: `${ALICE}`, id: '1' }, message: { conversation: '.hola' }, pushName: 'Ali' });
  assert.equal(priv.isGroup, false);
  assert.equal(priv.primarySender, ALICE);
  assert.equal(priv.pushName, 'Ali');

  const grp = parseIncoming({ key: { remoteJid: GROUP, participant: '99887766@lid', participantAlt: `${ALICE.split('@')[0]}:7@s.whatsapp.net`, id: '2' }, message: { conversation: '.x' } });
  assert.equal(grp.isGroup, true);
  assert.deepEqual(grp.senderJids, ['99887766@lid', ALICE]);
  assert.equal(grp.primarySender, ALICE, 'prefiere el número sobre el @lid');

  assert.equal(parseIncoming({ key: { remoteJid: ALICE, fromMe: true, id: '3' }, message: { conversation: 'x' } }), null);
  assert.equal(parseIncoming({ key: { remoteJid: 'status@broadcast', participant: ALICE, id: '4' }, message: { conversation: 'x' } }), null);
  assert.equal(parseIncoming({ key: { remoteJid: ALICE, id: '5' }, message: { imageMessage: {} } }), null);
  assert.equal(parseIncoming({ key: { remoteJid: ALICE, id: '6' }, message: { conversation: 'a'.repeat(2001) } }), null);
  assert.equal(parseIncoming(null), null);

  const wrapped = parseIncoming({ key: { remoteJid: ALICE, id: '7' }, message: { ephemeralMessage: { message: { extendedTextMessage: { text: '.perfil', contextInfo: { mentionedJid: [`${BOB.split('@')[0]}:3@s.whatsapp.net`], participant: BOB } } } } } });
  assert.equal(wrapped.text, '.perfil');
  assert.deepEqual(wrapped.mentions, [BOB]);
  assert.equal(wrapped.quotedSender, BOB);

  const long = parseIncoming({ key: { remoteJid: ALICE, id: '8' }, message: { conversation: 'x' }, messageTimestamp: { toNumber: () => 1700000000 } });
  assert.equal(long.timestampMs, 1700000000000);
});

// ---------- flujo principal ----------

test('flujo: registro → perfil → balance → nivel, con recompensa una sola vez', async () => {
  const h = harness();
  try {
    await h.say('.balance');
    assert.match(h.last(), /registrarte con \*\.registro\*/);

    await h.say('.registro');
    assert.match(h.last(), /Registro completado/);
    assert.match(h.last(), /100 monedas y 50 XP/);
    const u = h.users.find([ALICE]);
    assert.equal(u.coins, 100);
    assert.equal(u.name, 'Alice');

    await h.say('.registro', { id: 'again' });
    // El cooldown de 5 s corta el segundo intento inmediato.
    assert.match(h.last(), /Espera \d+ s/);
    assert.equal(h.users.find([ALICE]).coins, 100);

    await h.say('.perfil');
    assert.match(h.last(), /Alice/);
    assert.match(h.last(), /Monedas: 100/);
    assert.match(h.last(), /Free Fire: sin vincular/);

    await h.say('.saldo'); // alias
    assert.match(h.last(), /Monedas: 100/);

    await h.say('.xp'); // alias
    assert.match(h.last(), /Nivel 1/);
    assert.match(h.last(), /Faltan \d+ XP para el nivel 2/);
  } finally { h.close(); }
});

test('registro con UID inválido no deja un registro a medias', async () => {
  const h = harness();
  try {
    await h.say('.registro abc');
    assert.match(h.last(), /solo puede contener números/);
    assert.equal(h.users.isRegistered([ALICE]), false);
    await h.say('.registro 12345', { from: BOB, id: 'x' });
    assert.equal(h.users.isRegistered([BOB]), true);
  } finally { h.close(); }
});

test('registro con UID verifica con la API y vincula', async () => {
  const h = harness({ fetchImpl: playerApi({ liked: 900 }) });
  try {
    await h.say(`.registro ${UID} sa`);
    const u = h.users.find([ALICE]);
    assert.equal(u.ffUid, UID);
    assert.equal(u.ffVerified, true);
    assert.equal(u.ffSnapshot.data.nickname, 'ProPlayer');
    assert.match(h.last(), /vinculado/);
    assert.match(h.last(), /verificado/);
  } finally { h.close(); }
});

test('mensajes sin comando: sin respuesta, pero cuentan como actividad de usuarios registrados', async () => {
  const h = harness({ env: { ACTIVITY_XP: '5' } });
  try {
    await h.say('hola a todos');
    assert.equal(h.sent.length, 0);
    await h.say('.registro');
    const before = h.users.find([ALICE]).activity.messages;
    await h.say('buenas');
    assert.equal(h.users.find([ALICE]).activity.messages, before + 1);
    await h.say('.comandoquenoexiste');
    assert.equal(h.sent.length, 1, 'los comandos desconocidos se ignoran en silencio');
  } finally { h.close(); }
});

test('una persona que escribe unas veces con su número y otras con su @lid es la misma', async () => {
  const h = harness();
  try {
    const lid = '55501234567@lid';
    await h.d.handleMessage({ key: { remoteJid: GROUP, participant: lid, participantAlt: ALICE, id: 'a1' }, pushName: 'Alice', messageTimestamp: Math.floor(Date.now() / 1000), message: { conversation: '.registro' } });
    assert.equal(h.users.count(), 1);
    await h.d.handleMessage({ key: { remoteJid: GROUP, participant: lid, id: 'a2' }, pushName: 'Alice', messageTimestamp: Math.floor(Date.now() / 1000), message: { conversation: '.nivel' } });
    assert.match(h.last(), /Nivel 1/);
  } finally { h.close(); }
});

// ---------- permisos, alcance, límites ----------

const adminCmd = { name: 'secreto', aliases: [], description: 'Comando de prueba solo admin.', usage: 'secreto', example: 'secreto', category: 'admin', permissions: 'ADMIN', cooldown: 0, handler: async () => 'ok-admin' };
const ownerCmd = { name: 'soloowner', aliases: [], description: 'Comando de prueba solo owner.', usage: 'soloowner', example: 'soloowner', category: 'owner', permissions: 'OWNER', cooldown: 0, handler: async () => 'ok-owner' };
const groupCmd = { name: 'engrupo', aliases: [], description: 'Solo en grupos.', usage: 'engrupo', example: 'engrupo', category: 'general', permissions: 'USER', cooldown: 0, scope: 'group', handler: async () => 'ok-grupo' };
const privCmd = { name: 'enprivado', aliases: [], description: 'Solo en privado.', usage: 'enprivado', example: 'enprivado', category: 'general', permissions: 'USER', cooldown: 0, scope: 'private', handler: async () => 'ok-priv' };
const boomCmd = { name: 'boom', aliases: [], description: 'Falla con error interno.', usage: 'boom', example: 'boom', category: 'general', permissions: 'USER', cooldown: 0, handler: async () => { throw new Error('secreto-interno /ruta/privada'); } };
const userErrCmd = { name: 'uerr', aliases: [], description: 'Falla con UserError.', usage: 'uerr', example: 'uerr', category: 'general', permissions: 'USER', cooldown: 0, handler: async () => { throw new UserError('X', 'Mensaje claro para el usuario'); } };
const pingCmd = { name: 'pong', aliases: [], description: 'Responde pong.', usage: 'pong', example: 'pong', category: 'general', permissions: 'USER', cooldown: 0, handler: async () => 'pong' };
const mentionCmd = { name: 'menciona', aliases: [], description: 'Menciona a quien escribe.', usage: 'menciona', example: 'menciona', category: 'general', permissions: 'USER', cooldown: 0, handler: async (ctx) => ({ text: 'hola @x', mentions: [ctx.sender] }) };
const extras = [adminCmd, ownerCmd, groupCmd, privCmd, boomCmd, userErrCmd, pingCmd, mentionCmd];

test('permisos: USER denegado, OWNER permitido, rol guardado permitido, admin de grupo permitido', async () => {
  const h = harness({ extraCommands: extras, groupAdmins: [{ id: BOB, admin: 'admin' }, { id: '777@lid', phoneNumber: ALICE, admin: null }] });
  try {
    await h.say('.secreto');
    assert.match(h.last(), /No tienes permiso/);
    assert.match(h.last(), /ADMIN/);

    await h.say('.secreto', { from: OWNER, pushName: 'Owner' });
    assert.equal(h.last(), 'ok-admin');
    await h.say('.soloowner', { from: OWNER, id: 'o2' });
    assert.equal(h.last(), 'ok-owner');

    // Admin del grupo de WhatsApp → rol ADMIN solo dentro de ese grupo.
    await h.say('.secreto', { from: BOB, group: GROUP, pushName: 'Bob' });
    assert.equal(h.last(), 'ok-admin');
    await h.say('.secreto', { from: BOB, pushName: 'Bob', id: 'b-priv' });
    assert.match(h.last(), /No tienes permiso/, 'en privado no es admin de nada');
    h.d.denyLimiter.clear(`d:${BOB}`); // los avisos de rechazo se limitan en el tiempo
    await h.say('.soloowner', { from: BOB, group: GROUP, id: 'b2' });
    assert.match(h.last(), /Requiere rol OWNER/);

    // Un participante que NO es admin en la lista no obtiene el rol.
    h.d.denyLimiter.clear(`d:${ALICE}`);
    await h.say('.secreto', { group: GROUP, id: 'a-grp' });
    assert.match(h.last(), /No tienes permiso/);

    // Rol guardado (MOD < ADMIN: no alcanza; ADMIN sí)
    h.permissions.setRole(ALICE, 'MOD');
    h.d.denyLimiter.clear(`d:${ALICE}`);
    await h.say('.secreto', { id: 'a-mod' });
    assert.match(h.last(), /No tienes permiso/);
    h.permissions.setRole(ALICE, 'ADMIN');
    await h.say('.secreto', { id: 'a-adm' });
    assert.equal(h.last(), 'ok-admin');
  } finally { h.close(); }
});

test('permisos: si no se puede consultar el grupo, no se concede admin', async () => {
  const h = harness({ extraCommands: extras, metaFails: true });
  try {
    await h.say('.secreto', { from: BOB, group: GROUP });
    assert.match(h.last(), /No tienes permiso/);
    assert.ok(h.logger.logs.warn.length >= 1);
  } finally { h.close(); }
});

test('permisos: el OWNER se reconoce por número aunque llegue con @lid + número alterno', async () => {
  const h = harness({ extraCommands: extras });
  try {
    await h.d.handleMessage({ key: { remoteJid: GROUP, participant: '4444@lid', participantAlt: OWNER, id: 'ow1' }, pushName: 'Owner', messageTimestamp: Math.floor(Date.now() / 1000), message: { conversation: '.soloowner' } });
    assert.equal(h.last(), 'ok-owner');
  } finally { h.close(); }
});

test('baneados: nunca reciben respuesta', async () => {
  const h = harness({ extraCommands: extras });
  try {
    h.permissions.setBanned(ALICE, true, { reason: 'spam' });
    await h.say('.pong');
    await h.say('hola');
    assert.equal(h.sent.length, 0);
    h.permissions.setBanned(ALICE, false);
    await h.say('.pong', { id: 'p2' });
    assert.equal(h.last(), 'pong');
  } finally { h.close(); }
});

test('alcance: grupo-solo y privado-solo', async () => {
  const h = harness({ extraCommands: extras });
  try {
    await h.say('.engrupo');
    assert.match(h.last(), /solo funciona en grupos/);
    await h.say('.engrupo', { group: GROUP, id: 'g1' });
    assert.equal(h.last(), 'ok-grupo');
    await h.say('.enprivado', { group: GROUP, id: 'g2', from: BOB });
    assert.match(h.last(), /solo funciona en chat privado/);
    await h.say('.enprivado', { id: 'p1' });
    assert.equal(h.last(), 'ok-priv');
  } finally { h.close(); }
});

test('límites: cooldown avisa una sola vez y el spam posterior se ignora', async () => {
  const h = harness();
  try {
    await h.say('.registro');
    await h.say('.balance');
    const after = h.sent.length;
    await h.say('.balance'); // cooldown 3 s
    assert.equal(h.sent.length, after + 1);
    assert.match(h.last(), /Espera \d+ s/);
    await h.say('.balance');
    await h.say('.balance');
    assert.equal(h.sent.length, after + 1, 'no se responde a cada intento');
  } finally { h.close(); }
});

test('límites: tope por usuario en la ventana; el OWNER está exento', async () => {
  const h = harness({ env: { RATE_LIMIT_USER_MAX: '3', RATE_LIMIT_USER_WINDOW: '60' }, extraCommands: extras });
  try {
    for (let i = 0; i < 3; i++) await h.say('.pong', { id: `r${i}` });
    assert.equal(h.sent.filter((s) => s.text === 'pong').length, 3);
    await h.say('.pong', { id: 'r3' });
    assert.match(h.last(), /Vas muy rápido/);
    const n = h.sent.length;
    await h.say('.pong', { id: 'r4' });
    assert.equal(h.sent.length, n, 'segundo rechazo sin aviso');

    for (let i = 0; i < 6; i++) await h.say('.pong', { from: OWNER, id: `o${i}` });
    assert.equal(h.sent.filter((s) => s.text === 'pong').length, 9);
  } finally { h.close(); }
});

test('rechazos de permiso: se responden como mucho una vez cada pocos segundos', async () => {
  const h = harness({ extraCommands: extras });
  try {
    await h.say('.secreto');
    const n = h.sent.length;
    for (let i = 0; i < 5; i++) await h.say('.secreto', { id: `s${i}` });
    assert.equal(h.sent.length, n);
  } finally { h.close(); }
});

// ---------- errores ----------

test('errores: UserError muestra su mensaje; un error interno solo muestra un texto genérico', async () => {
  const h = harness({ extraCommands: extras });
  try {
    await h.say('.uerr');
    assert.equal(h.last(), 'Mensaje claro para el usuario');
    await h.say('.boom');
    assert.equal(h.last(), GENERIC_ERROR);
    assert.ok(!h.sent.some((s) => /secreto-interno|ruta/.test(s.text)), 'no se filtran detalles internos');
    assert.equal(h.logger.logs.error.length, 1);
    // El bot sigue funcionando
    await h.say('.pong');
    assert.equal(h.last(), 'pong');
  } finally { h.close(); }
});

test('errores: si falla el envío de la respuesta no se propaga la excepción', async () => {
  const h = harness({ extraCommands: extras });
  try {
    h.d.wa.sendText = async () => { throw new Error('WhatsApp no está conectado.'); };
    await h.say('.pong');
    assert.ok(h.logger.logs.error.length >= 1);
  } finally { h.close(); }
});

test('respuestas: se citan con el mensaje original y admiten menciones', async () => {
  const h = harness({ extraCommands: extras });
  try {
    await h.say('.menciona');
    const s = h.sent[h.sent.length - 1];
    assert.deepEqual(s.mentions, [ALICE]);
    assert.equal(s.quoted.key.remoteJid, ALICE);
  } finally { h.close(); }
});

// ---------- filtros de entrada ----------

test('entrada: ignora tipos que no son notify, mensajes propios, viejos y duplicados', async () => {
  const h = harness({ extraCommands: extras });
  try {
    h.d.handleUpsert({ type: 'append', messages: [h.msg('.pong')] });
    h.d.handleUpsert({ type: 'notify', messages: [h.msg('.pong', { fromMe: true })] });
    await h.d.drain();
    assert.equal(h.sent.length, 0);

    await h.say('.pong', { ts: Math.floor(Date.now() / 1000) - 3600 });
    assert.equal(h.sent.length, 0, 'mensaje de hace una hora (reconexión) ignorado');

    const m = h.msg('.pong', { id: 'DUP' });
    await h.d.handleMessage(m);
    await h.d.handleMessage(m);
    assert.equal(h.sent.length, 1, 'el mismo id no se procesa dos veces');
  } finally { h.close(); }
});

test('apagado: stop() ignora mensajes nuevos y drain() espera a los que están en curso', async () => {
  let release;
  const slow = { ...pingCmd, name: 'lento', usage: 'lento', example: 'lento', handler: () => new Promise((r) => { release = () => r('listo'); }) };
  const h = harness({ extraCommands: [slow] });
  try {
    h.d.handleUpsert({ type: 'notify', messages: [h.msg('.lento')] });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(h.d.inflight.size, 1);
    h.d.stop();
    h.d.handleUpsert({ type: 'notify', messages: [h.msg('.lento', { id: 'late' })] });
    assert.equal(h.d.inflight.size, 1, 'no entra trabajo nuevo');
    const drained = h.d.drain(2000);
    release();
    assert.equal(await drained, true);
    assert.equal(h.last(), 'listo');
  } finally { h.close(); }
});

test('apagado: drain() devuelve false si un comando se cuelga más del tope', async () => {
  const hang = { ...pingCmd, name: 'colgado', usage: 'colgado', example: 'colgado', handler: () => new Promise(() => {}) };
  const h = harness({ extraCommands: [hang] });
  try {
    h.d.handleUpsert({ type: 'notify', messages: [h.msg('.colgado')] });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(await h.d.drain(100), false);
  } finally { h.close(); }
});

// ---------- vincular / desvincular ----------

test('vincular: verificado, con snapshot real y sin datos inventados', async () => {
  const h = harness({ fetchImpl: playerApi() });
  try {
    await h.say('.registro');
    await h.say(`.vincular ${UID}`);
    const u = h.users.find([ALICE]);
    assert.equal(u.ffVerified, true);
    assert.deepEqual(Object.keys(u.ffSnapshot.data).sort(), ['level', 'nickname', 'uid']);
  } finally { h.close(); }
});

test('vincular: UID inexistente (respuesta definitiva) se rechaza', async () => {
  const h = harness({ fetchImpl: async () => fakeRes(404, { error: 'Player not found' }) });
  try {
    await h.say('.registro');
    await h.say(`.vincular ${UID}`);
    assert.match(h.last(), /No encontré ningún jugador/);
    assert.equal(h.users.find([ALICE]).ffUid, null);
  } finally { h.close(); }
});

test('vincular: API caída → se vincula SIN verificar y se avisa; luego .perfil lo verifica', async () => {
  let up = false;
  const h = harness({ fetchImpl: async (url) => (up ? playerApi()(url) : fakeRes(500, { error: 'x' })) });
  try {
    await h.say('.registro');
    await h.say(`.vincular ${UID}`);
    let u = h.users.find([ALICE]);
    assert.equal(u.ffUid, UID);
    assert.equal(u.ffVerified, false);
    assert.equal(u.ffSnapshot, null);
    assert.match(h.last(), /sin verificar/);

    await h.say('.perfil', { id: 'pf1' });
    assert.match(h.last(), /sin verificar/);
    assert.match(h.last(), /No hay datos de la API todavía/);

    up = true;
    await h.say('.perfil', { id: 'pf2' });
    // El cooldown de 5 s del comando impide repetir de inmediato: se prueba la verificación directo.
    u = h.users.find([ALICE]);
    if (!u.ffVerified) {
      h.d.limiter.limiter.clear(`c:${ALICE}:perfil`);
      await h.say('.perfil', { id: 'pf3' });
      u = h.users.find([ALICE]);
    }
    assert.equal(u.ffVerified, true);
    assert.match(h.last(), /ProPlayer/);
  } finally { h.close(); }
});

test('vincular: API sin configurar → se vincula sin verificar y se explica por qué', async () => {
  const h = harness({ env: { FF_API_URLS: '' } });
  try {
    await h.say('.registro');
    await h.say(`.vincular ${UID}`);
    assert.match(h.last(), /no está configurada/);
    assert.match(h.last(), /sin verificar/);
    assert.equal(h.users.find([ALICE]).ffUid, UID);
  } finally { h.close(); }
});

test('vincular: UID ya usado por otra persona, región inválida, falta UID, sin registro', async () => {
  const h = harness({ fetchImpl: playerApi() });
  try {
    await h.say('.vincular 123456789');
    assert.match(h.last(), /registrarte/);

    await h.say('.registro');
    await h.say('.registro', { from: BOB, pushName: 'Bob' });
    await h.say(`.vincular ${UID}`);
    await h.say(`.vincular ${UID}`, { from: BOB, pushName: 'Bob', id: 'b1' });
    assert.match(h.last(), /ya está vinculado a otro usuario/);
    assert.equal(h.users.find([BOB]).ffUid, null);

    await h.say('.vincular 987654321 xx', { id: 'a2' });
    h.d.limiter.limiter.clear(`c:${ALICE}:vincular`);
    await h.say('.vincular 987654321 xx', { id: 'a3' });
    assert.match(h.last(), /Región no permitida/);

    h.d.limiter.limiter.clear(`c:${ALICE}:vincular`);
    await h.say('.vincular', { id: 'a4' });
    assert.match(h.last(), /Uso: \*\.vincular UID/);
  } finally { h.close(); }
});

test('desvincular: quita el UID; sin UID avisa', async () => {
  const h = harness({ fetchImpl: playerApi() });
  try {
    await h.say('.registro');
    await h.say('.desvincular');
    assert.match(h.last(), /no tienes ningún UID/i);
    h.d.limiter.limiter.clear(`c:${ALICE}:desvincular`);
    await h.say(`.vincular ${UID}`);
    h.d.limiter.limiter.clear(`c:${ALICE}:desvincular`);
    await h.say('.desvincular');
    assert.match(h.last(), /desvinculó el UID/);
    assert.equal(h.users.find([ALICE]).ffUid, null);
  } finally { h.close(); }
});

// ---------- perfil ----------

test('perfil: de otra persona por mención o respuesta; no registrada; solo campos presentes', async () => {
  const h = harness({ fetchImpl: playerApi({ liked: 900 }) });
  try {
    await h.say('.registro', { from: BOB, pushName: 'Bob' });
    await h.say(`.vincular ${UID}`, { from: BOB, id: 'bv' });
    await h.say('.registro');

    await h.say('.perfil @bob', { mentions: [BOB] });
    let s = h.sent[h.sent.length - 1];
    assert.match(s.text, /Bob/);
    assert.deepEqual(s.mentions, [BOB]);
    assert.match(s.text, /ProPlayer/);
    assert.match(s.text, /Likes: 900/);
    assert.ok(!/Rango|Clan|EXP/.test(s.text), 'campos que la API no dio no aparecen');

    h.d.limiter.limiter.clear(`c:${ALICE}:perfil`);
    await h.say('.perfil', { quoted: BOB, id: 'q1' });
    assert.match(h.last(), /Bob/);

    h.d.limiter.limiter.clear(`c:${ALICE}:perfil`);
    await h.say('.perfil @x', { mentions: ['593999999999@s.whatsapp.net'], id: 'q2' });
    assert.match(h.last(), /no está registrado/);
  } finally { h.close(); }
});

test('perfil UID: consulta Free Fire sin tocar el perfil del bot; errores diferenciados', async () => {
  let mode = 'ok';
  const h = harness({
    fetchImpl: async (url) => {
      if (mode === 'down') return fakeRes(503, {});
      if (mode === 'nf') return fakeRes(404, { error: 'not found' });
      return playerApi({ liked: 5 })(url);
    },
  });
  try {
    await h.say(`.perfil ${UID}`);
    assert.match(h.last(), /Perfil de Free Fire/);
    assert.match(h.last(), /ProPlayer/);
    assert.equal(h.users.count(), 0);

    mode = 'nf';
    h.d.limiter.limiter.clear(`c:${ALICE}:perfil`);
    await h.say('.perfil 555555555', { id: 'n1' });
    assert.match(h.last(), /No encontré ningún jugador/);

    mode = 'down';
    h.d.limiter.limiter.clear(`c:${ALICE}:perfil`);
    await h.say('.perfil 666666666', { id: 'n2' });
    assert.match(h.last(), /no respondieron/);
    assert.ok(!/No encontré/.test(h.last()), 'API caída no se confunde con jugador inexistente');
  } finally { h.close(); }
});

// ---------- .ff ----------

test('ff: sin UID y sin vínculo explica el uso; con vínculo usa el propio', async () => {
  const h = harness({ fetchImpl: playerApi({ liked: 7 }) });
  try {
    await h.say('.ff');
    assert.match(h.last(), /Uso: \*\.ff/);
    await h.say('.registro');
    await h.say(`.vincular ${UID}`);
    h.d.limiter.limiter.clear(`c:${ALICE}:ff`);
    await h.say('.ff', { id: 'f2' });
    assert.match(h.last(), /ProPlayer/);
    assert.match(h.last(), /Fuente: ff\.test/);
  } finally { h.close(); }
});

test('ff: full y fffull muestran más campos solo si existen; los códigos de rango no se traducen', async () => {
  const body = { basicInfo: { accountId: UID, nickname: 'P', level: 70, exp: 123456, rank: 321, rankingPoints: 4200, liked: 3 }, clanBasicInfo: { clanId: '9988', clanName: 'Los Test', clanLevel: 5 } };
  const h = harness({ fetchImpl: async () => fakeRes(200, body) });
  try {
    await h.say(`.ff ${UID}`);
    assert.match(h.last(), /Rango BR \(código\): 321/);
    assert.ok(!/EXP|Puntos/.test(h.last()), 'la versión corta no incluye EXP ni puntos');
    h.d.limiter.limiter.clear(`c:${ALICE}:ff`);
    await h.say(`.ff ${UID} full`, { id: 'f2' });
    assert.match(h.last(), /EXP: 123,456/);
    assert.match(h.last(), /Puntos BR: 4,200/);
    assert.match(h.last(), /Clan: Los Test · ID 9988/);
    h.d.limiter.limiter.clear(`c:${ALICE}:fffull`);
    await h.say(`.fffull ${UID}`, { id: 'f3' });
    assert.match(h.last(), /ficha completa/);
    assert.ok(!/Bio|Avatar|Banner|Último login/.test(h.last()), 'sin datos de la API no se muestran esos campos');
  } finally { h.close(); }
});

test('ff: UID inválido, región inválida, sin configurar y API caída', async () => {
  const h = harness({ fetchImpl: async () => fakeRes(500, {}) });
  try {
    await h.say('.ff abc');
    assert.match(h.last(), /solo puede contener números/);
    h.d.limiter.limiter.clear(`c:${ALICE}:ff`);
    await h.say(`.ff ${UID} zz`, { id: 'f2' });
    assert.match(h.last(), /Región no permitida/);
    h.d.limiter.limiter.clear(`c:${ALICE}:ff`);
    await h.say(`.ff ${UID}`, { id: 'f3' });
    assert.match(h.last(), /no respondieron/);
  } finally { h.close(); }

  const h2 = harness({ env: { FF_API_URLS: '' } });
  try {
    await h2.say(`.ff ${UID}`);
    assert.match(h2.last(), /no está configurada/);
  } finally { h2.close(); }
});

// ---------- help ----------

test('help: categorías, categoría, detalle de comando y filtro por rol', async () => {
  const h = harness({ extraCommands: extras });
  try {
    await h.say('.help');
    assert.match(h.last(), /Usuario/);
    assert.match(h.last(), /Free Fire/);
    assert.ok(!/Owner/.test(h.last()), 'un USER no ve la categoría owner');
    assert.ok(!/Admin —/.test(h.last()));

    h.d.limiter.limiter.clear(`c:${ALICE}:help`);
    await h.say('.ayuda usuario', { id: 'h2' });
    assert.match(h.last(), /\.registro/);
    assert.match(h.last(), /\.perfil/);

    h.d.limiter.limiter.clear(`c:${ALICE}:help`);
    await h.say('.help perfil', { id: 'h3' });
    assert.match(h.last(), /Uso: \.perfil/);
    assert.match(h.last(), /Alias: .*\.miperfil/);
    assert.match(h.last(), /Permiso: USER/);

    h.d.limiter.limiter.clear(`c:${ALICE}:help`);
    await h.say('.help soloowner', { id: 'h4' });
    assert.match(h.last(), /No encontré/, 'no revela comandos fuera de su rol');

    await h.say('.help soloowner', { from: OWNER, id: 'h5' });
    assert.match(h.last(), /Permiso: OWNER/);
    await h.say('.help', { from: OWNER, id: 'h6' });
    assert.match(h.last(), /Owner/);

    h.d.limiter.limiter.clear(`c:${ALICE}:help`);
    await h.say('.help zzz', { id: 'h7' });
    assert.match(h.last(), /No encontré/);
  } finally { h.close(); }
});

// ---------- ensamblado ----------

test('createApp: registra todos los comandos y conecta el dispatcher al evento message', async () => {
  const dir = tmpDir();
  const config = buildConfig({ DATA_DIR: dir, LOG_TO_FILE: 'false' }, dir);
  const app = createApp({ config, logger: silentLogger(), loadBaileys: async () => { throw new Error('no se usa'); }, exit: () => {} });
  try {
    for (const name of ['registro', 'vincular', 'desvincular', 'perfil', 'balance', 'nivel', 'ff', 'fffull', 'help']) {
      assert.ok(app.registry.has(name), `falta el comando ${name}`);
    }
    for (const alias of ['saldo', 'monedas', 'xp', 'miperfil', 'freefire', 'ayuda']) assert.ok(app.registry.has(alias), `falta el alias ${alias}`);
    app.db.load();
    assert.equal(app.getStatus().commands, app.registry.size);
  } finally { app.db.close(); cleanup(dir); }
});
