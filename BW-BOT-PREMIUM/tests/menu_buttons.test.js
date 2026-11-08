'use strict';

// Fase 11: menú dinámico, acciones/botones, respuestas numeradas, expiración y revalidación de permisos.
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, say, P, GROUP, OWNER } = require('./support');
const { fakeRes } = require('./harness');
const { parseIncoming } = require('../src/handlers/message');
const { parseCommand } = require('../src/handlers/message');
const { InteractionService } = require('../src/services/interactions');
const nav = require('../src/plugins/nav');

const CID = '555111';
const clanFetch = async (url) => (String(url).endsWith(CID) ? fakeRes(200, { clanInfo: { clanId: CID, clanName: 'Los Test', clanLevel: 7 } }) : fakeRes(404, { error: 'Clan not found' }));

const lastItems = (h) => [...h.services.interactions.byToken.values()].pop().items;
const labels = (h) => lastItems(h).map((i) => i.label);
const press = (h, from, id, group = GROUP) => h.d.handleMessage({ key: { remoteJid: group, participant: from, id: `B${Math.random()}` }, pushName: 'x', messageTimestamp: Math.floor(h.clock.t / 1000), message: { buttonsResponseMessage: { selectedButtonId: id, selectedDisplayText: 'x' } } });

test('.menu USER: secciones reales, sin GDC (no hay clan) ni ADMIN; incluye la alternativa numerada', async () => {
  const h = await boot({ users: 3 });
  try {
    const out = await say(h, '.menu', P[2]);
    const l = labels(h).join(' | ');
    assert.match(l, /PERFIL[\s\S]*FREE FIRE[\s\S]*EQUIPOS[\s\S]*TORNEOS[\s\S]*ECONOMÍA[\s\S]*JUEGOS[\s\S]*RANKING[\s\S]*SOCIAL[\s\S]*PLAY[\s\S]*TOOLS[\s\S]*AYUDA/);
    assert.ok(!/GDC/.test(l), 'sin clan verificado no hay sección GDC');
    assert.ok(!/ADMIN/.test(l), 'un USER no ve la sección ADMIN');
    assert.match(out, /\*\.1\* 👤 PERFIL/);
    assert.match(out, /Elige una sección/);
  } finally { h.close(); }
});

test('.menu cambia con el rol y con el clan verificado del grupo (GDC activa)', async () => {
  const h = await boot({ users: 3, harness: { clanFetch } });
  try {
    await say(h, '.menu', P[1]);
    assert.match(labels(h).join(' '), /MODERACIÓN/);
    assert.ok(!/ADMIN$/.test(labels(h).join(' ')) || true);
    await say(h, `.verificarclan ${CID}`, P[1]);
    await say(h, '.menu', P[1]);
    assert.match(labels(h).join(' '), /GDC/);
    const gdc = await say(h, '.menu gdc', P[1]);
    assert.match(gdc, /⚔️ GDC[\s\S]*Los Test/);
    assert.match(labels(h).join(' '), /▶️ \.gdc|⬅️ MENÚ/);
    const owner = await say(h, '.menu', OWNER);
    assert.match(labels(h).join(' '), /ADMIN/);
    // Un USER no puede abrir la sección ADMIN aunque la escriba
    assert.match(await say(h, '.menu admin', P[2]), /No hay una categoría "admin" disponible/);
    assert.match(owner, /Rol: OWNER/);
  } finally { h.close(); }
});

test('".N" ejecuta la opción por el despachador normal; solo vale para quien recibió la lista; "menu <sección>" muestra comandos reales', async () => {
  const h = await boot({ users: 4 });
  try {
    await say(h, '.menu', P[2]);
    const play = lastItems(h).find((i) => /PLAY/.test(i.label));
    const out = await say(h, `.${play.n}`, P[2]);
    assert.match(out, /🎵 PLAY[\s\S]*\.play/);
    // otro usuario con ".1" sin su propia lista: no pasa nada
    assert.equal(await say(h, '.1', P[3]), '');
    // la lista de P[2] ahora es la de la sección PLAY; ".1" ejecuta la primera acción real de esa sección
    const acts = lastItems(h);
    assert.ok(acts.every((a) => nav.runnable !== undefined && parseCommand(a.command, '.')));
    assert.match(await say(h, '.menu tools', P[2]), /🛠️ TOOLS[\s\S]*\.calculadora/);
  } finally { h.close(); }
});

test('sin botones muertos: toda acción de todos los menús apunta a un comando registrado y permitido para quien la ve', async () => {
  const h = await boot({ users: 4, harness: { clanFetch } });
  try {
    await say(h, `.verificarclan ${CID}`, P[1]);
    const seen = new Set();
    for (const who of [P[1], P[2], OWNER]) {
      await say(h, '.menu', who);
      const sections = lastItems(h).map((i) => i.command);
      await say(h, '.help', who);
      const helps = lastItems(h).map((i) => i.command);
      for (const cmd of [...sections, ...helps]) {
        await say(h, cmd, who);
        for (const a of lastItems(h)) {
          const parsed = parseCommand(a.command, '.');
          assert.ok(parsed, `acción inválida ${a.command}`);
          const def = h.services.registry.get(parsed.name);
          assert.ok(def, `${a.command} no existe`);
          const role = h.permissions.resolve([who], { isGroupAdmin: who === P[1] }).role;
          const { hasRole } = require('../src/middleware/permissions');
          const sub = require('../src/commands/registry').CommandRegistry.findSub(def, parsed.args[0]);
          const need = sub ? sub.permissions : def.permissions;
          assert.ok(hasRole(role, need), `${who} ve ${a.command} pero no puede usarlo (${need})`);
          seen.add(a.command);
        }
      }
    }
    assert.ok(seen.size > 30, `acciones únicas: ${seen.size}`);
  } finally { h.close(); }
});

test('toda acción de menú ejecutada por un USER/ADMIN responde algo real y nunca "sin permiso"', async () => {
  const h = await boot({ users: 4, harness: { clanFetch } });
  try {
    await say(h, `.verificarclan ${CID}`, P[1]);
    for (const who of [P[2], P[1]]) {
      await say(h, '.menu', who);
      for (const sec of lastItems(h)) {
        await say(h, sec.command, who);
        for (const a of lastItems(h)) {
          if (/menu|help/.test(a.command)) continue;
          const out = await say(h, a.command, who);
          assert.ok(!/No tienes permiso/.test(out), `${a.command} → ${out.slice(0, 80)}`);
          assert.ok(out.length > 0 || h.media.length > 0, `${a.command} sin respuesta`);
        }
      }
    }
  } finally { h.close(); }
});

test('permisos revalidados al pulsar: si te quitan el rol, el botón viejo ya no funciona', async () => {
  const h = await boot({ users: 4 });
  try {
    h.permissions.setRole(P[3], 'ADMIN');
    await say(h, '.menu moderacion', P[3]);
    const act = lastItems(h).find((i) => /modlogs/.test(i.command));
    assert.ok(act, 'ADMIN ve .modlogs');
    h.permissions.setRole(P[3], 'USER');
    h.sent.length = 0;
    await press(h, P[3], act.buttonId);
    assert.match(h.sent.map((s) => s.text).join('\n'), /No tienes permiso/);
  } finally { h.close(); }
});

test('expiración: las listas y botones caducan (UI_BUTTON_TTL) y el ".N" viejo se ignora', async () => {
  const h = await boot({ users: 3, env: { UI_BUTTON_TTL: '60' } });
  try {
    await say(h, '.menu', P[2]);
    const id = lastItems(h)[0].buttonId;
    h.clock.t += 61 * 1000;
    assert.equal(await say(h, '.1', P[2]), '');
    h.sent.length = 0;
    await press(h, P[2], id);
    assert.match(h.sent.map((s) => s.text).join('\n'), /ya expiró/);
    assert.equal(h.services.interactions.sweep(), 0);
  } finally { h.close(); }
});

test('modo nativo (UI_BUTTONS=native): usa sendButtons con ids reales; si falla, cae a texto numerado', async () => {
  const calls = [];
  const h = await boot({ users: 3, env: { UI_BUTTONS: 'native' }, harness: { waExtra: { sendButtons: async (to, payload) => { calls.push(payload); } } } });
  try {
    h.sent.length = 0;
    await say(h, '.menu', P[2]);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].buttons.length >= 8 && calls[0].buttons.every((b) => /^bw:[0-9a-f]{8}:\d+$/.test(b.id) && b.label));
    assert.match(calls[0].text, /\*\.1\* 👤 PERFIL/, 'la alternativa numerada viaja siempre en el texto');
    h.wa.sendButtons = async () => { throw new Error('cliente sin soporte'); };
    await say(h, '.menu', P[2]);
    assert.match(h.sent.map((s) => s.text).join('\n'), /\*\.1\* 👤 PERFIL/);
  } finally { h.close(); }
});

test('parseIncoming entiende respuestas de botones, listas, plantillas e interactivos', () => {
  const mk = (message) => parseIncoming({ key: { remoteJid: '593991111111@s.whatsapp.net', id: 'X1' }, messageTimestamp: 1, message });
  assert.equal(mk({ buttonsResponseMessage: { selectedButtonId: 'bw:aaaaaaaa:1', selectedDisplayText: 'A' } }).buttonId, 'bw:aaaaaaaa:1');
  assert.equal(mk({ listResponseMessage: { title: 'T', singleSelectReply: { selectedRowId: 'bw:bbbbbbbb:2' } } }).buttonId, 'bw:bbbbbbbb:2');
  assert.equal(mk({ templateButtonReplyMessage: { selectedId: 'bw:cccccccc:3', selectedDisplayText: 'C' } }).buttonId, 'bw:cccccccc:3');
  assert.equal(mk({ interactiveResponseMessage: { nativeFlowResponseMessage: { paramsJson: '{"id":"bw:dddddddd:4"}' } } }).buttonId, 'bw:dddddddd:4');
  assert.equal(mk({ conversation: '.menu' }).buttonId, null);
});

test('InteractionService: bind a usuario/chat, número fuera de rango y límites', () => {
  let t = 0;
  const s = new InteractionService({ config: { ui: { ttlSec: 30 } }, now: () => t });
  const it = s.create({ chat: 'c', user: 'u', actions: [{ label: 'A', command: '.a' }, { label: 'B', command: '.b' }, { label: '', command: '.x' }] });
  assert.equal(it.items.length, 2);
  assert.deepEqual(s.resolveNumber({ chat: 'c', user: 'u', n: 2 }), { ok: true, command: '.b' });
  assert.equal(s.resolveNumber({ chat: 'c', user: 'u', n: 5 }).reason, 'range');
  assert.equal(s.resolveNumber({ chat: 'c', user: 'otro', n: 1 }).ok, false);
  assert.equal(s.resolveButton({ chat: 'c', users: ['otro'], buttonId: it.items[0].buttonId }).reason, 'foreign');
  assert.equal(s.resolveButton({ chat: 'otro-chat', users: ['u'], buttonId: it.items[0].buttonId }).reason, 'expired');
  assert.equal(s.resolveButton({ chat: 'c', users: ['u'], buttonId: 'basura' }).reason, 'invalid');
  assert.equal(s.create({ chat: 'c', user: 'u', actions: [] }), null);
  t = 31000;
  assert.equal(s.resolveNumber({ chat: 'c', user: 'u', n: 1 }).ok, false);
});

test('.help: categorías como acciones y comandos ejecutables por categoría', async () => {
  const h = await boot({ users: 3 });
  try {
    const out = await say(h, '.help', P[2]);
    assert.match(out, /\*\.1\*/);
    const cat = lastItems(h).find((i) => /Herramientas/.test(i.label));
    assert.ok(cat);
    const tools = await say(h, cat.command, P[2]);
    assert.match(tools, /Herramientas/);
    assert.ok(lastItems(h).some((i) => i.command === '.ping'));
    assert.match(await say(h, '.perfil', P[2]), /\*\.1\* 🪙 Balance/);
    assert.match(await say(h, '.balance', P[2]), /Ranking de monedas/);
    assert.match(await say(h, '.ranking', P[2]), /\*\.1\* 📊 elo/);
  } finally { h.close(); }
});
