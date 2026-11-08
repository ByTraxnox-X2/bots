'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, say, sayFull, P, GROUP, OWNER } = require('./support');

const ENV = { REGISTER_BONUS_COINS: '0', ACTIVITY_XP: '0' };
const BOT = '593990000001@s.whatsapp.net';

async function mod(opts = {}) {
  const h = await boot({ env: ENV, harness: { self: BOT, ...(opts.harness || {}) } });
  setMeta(h, opts);
  return h;
}

/** Metadatos del grupo: P[1] es admin; el bot es admin salvo botAdmin:false. */
function setMeta(h, { botAdmin = true, announce = false } = {}) {
  h.wa.groupMetadata = async () => ({
    subject: 'Grupo Prueba',
    desc: 'Descripción de prueba',
    creation: 1700000000,
    announce,
    participants: [...P.slice(1, 15).map((id) => ({ id, admin: id === P[1] ? 'admin' : null })), { id: BOT, admin: botAdmin ? 'admin' : null }],
  });
  h.groups.invalidateAll();
  h.d.groupCache.clear();
}

/** Mensaje normal (no comando) de una persona en el grupo. */
async function chat(h, from, text, id) {
  await h.say(text, { group: GROUP, from, id: id || `c-${Math.random()}` });
}

test('.warn/.unwarn/.warns/.warnlist: permisos, protecciones, máximo y acción kick', async () => {
  const h = await mod();
  try {
    assert.match(await say(h, '.warn @x spam', P[3], { mentions: [P[4]] }), /No tienes permiso.*MOD/);
    assert.match(await say(h, '.warn', P[1]), /Uso:/);
    assert.match(await say(h, '.warn @x', P[1], { mentions: [P[1]] }), /administrador del grupo/);
    assert.match(await say(h, '.warn @x', P[1], { mentions: [OWNER] }), /OWNER/);
    assert.match(await say(h, '.warn @x', P[1], { mentions: [BOT] }), /a mí mismo/);
    const out = await sayFull(h, '.warn @x insultos graves', P[1], { mentions: [P[4]] });
    assert.match(out[0].text, /advertencia 1\/3: insultos graves \(W-0001\)/);
    assert.deepEqual(out[0].mentions, [P[4]]);
    assert.match(await say(h, '.warns', P[4]), /Advertencias de .* \(1\/3\)[\s\S]*W-0001.*insultos graves/);
    assert.match(await say(h, '.warns @x', P[5], { mentions: [P[4]] }), /\(1\/3\)/);
    assert.match(await say(h, '.warns', P[5]), /no tiene advertencias/);
    assert.match(await say(h, '.warnlist', P[3]), /No tienes permiso/);
    assert.match(await say(h, '.warnlist', P[1]), /Advertencias del grupo[\s\S]*1\/3.*insultos graves/);
    await say(h, '.warn @x', P[1], { mentions: [P[4]] });
    // Al llegar al máximo (acción por defecto: solo avisar)
    assert.match(await say(h, '.warn @x ultima', P[1], { mentions: [P[4]] }), /3\/3[\s\S]*Llegó al máximo de advertencias/);
    assert.equal(h.removed.length, 0);
    assert.match(await say(h, '.unwarn @x W-0002', P[1], { mentions: [P[4]] }), /Se quitó la advertencia W-0002.*Le quedan 2/);
    assert.match(await say(h, '.unwarn @x W-9999', P[1], { mentions: [P[4]] }), /No encontré la advertencia/);
    assert.match(await say(h, '.unwarn @x', P[1], { mentions: [P[4]] }), /Le quedan 1/);
    await say(h, '.unwarn @x', P[1], { mentions: [P[4]] });
    assert.match(await say(h, '.unwarn @x', P[1], { mentions: [P[4]] }), /no tiene advertencias/);
    // Acción kick: exige que el bot sea admin y expulsa de verdad al llegar al máximo
    assert.match(await say(h, '.grupoconfig maxwarns 2', P[1]), /máximas: 2/);
    assert.match(await say(h, '.grupoconfig warnaccion kick', P[1]), /expulsará/);
    await say(h, '.warn @x', P[1], { mentions: [P[5]] });
    assert.match(await say(h, '.warn @x', P[1], { mentions: [P[5]] }), /2\/2[\s\S]*fue expulsado/);
    assert.deepEqual(h.removed, [{ group: GROUP, jids: [P[5]] }]);
    assert.equal(h.groups.warnsOf(GROUP, P[5]).length, 0);
    // Si el bot ya no es admin, avisa con un error claro y no expulsa
    setMeta(h, { botAdmin: false });
    await say(h, '.warn @x', P[1], { mentions: [P[6]] });
    assert.match(await say(h, '.warn @x', P[1], { mentions: [P[6]] }), /Llegó al máximo, pero: El bot no es administrador/);
    assert.equal(h.removed.length, 1);
    assert.match(await say(h, '.warn @x', P[1], { mentions: [P[7]], }), /advertencia 1\/2/);
    // Solo en grupos
    const priv = h.sent.length;
    await h.say('.warns', { from: P[2] });
    assert.match(h.sent.slice(priv)[0].text, /solo funciona en grupos/);
  } finally { h.close(); }
});

test('.mute/.unmute: exige bot admin, borra mensajes de silenciados, exime admins y vence', async () => {
  const h = await mod({ botAdmin: false });
  try {
    assert.match(await say(h, '.mute @x 5', P[1], { mentions: [P[4]] }), /el bot no es administrador/);
    setMeta(h);
    assert.match(await say(h, '.mute @x 0', P[1], { mentions: [P[4]] }), /entre 1 y 10080/);
    assert.match(await say(h, '.mute @x 5', P[3], { mentions: [P[4]] }), /No tienes permiso/);
    assert.match(await say(h, '.mute @x 5', P[1], { mentions: [P[1]] }), /administrador del grupo/);
    assert.match(await say(h, '.mute', P[1]), /Uso:/);
    assert.match(await say(h, '.mute @x 15 spam repetido', P[1], { mentions: [P[4]] }), /silenciado 15 min: spam repetido/);
    await chat(h, P[4], 'hola a todos', 'm-1');
    await chat(h, P[1], 'soy admin', 'm-2');
    await chat(h, P[5], 'otro usuario', 'm-3');
    assert.deepEqual(h.deleted.map((d) => d.key.id), ['m-1']);
    // Un silenciado tampoco puede usar comandos
    const n = h.sent.length;
    await h.say('.perfil', { group: GROUP, from: P[4], id: 'm-4' });
    assert.equal(h.sent.length, n);
    assert.deepEqual(h.deleted.map((d) => d.key.id), ['m-1', 'm-4']);
    assert.match(await say(h, '.unmute @x', P[1], { mentions: [P[5]] }), /no está silenciada/);
    // Vence solo
    h.clock.t += 16 * 60000;
    await chat(h, P[4], 'ya pasó el tiempo', 'm-5');
    assert.equal(h.deleted.length, 2);
    await say(h, '.mute @x 60', P[1], { mentions: [P[4]] });
    assert.match(await say(h, '.unmute @x', P[1], { mentions: [P[4]] }), /ya puede escribir/);
    await chat(h, P[4], 'libre', 'm-6');
    assert.equal(h.deleted.length, 2);
  } finally { h.close(); }
});

test('.antilinks/.antispam/.antiflood: activar exige bot admin; borran, advierten y eximen a admins', async () => {
  const h = await mod({ botAdmin: false });
  try {
    assert.match(await say(h, '.antilinks on', P[1]), /el bot no es administrador/);
    assert.match(await say(h, '.antilinks', P[3]), /No tienes permiso.*ADMIN/);
    setMeta(h);
    assert.match(await say(h, '.antilinks', P[1]), /antilinks: 🔴 desactivado/);
    assert.match(await say(h, '.antilinks maybe', P[1]), /Uso:/);
    assert.match(await say(h, '.antilinks on', P[1]), /antilinks activado/);
    await chat(h, P[3], 'mira https://ejemplo.com/promo', 'l-1');
    await chat(h, P[3], 'sin enlaces aquí, solo texto', 'l-2');
    await chat(h, P[1], 'admin puede https://ejemplo.com', 'l-3');
    await chat(h, P[3], 'únete chat.whatsapp.com/ABCDEF', 'l-4');
    assert.deepEqual(h.deleted.map((d) => d.key.id), ['l-1', 'l-4']);
    assert.equal(h.groups.warnsOf(GROUP, P[3]).length, 2);
    assert.ok(h.sent.some((s) => /advertencia 1\/3: enlaces no permitidos/.test(s.text) && s.mentions.includes(P[3])));
    assert.match(await say(h, '.antilinks off', P[1]), /desactivado/);
    await chat(h, P[3], 'otra https://ejemplo.com', 'l-5');
    assert.equal(h.deleted.length, 2);

    // Antispam: la 3.ª repetición igual se borra
    assert.match(await say(h, '.antispam on 3 30', P[1]), /antispam activado.*3 iguales en 30 s/);
    await chat(h, P[4], 'comprar seguidores', 's-1');
    await chat(h, P[4], 'comprar seguidores', 's-2');
    await chat(h, P[4], 'Comprar   seguidores', 's-3');
    await chat(h, P[4], 'otra cosa distinta', 's-4');
    assert.deepEqual(h.deleted.slice(2).map((d) => d.key.id), ['s-3']);
    assert.ok(h.groups.warnsOf(GROUP, P[4]).some((w) => /spam/.test(w.reason)));

    // Antiflood: más de 3 mensajes en 10 s
    assert.match(await say(h, '.antiflood on 3 10', P[1]), /antiflood activado.*más de 3 en 10 s/);
    for (let i = 1; i <= 5; i++) await chat(h, P[5], `msg ${i}`, `f-${i}`);
    assert.deepEqual(h.deleted.slice(3).map((d) => d.key.id), ['f-4', 'f-5']);
    h.clock.t += 11000;
    await chat(h, P[5], 'tras esperar', 'f-6');
    assert.equal(h.deleted.length, 5);
    assert.match(await say(h, '.antiflood on 99', P[1]), /entre 2 y 30/);
    assert.match(await say(h, '.antiflood off', P[1]), /desactivado/);
    assert.match(await say(h, '.antispam off', P[1]), /desactivado/);
  } finally { h.close(); }
});

test('moderación automática: si el bot ya no puede borrar, no sanciona y el comando se procesa', async () => {
  const h = await mod({ harness: { deleteFails: true } });
  try {
    await say(h, '.antilinks on', P[1]);
    const n = h.sent.length;
    await chat(h, P[3], 'https://ejemplo.com', 'x-1');
    assert.equal(h.deleted.length, 0);
    assert.equal(h.groups.warnsOf(GROUP, P[3]).length, 0);
    assert.equal(h.sent.length, n);
    assert.match(await say(h, '.balance', P[3]), /monedas/i);
  } finally { h.close(); }
});

test('.welcome y .goodbye: configuración, evento de participantes, duplicados y fallos de envío', async () => {
  const h = await mod();
  try {
    assert.match(await say(h, '.welcome', P[3]), /No tienes permiso/);
    assert.match(await say(h, '.welcome', P[1]), /Bienvenida: 🔴 desactivado[\s\S]*por defecto/);
    assert.match(await say(h, '.welcome texto', P[1]), /Uso:/);
    assert.match(await say(h, '.welcome texto ab', P[1]), /entre 3 y 300/);
    assert.match(await say(h, '.welcome texto Hola {usuario}, bienvenido a {grupo} ({miembros})', P[1]), /Vista previa:[\s\S]*Grupo Prueba/);
    assert.match(await say(h, '.welcome x', P[1]), /Uso:/);
    const joiner = '593995550001@s.whatsapp.net';
    let n = h.sent.length;
    await h.groups.onParticipants({ id: GROUP, action: 'add', participants: [joiner] });
    assert.equal(h.sent.length, n, 'desactivada: no envía');
    assert.match(await say(h, '.welcome on', P[1]), /activada/);
    h.clock.t += 60000;
    await h.groups.onParticipants({ id: GROUP, action: 'add', participants: [{ id: joiner }] });
    const msg = h.sent[h.sent.length - 1];
    assert.match(msg.text, /Hola @593995550001, bienvenido a Grupo Prueba \(15\)/);
    assert.deepEqual(msg.mentions, [joiner]);
    n = h.sent.length;
    await h.groups.onParticipants({ id: GROUP, action: 'add', participants: [joiner] }); // evento repetido
    assert.equal(h.sent.length, n);
    await h.groups.onParticipants({ id: GROUP, action: 'add', participants: [BOT] }); // el propio bot
    assert.equal(h.sent.length, n);
    await h.groups.onParticipants({ id: GROUP, action: 'promote', participants: [joiner] });
    assert.equal(h.sent.length, n);
    // Despedida
    await h.groups.onParticipants({ id: GROUP, action: 'remove', participants: [joiner] });
    assert.equal(h.sent.length, n, 'despedida desactivada');
    assert.match(await say(h, '.goodbye on', P[1]), /activada/);
    assert.match(await say(h, '.goodbye ver', P[1]), /Despedida: 🟢 activado/);
    h.clock.t += 60000;
    await h.groups.onParticipants({ id: GROUP, action: 'remove', participants: [joiner] });
    assert.match(h.sent[h.sent.length - 1].text, /@593995550001 salió de \*Grupo Prueba\*/);
    assert.match(await say(h, '.goodbye texto Chao {usuario}', P[1]), /actualizado/);
    assert.match(await say(h, '.goodbye off', P[1]), /desactivada/);
    // Un fallo de envío no rompe nada
    await say(h, '.welcome on', P[1]);
    h.wa.sendText = async () => { throw new Error('sin permiso'); };
    h.clock.t += 60000;
    await h.groups.onParticipants({ id: GROUP, action: 'add', participants: [joiner] });
    assert.ok(h.logger.logs.warn.length > 0);
  } finally { h.close(); }
});

test('.tagall/.hidetag/.admins/.groupinfo/.permisos: datos reales del grupo', async () => {
  const h = await mod();
  try {
    assert.match(await say(h, '.tagall hola', P[3]), /No tienes permiso/);
    const tag = await sayFull(h, '.tagall Hoy hay scrim', P[1]);
    assert.equal(tag.length, 1);
    assert.match(tag[0].text, /Mención general\*\nHoy hay scrim\n@/);
    assert.equal(tag[0].mentions.length, 14);
    assert.ok(!tag[0].mentions.includes(BOT));
    assert.match(await say(h, '.hidetag', P[1]), /Uso:/);
    assert.match(await say(h, '.hidetag Reunión ya', P[3]), /No tienes permiso/);
    const hid = await sayFull(h, '.hidetag Reunión ya', P[1]);
    assert.equal(hid[0].text, 'Reunión ya');
    assert.equal(hid[0].mentions.length, 14);
    const ad = await sayFull(h, '.admins', P[3]);
    assert.match(ad[0].text, /Administradores \(2\)/);
    assert.deepEqual([...ad[0].mentions].sort(), [P[1], BOT].sort());
    const info = await say(h, '.groupinfo', P[3]);
    assert.match(info, /Grupo Prueba[\s\S]*Descripción de prueba[\s\S]*Miembros: 15 · Administradores: 2[\s\S]*Creado: 2023-11-14[\s\S]*Bot administrador: sí[\s\S]*sin clan verificado[\s\S]*antilinks no/);
    assert.match(await say(h, '.permisos', P[1]), /Rol de tu cuenta: \*ADMIN\* \(admin del grupo\)[\s\S]*El bot es administrador/);
    assert.match(await say(h, '.permisos', P[3]), /\*USER\*/);
    assert.match(await say(h, '.permisos @x', P[3], { mentions: [OWNER] }), /\*OWNER\*/);
    assert.match(await say(h, '.permisos @x', P[3], { mentions: [P[1]] }), /\*ADMIN\* \(admin del grupo\)/);
    setMeta(h, { botAdmin: false, announce: true });
    assert.match(await say(h, '.permisos', P[3]), /NO es administrador/);
    assert.match(await say(h, '.groupinfo', P[3]), /Solo los administradores pueden escribir[\s\S]*Bot administrador: no/);
    h.wa.groupMetadata = async () => { throw new Error('caído'); };
    h.groups.invalidateAll();
    assert.match(await say(h, '.admins', P[3]), /No pude consultar el grupo/);
    assert.match(await say(h, '.tagall', P[1]), /No pude obtener la lista de miembros/);
  } finally { h.close(); }
});

test('.grupoconfig y .modlogs: ajustes validados, estado y registro de moderación', async () => {
  const h = await mod();
  try {
    assert.match(await say(h, '.grupoconfig', P[3]), /No tienes permiso/);
    assert.match(await say(h, '.grupoconfig', P[1]), /Configuración del grupo[\s\S]*Antilinks: 🔴[\s\S]*Advertencias máximas: 3 → al llegar: solo avisar/);
    assert.match(await say(h, '.grupoconfig zzz', P[1]), /Ajuste desconocido/);
    assert.match(await say(h, '.grupoconfig maxwarns', P[1]), /Uso:/);
    assert.match(await say(h, '.grupoconfig maxwarns 99', P[1]), /entre 1 y 10/);
    assert.match(await say(h, '.grupoconfig warnaccion explotar', P[1]), /nada.*kick/);
    assert.match(await say(h, '.grupoconfig warnaccion nada', P[1]), /solo se avisará/);
    assert.match(await say(h, '.grupoconfig flood 5', P[1]), /Uso:/);
    assert.match(await say(h, '.grupoconfig flood 5 20', P[1]), /más de 5 mensajes en 20 s/);
    assert.match(await say(h, '.grupoconfig spam 4 60', P[1]), /4 mensajes iguales en 60 s/);
    assert.match(await say(h, '.grupoconfig spam 1 60', P[1]), /entre 2 y 10/);
    assert.match(await say(h, '.grupoconfig', P[1]), /Antispam: 🔴 desactivado \(4 mensajes iguales en 60 s\)[\s\S]*Antiflood: 🔴 desactivado \(más de 5 mensajes en 20 s\)/);
    assert.match(await say(h, '.modlogs', P[3]), /No tienes permiso/);
    await say(h, '.warn @x motivo', P[1], { mentions: [P[4]] });
    await say(h, '.antilinks on', P[1]);
    const logs = await say(h, '.modlogs 5', P[1]);
    assert.match(logs, /Registro de moderación[\s\S]*antilinks por Jugador1 — activar[\s\S]*warn por Jugador1 — .*motivo/);
    assert.match(await say(h, '.modlogs 99', P[1]), /Uso:/);
    // Los registros de un grupo no se ven en otro
    assert.deepEqual(h.groups.modLogs('120363000000000099@g.us', 5), []);
    // Persistencia: la configuración sobrevive a un reinicio
    h.db.close();
    const { harness } = require('./harness');
    const h2 = harness({ dir: h.dir, startAt: h.clock.t, env: ENV });
    try {
      const m = h2.groups.peek(GROUP);
      assert.equal(m.antilinks, true);
      assert.equal(m.floodMax, 5);
      assert.equal(h2.groups.warnsOf(GROUP, P[4]).length, 1);
    } finally { h2.close(); }
  } finally { h.close(); }
});
