'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { normalizeClan } = require('../src/providers/clans/normalize');
const { ClanApiService } = require('../src/providers/clans/service');
const { ClanService, sanitizeFreeText, CONFIG_KEYS } = require('../src/services/clans');
const { Database } = require('../src/database');
const { buildConfig, validateConfig } = require('../src/config');
const { OWNER, ALICE, BOB, GROUP, silentLogger, fakeRes, harness } = require('./harness');
const { tmpDir, cleanup } = require('./helpers');

const GROUP2 = '120363000000000002@g.us';
const CID = '555111';

const CLAN = {
  clanInfo: { clanId: CID, clanName: 'Los Test', clanLevel: 7, memberNum: 3, capacity: 50, notice: 'Clan de pruebas', score: 1200 },
  captainBasicInfo: { accountId: '111', nickname: 'Capi', level: 60 },
  members: [
    { accountId: '111', nickname: 'Capi', level: 60, role: 1 },
    { accountId: '222', nickname: 'Dos', level: 40, role: 3 },
    { accountId: '333', nickname: 'Tres' },
  ],
};

/** fetch falso de clanes: { '555111': body | status } */
const clanFetchFrom = (table) => async (url) => {
  const id = String(url).split('/').pop().split('?')[0];
  const entry = table[id];
  if (entry === undefined) return fakeRes(404, { error: 'Clan not found' });
  if (typeof entry === 'number') return fakeRes(entry, { error: 'x' });
  return fakeRes(200, entry);
};

const admins = [{ id: ALICE, admin: 'admin' }];
const reset = (h, cmd, who = ALICE) => h.d.limiter.limiter.clear(`c:${who}:${cmd}`);
const sayIn = async (h, text, opts = {}) => {
  reset(h, text.split(/\s+/)[0].slice(1), opts.from || ALICE);
  h.d.denyLimiter.clear(`d:${opts.from || ALICE}`);
  await h.say(text, { group: GROUP, ...opts });
};

// ---------- normalizador ----------

test('normalizar clan: campos presentes, líder anidado, miembros y nada inventado', () => {
  const { found, data } = normalizeClan(CLAN);
  assert.equal(found, true);
  assert.equal(data.clanId, CID);
  assert.equal(data.name, 'Los Test');
  assert.equal(data.level, 7);
  assert.equal(data.memberCount, 3);
  assert.equal(data.capacity, 50);
  assert.equal(data.score, 1200);
  assert.equal(data.description, 'Clan de pruebas');
  assert.deepEqual(data.leader, { uid: '111', nickname: 'Capi', level: 60 });
  assert.equal(data.members.length, 3);
  assert.deepEqual(data.members[2], { uid: '333', nickname: 'Tres' });
  assert.equal(data.region, undefined);
  assert.equal(data.createdAt, undefined);
});

test('normalizar clan: mínimo, líder plano, respuesta vacía y datos de miembros que no se confunden con el clan', () => {
  assert.deepEqual(normalizeClan({ id: '9', name: 'X' }), { found: true, data: { clanId: '9', name: 'X' } });
  assert.equal(normalizeClan({ status: 'ok', data: {} }).found, false);
  assert.equal(normalizeClan(null).found, false);
  assert.equal(normalizeClan('texto').found, false);
  const flat = normalizeClan({ guild: { guildId: '77', guildName: 'G', captainName: 'Jefe', captainId: '5' } });
  assert.deepEqual(flat.data.leader, { uid: '5', nickname: 'Jefe' });
  // El nombre/nivel de un miembro NO debe tomarse como el del clan
  const noClanName = normalizeClan({ clan: { clanId: '1' }, members: [{ nickname: 'Solo', level: 99 }] });
  assert.equal(noClanName.data.name, undefined);
  assert.equal(noClanName.data.level, undefined);
  // Si la API no da el total, el tamaño real de la lista sí es un dato de la respuesta
  assert.equal(normalizeClan({ name: 'A', members: [{ nickname: 'a' }, { nickname: 'b' }] }).data.memberCount, 2);
  const created = normalizeClan({ clanName: 'F', createTime: 1700000000 });
  assert.equal(created.data.createdAt, '2023-11-14T22:13:20.000Z');
  assert.equal(normalizeClan({ clanName: 'F', createTime: 5 }).data.createdAt, undefined, 'fecha imposible descartada');
});

// ---------- servicio de API ----------

test('ClanApiService: validación, no configurado, no encontrado, caído y datos de otro clan', async () => {
  const cfg = (env) => buildConfig({ CLAN_API_TIMEOUT: '500', ...env }, '/x');
  const none = new ClanApiService({ config: cfg({}) });
  assert.equal((await none.lookup('12345')).kind, 'NOT_CONFIGURED');
  assert.match((await none.lookup('12345')).message, /CLAN_API_URLS/);

  const svc = new ClanApiService({ config: cfg({ CLAN_API_URLS: 'https://c.test/clan/{id}' }), fetchImpl: clanFetchFrom({ [CID]: CLAN, 777: 503, 888: { clanInfo: { clanId: '999', clanName: 'Otro' } } }) });
  assert.equal((await svc.lookup('ab')).kind, 'INVALID_ID');
  assert.equal((await svc.lookup('12')).kind, 'INVALID_ID');
  const ok = await svc.lookup(CID);
  assert.equal(ok.ok, true);
  assert.equal(ok.id, CID);
  assert.equal(ok.data.name, 'Los Test');
  assert.equal(Object.isFrozen(ok.data), true);
  const nf = await svc.lookup('424242');
  assert.equal(nf.kind, 'NOT_FOUND');
  assert.match(nf.message, /ningún clan/);
  const down = await svc.lookup('777');
  assert.equal(down.kind, 'API_DOWN');
  const mismatch = await svc.lookup('888');
  assert.equal(mismatch.ok, false, 'datos de otro clan se rechazan');
  assert.notEqual(mismatch.kind, 'NOT_FOUND');
});

test('ClanApiService: la clave solo viaja en URLs con {key}; sin región no se exige', async () => {
  const urls = [];
  const fetchImpl = async (url) => { urls.push(String(url)); return fakeRes(200, CLAN); };
  const svc = new ClanApiService({ config: buildConfig({ CLAN_API_URLS: 'https://a.test/c/{id}?k={key},https://b.test/c', CLAN_API_KEY: 'SECRETO' }, '/x'), fetchImpl });
  assert.equal(svc.providers[0].needsKey, true);
  await svc.lookup(CID);
  assert.ok(urls[0].includes('k=SECRETO'));
  const svc2 = new ClanApiService({ config: buildConfig({ CLAN_API_URLS: 'https://b.test/c', CLAN_API_KEY: 'SECRETO' }, '/x'), fetchImpl });
  urls.length = 0;
  await svc2.lookup(CID);
  assert.equal(urls[0], `https://b.test/c?id=${CID}`);
  assert.ok(!urls[0].includes('SECRETO'));
  // Plantilla con {key} y sin clave: no se usa y se reporta mal configurada
  const mis = new ClanApiService({ config: buildConfig({ CLAN_API_URLS: 'https://a.test/c/{id}?k={key}' }, '/x') });
  assert.equal(mis.configured, false);
});

test('config: CLAN_API_URLS inválida se detecta', () => {
  const problems = validateConfig(buildConfig({ CLAN_API_URLS: 'ftp://x/{id},https://ok/{id}' }, '/x'));
  assert.ok(problems.some((p) => /CLAN_API_URLS/.test(p)));
  assert.deepEqual(validateConfig(buildConfig({ CLAN_API_URLS: 'https://ok/{id}' }, '/x')), []);
});

// ---------- servicio local ----------

test('ClanService: textos libres saneados y claves de configuración válidas', () => {
  assert.equal(sanitizeFreeText('  hola\u0000 ‮mundo\r\n\r\n\r\n\r\nfin ', 100), 'hola mundo\n\nfin'.replace('hola mundo', 'hola mundo'));
  assert.equal(sanitizeFreeText('x'.repeat(50), 10).length, 10);
  assert.deepEqual(Object.keys(CONFIG_KEYS), ['gdc', 'hora', 'recordatorio', 'honor', 'honorrequerido']);
  assert.equal(CONFIG_KEYS.hora.parse('7:05').value, '07:05');
  assert.equal(CONFIG_KEYS.hora.parse('24:00').ok, false);
  assert.equal(CONFIG_KEYS.hora.parse('19:60').ok, false);
  assert.equal(CONFIG_KEYS.hora.parse('abc').ok, false);
  assert.equal(CONFIG_KEYS.recordatorio.parse('0').ok, false);
  assert.equal(CONFIG_KEYS.recordatorio.parse('121').ok, false);
  assert.equal(CONFIG_KEYS.recordatorio.parse('10').value, 10);
  assert.equal(CONFIG_KEYS.honorrequerido.parse('-5').ok, false);
  assert.equal(CONFIG_KEYS.honorrequerido.parse('100.5').ok, false);
  assert.equal(CONFIG_KEYS.honor.parse('activar').value, true);
  assert.equal(CONFIG_KEYS.honor.parse('quizás').ok, false);
});

test('ClanService: persiste en disco, restaura configuración al re-verificar y limita el historial', () => {
  const dir = tmpDir();
  try {
    const file = path.join(dir, 'db.json');
    const open = () => new Database({ file, saveDebounceMs: 0, logger: silentLogger() }).load();
    let db = open();
    let svc = new ClanService({ db });
    const res = { ok: true, data: { clanId: CID, name: 'Los Test', level: 7 }, region: 'sa', provider: 'c.test', fetchedAt: Date.now() };
    const { clan, created } = svc.verify({ groupJid: GROUP, clanId: CID, by: ALICE, res });
    assert.equal(created, true);
    svc.setConfig(clan, 'honorrequerido', '100', ALICE);
    svc.setConfig(clan, 'honor', 'activar', ALICE);
    svc.setRules(clan, 'Respeto', ALICE);
    db.close();

    db = open();
    svc = new ClanService({ db });
    const again = svc.clanOfGroup(GROUP);
    assert.equal(again.name, 'Los Test');
    assert.equal(again.config.honorRequired, 100);
    assert.equal(again.config.honorEnabled, true);
    assert.equal(again.rules, 'Respeto');

    svc.unverify(GROUP, ALICE);
    assert.equal(svc.clanOfGroup(GROUP), null);
    const r2 = svc.verify({ groupJid: GROUP2, clanId: CID, by: BOB, res });
    assert.equal(r2.restored, true);
    assert.equal(r2.clan.config.honorRequired, 100, 'la configuración se conserva');
    assert.equal(r2.clan.groupJid, GROUP2);

    for (let i = 0; i < 150; i++) svc.setDescription(r2.clan, `d${i}`, ALICE);
    assert.ok(r2.clan.history.length <= 100);
    db.close();
  } finally { cleanup(dir); }
});

test('ClanService: conflictos (grupo con otro clan, clan en otro grupo) y ranking solo con datos reales', () => {
  const dir = tmpDir();
  try {
    const db = new Database({ file: path.join(dir, 'db.json'), saveDebounceMs: 0, logger: silentLogger() }).load();
    const svc = new ClanService({ db });
    const mk = (id, data) => ({ ok: true, data: { clanId: id, ...data }, provider: 'x', fetchedAt: Date.now() });
    svc.verify({ groupJid: GROUP, clanId: '1001', by: ALICE, res: mk('1001', { name: 'A', level: 5 }) });
    assert.throws(() => svc.verify({ groupJid: GROUP, clanId: '1002', by: ALICE, res: mk('1002', { name: 'B' }) }), /ya tiene verificado/);
    assert.throws(() => svc.verify({ groupJid: GROUP2, clanId: '1001', by: BOB, res: mk('1001', { name: 'A' }) }), /otro grupo/);
    svc.verify({ groupJid: GROUP2, clanId: '1003', by: BOB, res: mk('1003', { name: 'C', level: 9, score: 10 }) });
    svc.verify({ groupJid: '120363000000000003@g.us', clanId: '1004', by: BOB, res: mk('1004', { name: 'SinNivel' }) });
    const rank = svc.ranking();
    assert.deepEqual(rank.map((r) => r.id), ['1003', '1001'], 'ordenado por nivel; sin nivel no entra');
    assert.throws(() => svc.unverify('120363999@g.us', ALICE), /no tiene un clan verificado/);
    assert.throws(() => svc.verify({ groupJid: GROUP, clanId: '1001', by: ALICE, res: { ok: false } }), /resultado correcto/);
    db.close();
  } finally { cleanup(dir); }
});

// ---------- comandos ----------

test('verificarclan: solo ADMIN, solo grupo, con verificación real y sin pedir región', async () => {
  const h = harness({ groupAdmins: admins, clanFetch: clanFetchFrom({ [CID]: CLAN }) });
  try {
    await h.say(`.verificarclan ${CID}`);
    assert.match(h.last(), /solo funciona en grupos/);

    await sayIn(h, `.verificarclan ${CID}`, { from: BOB, pushName: 'Bob' });
    assert.match(h.last(), /No tienes permiso/);

    await sayIn(h, '.verificarclan');
    assert.match(h.last(), /Uso: \*\.verificarclan IDCLAN/);
    await sayIn(h, '.verificarclan abc');
    assert.match(h.last(), /solo puede contener números/);
    await sayIn(h, '.verificarclan 12');
    assert.match(h.last(), /entre 3 y 15 dígitos/);

    await sayIn(h, `.verificarclan ${CID}`);
    assert.match(h.last(), /Clan verificado/);
    assert.match(h.last(), /Los Test/);
    assert.match(h.last(), new RegExp(`ID: ${CID}`));
    assert.match(h.last(), /Líder: Capi/);
    const clan = h.clans.clanOfGroup(GROUP);
    assert.equal(clan.id, CID);
    assert.equal(clan.verifiedBy, ALICE);
    assert.equal(clan.config.gdcTime, '19:00');
    assert.equal(clan.config.honorEnabled, false);
  } finally { h.close(); }
});

test('verificarclan: no existe, API caída, sin configurar, región inválida y conflictos', async () => {
  const h = harness({ groupAdmins: admins, clanFetch: clanFetchFrom({ [CID]: CLAN, 777777: 503 }) });
  try {
    await sayIn(h, '.verificarclan 424242');
    assert.match(h.last(), /No encontré ningún clan/);
    assert.equal(h.clans.clanOfGroup(GROUP), null);

    await sayIn(h, '.verificarclan 777777');
    assert.match(h.last(), /No pude verificar el clan/);
    assert.match(h.last(), /no respondieron/);
    assert.ok(!/No encontré/.test(h.last()), 'API caída no es "no existe"');
    assert.equal(h.clans.clanOfGroup(GROUP), null, 'sin confirmación real no se verifica');

    await sayIn(h, `.verificarclan ${CID} zz`);
    assert.match(h.last(), /Región no permitida/);

    await sayIn(h, `.verificarclan ${CID}`);
    await sayIn(h, '.verificarclan 424242');
    assert.match(h.last(), /ya tiene verificado el clan \*Los Test\*/);

    // Mismo clan en otro grupo (el admin del otro grupo)
    const h2 = h; // mismo stack: Alice también es admin de GROUP2 en el mock
    reset(h2, 'verificarclan');
    h2.d.denyLimiter.clear(`d:${ALICE}`);
    await h2.say(`.verificarclan ${CID}`, { group: GROUP2 });
    assert.match(h2.last(), /ya está verificado en otro grupo/);
  } finally { h.close(); }

  const h3 = harness({ groupAdmins: admins, env: { CLAN_API_URLS: '' } });
  try {
    await sayIn(h3, `.verificarclan ${CID}`);
    assert.match(h3.last(), /no está configurada/);
    assert.match(h3.last(), /CLAN_API_URLS/);
    assert.equal(h3.clans.clanOfGroup(GROUP), null);
  } finally { h3.close(); }
});

test('desverificarclan: quita el clan, los comandos vuelven al aviso estándar y se puede re-verificar', async () => {
  const h = harness({ groupAdmins: admins, clanFetch: clanFetchFrom({ [CID]: CLAN }) });
  try {
    await sayIn(h, '.desverificarclan');
    assert.match(h.last(), /no tiene un clan verificado/);
    await sayIn(h, `.verificarclan ${CID}`);
    await sayIn(h, '.setclan honorrequerido 80');
    await sayIn(h, '.desverificarclan');
    assert.match(h.last(), /Se quitó la verificación/);
    await sayIn(h, '.clan', { from: BOB });
    assert.match(h.last(), /CLAN NO VERIFICADO/);
    assert.match(h.last(), /\.verificarclan IDCLAN/);
    await sayIn(h, `.verificarclan ${CID}`);
    assert.match(h.last(), /se restauró su configuración/);
    assert.equal(h.clans.clanOfGroup(GROUP).config.honorRequired, 80);
  } finally { h.close(); }
});

test('clan / clanmiembros / clanlider / clanstats con datos reales de la API', async () => {
  const h = harness({ groupAdmins: admins, clanFetch: clanFetchFrom({ [CID]: CLAN, 600001: { clanName: 'Solo Nombre', clanId: '600001' } }) });
  try {
    await sayIn(h, `.verificarclan ${CID}`);

    await sayIn(h, '.clan', { from: BOB });
    assert.match(h.last(), /Los Test/);
    assert.match(h.last(), /Nivel del clan: 7/);
    assert.match(h.last(), /Miembros: 3\/50/);
    assert.match(h.last(), /Puntuación: 1,200/);
    assert.match(h.last(), /Datos de la API/);

    await sayIn(h, '.clanmiembros', { from: BOB });
    assert.match(h.last(), /1\. Capi · nivel 60 · rol \(código\) 1/);
    assert.match(h.last(), /3\. Tres/);
    assert.ok(!/3\. Tres ·/.test(h.last()), 'sin nivel ni rol no se muestran');

    await sayIn(h, '.clanmiembros 5', { from: BOB });
    assert.match(h.last(), /La página debe estar entre 1 y 1/);

    await sayIn(h, '.clanlider', { from: BOB });
    assert.match(h.last(), /Nick: Capi/);
    assert.match(h.last(), /UID: 111/);

    await sayIn(h, '.clannivel', { from: BOB }); // alias de clanstats
    assert.match(h.last(), /Nivel: 7/);
    assert.match(h.last(), /Puntuación: 1,200/);
    assert.ok(!/Creado/.test(h.last()), 'la API no dio fecha de creación');
  } finally { h.close(); }

  // API que solo da el nombre: los comandos no inventan nada
  const h2 = harness({ groupAdmins: admins, clanFetch: clanFetchFrom({ 600001: { clanName: 'Solo Nombre', clanId: '600001' } }) });
  try {
    await sayIn(h2, '.verificarclan 600001');
    await sayIn(h2, '.clanmiembros', { from: BOB });
    assert.match(h2.last(), /no entrega la lista de miembros/);
    await sayIn(h2, '.clanlider', { from: BOB });
    assert.match(h2.last(), /no entrega el líder/);
    await sayIn(h2, '.clanstats', { from: BOB });
    assert.match(h2.last(), /no entregó estadísticas/);
    await sayIn(h2, '.clan', { from: BOB });
    assert.ok(!/Nivel|Miembros|Líder|Puntuación/.test(h2.last()), h2.last());
  } finally { h2.close(); }
});

test('clan: paginación de miembros y consulta de cualquier clan por ID', async () => {
  const many = { clanInfo: { clanId: '700001', clanName: 'Grande', memberNum: 40 }, members: Array.from({ length: 40 }, (_, i) => ({ accountId: String(1000 + i), nickname: `P${i + 1}` })) };
  const h = harness({ groupAdmins: admins, clanFetch: clanFetchFrom({ 700001: many, [CID]: CLAN }) });
  try {
    await sayIn(h, '.verificarclan 700001');
    await sayIn(h, '.clanmiembros');
    assert.match(h.last(), /1\. P1/);
    assert.match(h.last(), /15\. P15/);
    assert.ok(!/16\. P16/.test(h.last()));
    assert.match(h.last(), /Página 1\/3/);
    await sayIn(h, '.clanmiembros 3');
    assert.match(h.last(), /40\. P40/);

    // En privado y sin verificar nada: consulta por ID
    reset(h, 'clan', BOB);
    await h.say(`.clan ${CID}`, { from: BOB, pushName: 'Bob' });
    assert.match(h.last(), /Consulta de clan/);
    assert.match(h.last(), /Los Test/);
    assert.match(h.last(), /Fuente: clan\.test/);
    reset(h, 'clan', BOB);
    await h.say('.clan', { from: BOB, id: 'priv2' });
    assert.match(h.last(), /Úsalo en un grupo con clan verificado/);
    reset(h, 'clan', BOB);
    await h.say('.clan 424242', { from: BOB, id: 'priv3' });
    assert.match(h.last(), /No encontré ningún clan/);
  } finally { h.close(); }
});

test('refresco: una ficha vieja se vuelve a consultar; si la API falla se conserva la anterior', async () => {
  let mode = 'ok';
  let level = 7;
  const clanFetch = async () => (mode === 'down' ? fakeRes(503, {}) : fakeRes(200, { clanInfo: { clanId: CID, clanName: 'Los Test', clanLevel: level } }));
  const h = harness({ groupAdmins: admins, clanFetch });
  try {
    await sayIn(h, `.verificarclan ${CID}`);
    level = 8;
    await sayIn(h, '.clanstats', { from: BOB });
    assert.match(h.last(), /Nivel: 7/, 'ficha reciente: no se vuelve a consultar');

    h.clans.clanOfGroup(GROUP).snapshot.fetchedAt = new Date(Date.now() - 7 * 3600 * 1000).toISOString();
    mode = 'down';
    await sayIn(h, '.clanstats', { from: BOB });
    assert.match(h.last(), /Nivel: 7/, 'API caída: se conserva la ficha anterior');

    mode = 'ok';
    await sayIn(h, '.clanstats', { from: BOB });
    assert.match(h.last(), /Nivel: 8/, 'ficha vieja y API disponible: se actualiza');
  } finally { h.close(); }
});

test('clanconfig / setclan: valores válidos, inválidos y permisos', async () => {
  const h = harness({ groupAdmins: admins, clanFetch: clanFetchFrom({ [CID]: CLAN }) });
  try {
    await sayIn(h, '.clanconfig', { from: BOB });
    assert.match(h.last(), /CLAN NO VERIFICADO/);
    await sayIn(h, `.verificarclan ${CID}`);

    await sayIn(h, '.clanconfig', { from: BOB });
    assert.match(h.last(), /Hora de la GDC: \*19:00\*/);
    assert.match(h.last(), /Honor: \*desactivado\*/);
    assert.match(h.last(), /Zona horaria: America\/Guayaquil/);

    await sayIn(h, '.setclan honor activar', { from: BOB });
    assert.match(h.last(), /No tienes permiso/);

    await sayIn(h, '.setclan');
    assert.match(h.last(), /Uso: \*\.setclan/);
    assert.match(h.last(), /honorrequerido/);
    await sayIn(h, '.setclan honor activar');
    assert.match(h.last(), /Honor: \*activado\*/);
    await sayIn(h, '.setclan honorrequerido 100');
    assert.match(h.last(), /Honor requerido: \*100\*/);
    await sayIn(h, '.setclan hora 20:30');
    assert.match(h.last(), /\*20:30\*/);
    await sayIn(h, '.setclan hora 25:00');
    assert.match(h.last(), /formato HH:MM/);
    await sayIn(h, '.setclan honorrequerido abc');
    assert.match(h.last(), /número entero entre 0 y 100000/);
    await sayIn(h, '.setclan inventada 1');
    assert.match(h.last(), /Opción desconocida/);
    const cfg = h.clans.clanOfGroup(GROUP).config;
    assert.deepEqual([cfg.honorEnabled, cfg.honorRequired, cfg.gdcTime], [true, 100, '20:30']);

    // El honor es por clan: otro clan en otro grupo conserva su propia configuración
    assert.equal(h.clans.get(CID).config.honorRequired, 100);
  } finally { h.close(); }
});

test('reglas y descripción: texto multilínea, límites, borrar y permisos', async () => {
  const h = harness({ groupAdmins: admins, clanFetch: clanFetchFrom({ [CID]: CLAN }) });
  try {
    await sayIn(h, `.verificarclan ${CID}`);
    await sayIn(h, '.clanreglas', { from: BOB });
    assert.match(h.last(), /aún no tiene reglas/);
    await sayIn(h, '.setclanreglas 1. Respeto\n2. Puntualidad', { from: BOB });
    assert.match(h.last(), /No tienes permiso/);
    await sayIn(h, '.setclanreglas 1. Respeto\n2. Puntualidad');
    assert.match(h.last(), /Reglas actualizadas/);
    await sayIn(h, '.clanreglas', { from: BOB });
    assert.match(h.last(), /1\. Respeto\n2\. Puntualidad/);
    await sayIn(h, `.setclanreglas ${'x'.repeat(601)}`);
    assert.match(h.last(), /máximo 600/);
    await sayIn(h, '.setclanreglas borrar');
    assert.match(h.last(), /Reglas borradas/);

    await sayIn(h, '.clandesc', { from: BOB });
    assert.match(h.last(), /Clan de pruebas/, 'sin descripción propia se usa la de la API');
    await sayIn(h, '.setclandesc *Clan* competitivo');
    await sayIn(h, '.clandesc', { from: BOB });
    assert.match(h.last(), /Clan competitivo/);
    assert.ok(!/\*Clan\*/.test(h.last().split('\n')[1]), 'formato de WhatsApp neutralizado');
    await sayIn(h, `.setclandesc ${'y'.repeat(201)}`);
    assert.match(h.last(), /máximo 200/);
  } finally { h.close(); }
});

test('clanhistorial: solo ADMIN y registra quién hizo cada cambio', async () => {
  const h = harness({ groupAdmins: admins, clanFetch: clanFetchFrom({ [CID]: CLAN }) });
  try {
    await sayIn(h, `.verificarclan ${CID}`);
    await sayIn(h, '.setclan honor activar');
    await sayIn(h, '.clanhistorial', { from: BOB });
    assert.match(h.last(), /No tienes permiso/);
    await sayIn(h, '.clanlog');
    assert.match(h.last(), /verificado: Los Test/);
    assert.match(h.last(), /config: Honor: desactivado → activado/);
    assert.match(h.last(), /@593991111111/);
    await sayIn(h, '.clanhistorial 0');
    assert.match(h.last(), /entre 1 y 30/);
  } finally { h.close(); }
});

test('topclanes y clancomparar', async () => {
  const h = harness({
    env: { RATE_LIMIT_USER_MAX: '100' },
    groupAdmins: admins,
    clanFetch: clanFetchFrom({
      [CID]: CLAN,
      800001: { clanInfo: { clanId: '800001', clanName: 'Rival', clanLevel: 9, memberNum: 10, score: 50 } },
      800002: { clanInfo: { clanId: '800002', clanName: 'SoloNombre' } },
    }),
  });
  try {
    await h.say('.topclanes');
    assert.match(h.last(), /Todavía no hay clanes/);

    await sayIn(h, `.verificarclan ${CID}`);
    reset(h, 'verificarclan');
    await h.say('.verificarclan 800001', { group: GROUP2, id: 'v2' });
    reset(h, 'topclanes');
    await h.say('.topclanes', { id: 't2' });
    assert.match(h.last(), /🥇 Rival — nivel 9/);
    assert.match(h.last(), /🥈 Los Test — nivel 7/);

    reset(h, 'clancomparar');
    await h.say(`.clancomparar ${CID} 800001`, { id: 'c1' });
    assert.match(h.last(), /A: Los Test/);
    assert.match(h.last(), /B: Rival/);
    assert.match(h.last(), /Nivel: 7  vs  9  ▶/);
    assert.match(h.last(), /Puntuación: 1,200  vs  50  ◀/);

    reset(h, 'clancomparar');
    await h.say('.clanversus 800001', { group: GROUP, id: 'c2' });
    assert.match(h.last(), /A: Los Test/);
    reset(h, 'clancomparar');
    await h.say('.clancomparar 800001', { id: 'c3' });
    assert.match(h.last(), /Indica dos IDs/);
    reset(h, 'clancomparar');
    await h.say(`.clancomparar ${CID} ${CID}`, { id: 'c4' });
    assert.match(h.last(), /dos clanes distintos/);
    reset(h, 'clancomparar');
    await h.say(`.clancomparar ${CID} 800002`, { id: 'c5' });
    assert.match(h.last(), /no entregaron datos comparables/);
    reset(h, 'clancomparar');
    await h.say(`.clancomparar ${CID} 424242`, { id: 'c6' });
    assert.match(h.last(), /No encontré ningún clan/);
  } finally { h.close(); }
});

// ---------- menú ----------

test('menu: usuario sin registrar en privado, con mención real y sin comandos de más', async () => {
  const h = harness({ groupAdmins: admins });
  try {
    await h.say('.menu');
    const s = h.sent[h.sent.length - 1];
    assert.match(s.text, /Hola @593991111111/);
    assert.deepEqual(s.mentions, [ALICE]);
    assert.match(s.text, /No estás registrado/);
    assert.match(s.text, /Rol: USER/);
    assert.match(s.text, /Los comandos de clan se usan en el grupo/);
    assert.match(s.text, /\.registro/);
    assert.ok(!/\.verificarclan/.test(s.text), 'un USER no ve comandos de ADMIN');
    assert.ok(!/\.setclan/.test(s.text));
  } finally { h.close(); }
});

test('menu: grupo sin clan avisa y explica .verificarclan; con clan muestra nombre, ID, estado y config', async () => {
  const h = harness({ groupAdmins: admins, clanFetch: clanFetchFrom({ [CID]: CLAN }) });
  try {
    await sayIn(h, '.registro');
    await sayIn(h, '.menu');
    assert.match(h.last(), /CLAN NO VERIFICADO/);
    assert.match(h.last(), /\.verificarclan IDCLAN/);
    assert.match(h.last(), /nivel 1/);
    assert.match(h.last(), /Rol: ADMIN/);
    assert.match(h.last(), /\.verificarclan/, 'el admin sí ve el comando');

    await sayIn(h, `.verificarclan ${CID}`);
    await sayIn(h, '.setclan honor activar');
    await sayIn(h, '.setclan honorrequerido 100');
    await sayIn(h, '.menu');
    const t = h.last();
    assert.ok(!/CLAN NO VERIFICADO/.test(t));
    assert.match(t, /Los Test/);
    assert.match(t, new RegExp(`ID: ${CID}`));
    assert.match(t, /GDC activada a las 19:00 \(America\/Guayaquil\), aviso 10 min antes/);
    assert.match(t, /Honor activado \(requerido 100\)/);
    assert.match(t, /Clanes:/);
  } finally { h.close(); }
});

test('menu: el estado de GDC solo aparece si existe el módulo que lo aporta (nada inventado)', async () => {
  const h = harness({ groupAdmins: admins, clanFetch: clanFetchFrom({ [CID]: CLAN }) });
  try {
    await sayIn(h, `.verificarclan ${CID}`);
    await sayIn(h, '.menu');
    assert.ok(!/Próxima GDC|Estado GDC/i.test(h.last()));
    h.d.services.gdc = { menuLines: (clan) => [`📅 Próxima GDC: hoy ${clan.config.gdcTime}`] };
    await sayIn(h, '.menu');
    assert.match(h.last(), /Próxima GDC: hoy 19:00/);
  } finally { h.close(); }
});

test('menu: categoría concreta, categoría inexistente o fuera del rol', async () => {
  const h = harness({ groupAdmins: admins });
  try {
    await h.say('.menu clanes');
    assert.match(h.last(), /\.clan \[IDCLAN\]/);
    assert.match(h.last(), /\.topclanes/);
    assert.ok(!/verificarclan/.test(h.last()), 'USER no ve comandos de admin');
    reset(h, 'menu');
    await h.say('.menu inventada', { id: 'm2' });
    assert.match(h.last(), /No hay una categoría/);
    reset(h, 'menu');
    await h.say('.menu owner', { id: 'm3' });
    assert.match(h.last(), /No hay una categoría/);
    await h.say('.menu clanes', { from: OWNER, id: 'm4', pushName: 'Owner' });
    assert.match(h.last(), /verificarclan/);
  } finally { h.close(); }
});
