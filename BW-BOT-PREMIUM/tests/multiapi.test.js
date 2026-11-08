'use strict';

// Sistema multi-API (registro, router, salud, caché, reintentos, fallback y fusión) contra servidores HTTP locales reales.
// NINGÚN proveedor real se consulta aquí: los adaptadores se prueban contra respuestas simuladas con el formato documentado.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { buildConfig, validateConfig } = require('../src/config');
const { FreeFireService } = require('../src/providers/freefire/service');
const { ClanApiService } = require('../src/providers/clans/service');
const { ProviderHealth } = require('../src/providers/health');
const { ProviderCache } = require('../src/providers/cache');
const { ProviderRouter } = require('../src/providers/router');
const { PRESETS, readProviders } = require('../src/providers/registry');

const UID = '123456789';
const silent = { debug() {}, info() {}, warn() {}, error() {}, child() { return silent; } };
const jsonRes = (res, status, body, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', ...headers }); res.end(JSON.stringify(body)); };
const FULL = { basicInfo: { accountId: UID, nickname: 'Pro', level: 65, region: 'BR', liked: 900, exp: 5000, rank: 320 } };
const PARTIAL = { basicInfo: { accountId: UID, nickname: 'Pro', level: 65 } };
const EXTRA = { basicInfo: { accountId: UID, nickname: 'OtroNick', level: 99, liked: 777, exp: 1234, rank: 400 } };

async function api(handler) {
  const info = { hits: 0, urls: [], headers: [] };
  const server = http.createServer(async (req, res) => {
    info.hits += 1; info.urls.push(req.url); info.headers.push(req.headers);
    try { await handler(req, res, info); } catch { res.destroy(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { info, base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}
async function withApis(handlers, fn) {
  const servers = [];
  try { for (const h of handlers) servers.push(await api(h)); await fn(servers); } finally { await Promise.all(servers.map((s) => s.close())); }
}
const ok = (body = FULL) => (req, res) => jsonRes(res, 200, body);
const down = (status) => (req, res) => jsonRes(res, status, { error: 'x' });

/** Servicio con N proveedores genéricos numerados (FF_PROVIDER_n_URL). */
function svc(servers, extra = {}, now) {
  const env = { FF_API_TIMEOUT: '400', FF_API_BACKOFF_MS: '1', FF_MERGE_PROVIDERS: 'false', FF_DEFAULT_REGION: 'br', ...extra };
  servers.forEach((s, i) => { env[`FF_PROVIDER_${i + 1}_URL`] = `${s.base}/${i + 1}/{uid}?region={region}`; });
  const config = buildConfig(env, '/x');
  return new FreeFireService({ config, logger: silent, ...(now ? { now } : {}) });
}

test('config: lee FF_PROVIDER_n_*, FREEFIRE_PROVIDERS, prioridad, activado y regiones', () => {
  const { specs } = readProviders({
    FREEFIRE_PROVIDERS: 'provider2,provider1',
    FF_PROVIDER_1_URL: 'https://a.test/{uid}', FF_PROVIDER_1_KEY: 'K1', FF_PROVIDER_1_REGIONS: 'br,us',
    FF_PROVIDER_2_URL: 'https://b.test/{uid}', FF_PROVIDER_2_ENABLED: 'false', FF_PROVIDER_2_PRIORITY: '7', FF_PROVIDER_2_TIMEOUT: '3000',
  }, { prefix: 'FF_PROVIDER', listVar: 'FREEFIRE_PROVIDERS', kind: 'player' });
  assert.deepEqual(specs.map((s) => s.id), ['2', '1']);
  assert.equal(specs[0].enabled, false);
  assert.equal(specs[0].priority, 7);
  assert.equal(specs[0].timeoutMs, 3000);
  assert.deepEqual(specs[1].regions, ['br', 'us']);
  assert.equal(specs[1].key, 'K1');
});

test('config: preset por nombre en la lista y errores de configuración claros', () => {
  const r = readProviders({ FREEFIRE_PROVIDERS: 'jinix,hlgaming', FF_PROVIDER_HLGAMING_KEY: 'uid:key' }, { prefix: 'FF_PROVIDER', listVar: 'FREEFIRE_PROVIDERS', kind: 'player' });
  assert.deepEqual(r.specs.map((s) => s.type), ['jinix', 'hlgaming']);
  assert.equal(r.specs[1].key, 'uid:key');
  const bad = readProviders({ FF_PROVIDER_1_TYPE: 'inexistente' }, { prefix: 'FF_PROVIDER', listVar: 'X', kind: 'player' });
  assert.equal(bad.problems.length, 1);
  const noClan = readProviders({ CLAN_PROVIDER_1_TYPE: 'ffcommunity' }, { prefix: 'CLAN_PROVIDER', listVar: 'X', kind: 'clan' });
  assert.equal(noClan.specs.length, 0);
  assert.equal(noClan.problems.length, 1);
  assert.equal(validateConfig(buildConfig({ FF_PROVIDER_1_TYPE: 'nada' }, '/x')).some((p) => p.includes('TYPE')), true);
});

test('principal funciona: usa el proveedor 1 y no toca los demás', async () => {
  await withApis([ok(), ok()], async ([a, b]) => {
    const r = await svc([a, b]).lookup(UID);
    assert.equal(r.ok, true);
    assert.equal(r.data.nickname, 'Pro');
    assert.equal(a.info.hits, 1);
    assert.equal(b.info.hits, 0);
  });
});

test('principal falla → usa el 2.º; 1 y 2 fallan → usa el 3.º (500, 503, JSON inválido)', async () => {
  await withApis([down(500), (q, s) => { s.writeHead(200); s.end('<html>no json</html>'); }, ok()], async ([a, b, c]) => {
    const r = await svc([a, b, c]).lookup(UID);
    assert.equal(r.ok, true);
    assert.equal(c.info.hits, 1);
    assert.equal(a.info.hits, 2, '500 se reintenta una vez (reintentos acotados)');
    assert.equal(b.info.hits, 1, 'JSON inválido no se reintenta');
  });
  await withApis([down(503), ok()], async ([a, b]) => {
    const r = await svc([a, b]).lookup(UID);
    assert.equal(r.ok, true);
    assert.equal(b.info.hits, 1);
  });
});

test('todos fallan: API_DOWN con attempts; ningún dato inventado', async () => {
  await withApis([down(502), down(504)], async ([a, b]) => {
    const r = await svc([a, b]).lookup(UID);
    assert.equal(r.ok, false);
    assert.equal(r.kind, 'API_DOWN');
    assert.equal(r.code, 'API_DOWN');
    assert.equal(r.data, undefined);
    assert.equal(r.attempts.length, 2);
  });
});

test('timeout: código API_TIMEOUT y pasa al siguiente', async () => {
  await withApis([async () => new Promise(() => {}), ok()], async ([slow, fast]) => {
    const s = svc([slow, fast]);
    const r = await s.lookup(UID);
    assert.equal(r.ok, true);
    assert.equal(s.status()[0].lastErrorCode, 'API_TIMEOUT');
  });
  await withApis([async () => new Promise(() => {})], async ([slow]) => {
    const r = await svc([slow]).lookup(UID);
    assert.equal(r.code, 'API_TIMEOUT');
  });
});

test('429: proveedor limitado temporalmente (Retry-After) y se usa el siguiente', async () => {
  let t = 1000;
  await withApis([(q, s) => jsonRes(s, 429, { error: 'slow down' }, { 'Retry-After': '45' }), ok()], async ([a, b]) => {
    const s = svc([a, b], {}, () => t);
    assert.equal((await s.lookup(UID)).ok, true);
    const st = s.status()[0];
    assert.equal(st.limited, true);
    assert.equal(st.cooldownUntil, t + 45000);
    assert.equal(a.info.hits, 1, '429 no se reintenta');
    t += 1000;
    await s.lookup('987654321');
    assert.equal(a.info.hits, 1, 'durante el cooldown no se vuelve a llamar');
  });
  await withApis([(q, s) => jsonRes(s, 429, {})], async ([a]) => {
    assert.equal((await svc([a]).lookup(UID)).code, 'API_RATE_LIMIT');
  });
});

test('límite propio por proveedor (FF_PROVIDER_n_RATE_LIMIT): no hace la petición y pasa al siguiente', async () => {
  await withApis([ok(), ok()], async ([a, b]) => {
    const s = svc([a, b], { FF_PROVIDER_1_RATE_LIMIT: '1', FF_CACHE_TTL: '0' });
    await s.lookup(UID);
    await s.lookup(UID);
    assert.equal(a.info.hits, 1);
    assert.equal(b.info.hits, 1);
  });
});

test('jugador/clan no encontrado ≠ API caída (códigos PLAYER_NOT_FOUND / CLAN_NOT_FOUND) y no marca fallo', async () => {
  await withApis([(q, s) => jsonRes(s, 404, { error: 'Player not found' })], async ([a]) => {
    const s = svc([a]);
    const r = await s.lookup(UID);
    assert.equal(r.kind, 'NOT_FOUND');
    assert.equal(r.code, 'PLAYER_NOT_FOUND');
    assert.equal(s.status()[0].errorCount, 0);
    assert.equal(s.status()[0].state, 'ok');
  });
  await withApis([(q, s) => jsonRes(s, 404, { error: 'Clan not found' })], async ([a]) => {
    const config = buildConfig({ CLAN_PROVIDER_1_URL: `${a.base}/{id}?r={region}`, CLAN_DEFAULT_REGION: 'br', CLAN_API_TIMEOUT: '400' }, '/x');
    const r = await new ClanApiService({ config, logger: silent }).lookup('123456');
    assert.equal(r.code, 'CLAN_NOT_FOUND');
  });
});

test('no configurado: API_NOT_CONFIGURED; sin clave: proveedor sin_configurar', async () => {
  const none = new FreeFireService({ config: buildConfig({}, '/x'), logger: silent });
  assert.equal((await none.lookup(UID)).code, 'API_NOT_CONFIGURED');
  const keyless = new FreeFireService({ config: buildConfig({ FF_PROVIDER_1_TYPE: 'ffcommunity' }, '/x'), logger: silent });
  assert.equal(keyless.status()[0].state, 'sin_configurar');
  assert.equal((await keyless.lookup(UID)).code, 'API_NOT_CONFIGURED');
});

test('clave inválida: API_AUTH_ERROR (HTTP 401 y 200 con mensaje), cooldown largo y fallback', async () => {
  await withApis([(q, s) => jsonRes(s, 401, { error: 'Unauthorized' }), (q, s) => jsonRes(s, 200, { success: false, message: 'Invalid API key.' })], async ([a, b]) => {
    const s = svc([a, b]);
    const r = await s.lookup(UID);
    assert.equal(r.code, 'API_AUTH_ERROR');
    assert.equal(a.info.hits, 1, 'un error de autenticación no se reintenta');
    assert.equal(s.status().every((x) => x.authError), true);
  });
  await withApis([(q, s) => jsonRes(s, 403, {}), ok()], async ([a, b]) => {
    assert.equal((await svc([a, b]).lookup(UID)).ok, true);
  });
});

test('región no soportada: se omite el proveedor sin llamarlo; REGION_NOT_SUPPORTED si ninguno la atiende', async () => {
  await withApis([ok(), ok()], async ([a, b]) => {
    const s = svc([a, b], { FF_PROVIDER_1_REGIONS: 'us', FF_PROVIDER_2_REGIONS: 'br,sg' });
    const r = await s.lookup(UID, { region: 'br' });
    assert.equal(r.ok, true);
    assert.equal(a.info.hits, 0);
    assert.equal(b.info.hits, 1);
    const bad = await s.lookup(UID, { region: 'ru' });
    assert.equal(bad.ok, false);
    assert.equal(bad.code, 'REGION_NOT_SUPPORTED');
    assert.equal(a.info.hits + b.info.hits, 1);
  });
});

test('prioridad: FF_PROVIDER_n_PRIORITY reordena y los desactivados no se usan', async () => {
  await withApis([ok(), ok(), ok()], async ([a, b, c]) => {
    const s = svc([a, b, c], { FF_PROVIDER_1_PRIORITY: '30', FF_PROVIDER_2_ENABLED: 'false', FF_PROVIDER_3_PRIORITY: '5' });
    assert.equal((await s.lookup(UID)).ok, true);
    assert.equal(c.info.hits, 1);
    assert.equal(a.info.hits + b.info.hits, 0);
    assert.deepEqual(s.status().map((x) => x.priority), [2, 5, 30]);
    assert.equal(s.status().find((x) => !x.enabled).state, 'desactivada');
  });
});

test('caché: sirve el éxito sin llamar, caduca por TTL y NO cachea fallos permanentes de la API', async () => {
  let t = 1000;
  await withApis([ok()], async ([a]) => {
    const s = svc([a], { FF_CACHE_TTL: '10' }, () => t);
    await s.lookup(UID);
    assert.equal((await s.lookup(UID)).cached, true);
    assert.equal(a.info.hits, 1);
    t += 11000;
    assert.equal((await s.lookup(UID)).cached, false);
    assert.equal(a.info.hits, 2);
  });
  const c = new ProviderCache({ ttlSec: 100 });
  assert.equal(c.put('k', { ok: false, kind: 'API_DOWN' }), false);
  assert.equal(c.put('k', { ok: false, kind: 'NOT_FOUND', partial: true }), false);
  assert.equal(c.put('k', { ok: false, kind: 'NOT_FOUND' }), true);
});

test('cooldown y recuperación: 3 fallos abren el proveedor; pasado el cooldown vuelve a incluirse al recuperarse', async () => {
  let t = 1000;
  let healthy = false;
  await withApis([(q, s) => (healthy ? jsonRes(s, 200, FULL) : jsonRes(s, 500, {}))], async ([a]) => {
    const s = svc([a], { FF_API_RETRIES: '0', FF_CACHE_TTL: '0' }, () => t);
    for (let i = 0; i < 3; i += 1) await s.lookup(UID);
    assert.equal(s.status()[0].state, 'caida');
    assert.ok(s.status()[0].cooldownUntil > t);
    healthy = true;
    t += 61000;
    const r = await s.lookup(UID);
    assert.equal(r.ok, true);
    assert.equal(s.status()[0].state, 'ok');
    assert.equal(s.status()[0].errorCount, 3);
    assert.equal(s.status()[0].successCount, 1);
  });
});

test('health check: sondea a cada proveedor, sano aunque diga "no encontrado", y reincluye al recuperado', async () => {
  let t = 1000;
  let healthy = false;
  await withApis([(q, s) => (healthy ? jsonRes(s, 404, { error: 'Player not found' }) : jsonRes(s, 500, {})), ok()], async ([a, b]) => {
    const s = svc([a, b], { FF_API_RETRIES: '0', FF_HEALTH_UID: UID, FF_CACHE_TTL: '0' }, () => t);
    assert.equal((await s.checkHealth()).checked, 2);
    assert.equal(s.status()[0].errorCount, 1);
    assert.equal(s.status()[1].state, 'ok');
    healthy = true;
    await s.checkHealth();
    assert.equal(s.status()[0].state, 'ok');
    assert.ok(s.status()[0].lastLatencyMs >= 0);
    assert.equal((await new FreeFireService({ config: buildConfig({ FF_PROVIDER_1_URL: `${a.base}/{uid}` }, '/x'), logger: silent }).checkHealth()).checked, 0, 'sin FF_HEALTH_UID no se inventa una sonda');
  });
});

test('fusión segura: completa solo los campos que faltan, con procedencia, sin pisar ni inventar', async () => {
  await withApis([ok(PARTIAL), ok(EXTRA), ok(EXTRA)], async ([a, b, c]) => {
    const s = svc([a, b, c], { FF_MERGE_PROVIDERS: 'true', FF_MERGE_MAX_EXTRA: '1' });
    const r = await s.lookup(UID);
    assert.equal(r.data.nickname, 'Pro', 'el dato del proveedor principal no se pisa');
    assert.equal(r.data.level, 65);
    assert.equal(r.data.likes, 777);
    assert.equal(r.data.exp, 1234);
    assert.equal(r.provenance.nickname, s.providers[0].name);
    assert.equal(r.provenance.likes, s.providers[1].name);
    assert.equal(c.info.hits, 0, 'mergeMax limita las consultas extra');
  });
  await withApis([ok(PARTIAL), down(500)], async ([a, b]) => {
    const r = await svc([a, b], { FF_MERGE_PROVIDERS: 'true', FF_API_RETRIES: '0' }).lookup(UID);
    assert.equal(r.ok, true);
    assert.equal(r.data.likes, undefined, 'si nadie lo da, el campo queda ausente');
  });
  await withApis([ok(FULL), ok(EXTRA)], async ([a, b]) => {
    await svc([a, b], { FF_MERGE_PROVIDERS: 'true' }).lookup(UID);
    assert.equal(b.info.hits, 0, 'con datos completos no se consulta otro proveedor');
  });
});

// ---------- adaptadores de proveedores reales (contra respuestas simuladas con el formato documentado) ----------

test('adaptador hlgaming: parámetros documentados, clave USERUID:API, normalización de AccountInfo', async () => {
  const body = { AccountInfo: { AccountName: 'HLPro', AccountLevel: 70, AccountEXP: 99999, AccountRegion: 'BR', AccountLikes: 1200 }, AccountProfileInfo: { BrRankPoint: 2100 } };
  await withApis([ok(body)], async ([a]) => {
    const s = new FreeFireService({ config: buildConfig({ FF_PROVIDER_1_TYPE: 'hlgaming', FF_PROVIDER_1_URL: `${a.base}/api`, FF_PROVIDER_1_KEY: 'u123:sekret' }, '/x'), logger: silent });
    const r = await s.lookup(UID, { region: 'br' });
    assert.equal(r.ok, true);
    assert.equal(r.data.nickname, 'HLPro');
    assert.equal(r.data.level, 70);
    assert.equal(r.data.exp, 99999);
    assert.equal(r.data.likes, 1200);
    assert.equal(r.data.rankPoints, 2100);
    const u = new URL(a.base + a.info.urls[0]);
    assert.equal(u.searchParams.get('sectionName'), 'AccountInfo');
    assert.equal(u.searchParams.get('PlayerUid'), UID);
    assert.equal(u.searchParams.get('useruid'), 'u123');
    assert.equal(u.searchParams.get('api'), 'sekret');
    assert.equal(u.searchParams.get('region'), 'br');
    assert.equal(s.status()[0].authRequired, true);
  });
  await withApis([(q, s) => jsonRes(s, 200, { status: 'error', message: 'Auth Failed! Please Check Your User id & Try Again..' })], async ([a]) => {
    const s = new FreeFireService({ config: buildConfig({ FF_PROVIDER_1_TYPE: 'hlgaming', FF_PROVIDER_1_URL: `${a.base}/api`, FF_PROVIDER_1_KEY: 'u:k', FF_API_BACKOFF_MS: '1' }, '/x'), logger: silent });
    assert.equal((await s.lookup(UID, { region: 'br' })).code, 'API_AUTH_ERROR');
  });
});

test('adaptador ffcommunity: x-api-key en cabecera (nunca en la URL) y User-Agent neutro; basicInfo normalizado', async () => {
  const body = { basicInfo: { accountId: UID, nickname: 'Comm', level: 50, rank: 311, region: 'SG' }, clanBasicInfo: { clanId: '3000000001', clanName: 'Los Pro', clanLevel: 5, memberNum: 40, capacity: 50 } };
  await withApis([ok(body)], async ([a]) => {
    const s = new FreeFireService({ config: buildConfig({ FF_PROVIDER_1_TYPE: 'ffcommunity', FF_PROVIDER_1_URL: a.base, FF_PROVIDER_1_KEY: 'COMMKEY' }, '/x'), logger: silent });
    const r = await s.lookup(UID, { region: 'sg' });
    assert.equal(r.data.nickname, 'Comm');
    assert.equal(r.data.clanName, 'Los Pro');
    assert.equal(a.info.headers[0]['x-api-key'], 'COMMKEY');
    assert.equal(a.info.urls[0].includes('COMMKEY'), false);
    assert.match(a.info.urls[0], /^\/info\?region=sg&uid=123456789$/);
    const ua = a.info.headers[0]['user-agent'];
    assert.ok(ua.length >= 10 && !/python|axios|requests|bot/i.test(ua));
  });
});

test('adaptador jinix: sin clave, región en mayúsculas, jugador y clan (guildInfo)', async () => {
  await withApis([(req, res) => (req.url.startsWith('/api/v1/account') ? jsonRes(res, 200, { accountId: UID, nickname: 'Jx', level: 40, rank: 305, rankingPoints: 3000 }) : jsonRes(res, 200, { clanId: '3000000001', clanName: 'JxClan', clanLevel: 6, memberNum: 12, capacity: 50, captainId: '555555555' }))], async ([a]) => {
    const env = { FF_PROVIDER_1_TYPE: 'jinix', FF_PROVIDER_1_URL: a.base, CLAN_PROVIDER_1_TYPE: 'jinix', CLAN_PROVIDER_1_URL: a.base };
    const p = await new FreeFireService({ config: buildConfig(env, '/x'), logger: silent }).lookup(UID, { region: 'br' });
    assert.equal(p.data.nickname, 'Jx');
    assert.equal(p.data.rankPoints, 3000);
    assert.match(a.info.urls[0], /region=BR&uid=123456789/);
    const c = await new ClanApiService({ config: buildConfig(env, '/x'), logger: silent }).lookup('3000000001', { region: 'br' });
    assert.equal(c.ok, true);
    assert.equal(c.data.name, 'JxClan');
    assert.equal(c.data.memberCount, 12);
    assert.match(a.info.urls[1], /guildInfo\?region=BR&guildID=3000000001/);
  });
});

test('adaptador gameskinbo: región opcional y soportada solo en su lista; x-api-key en cabecera', async () => {
  const body = { AccountInfo: { AccountName: 'Skin', AccountLevel: 33, AccountEXP: 10, AccountLikes: 9, AccountRegion: 'ID' } };
  await withApis([ok(body)], async ([a]) => {
    const s = new FreeFireService({ config: buildConfig({ FF_PROVIDER_1_TYPE: 'gameskinbo', FF_PROVIDER_1_URL: a.base, FF_PROVIDER_1_KEY: 'GSK' }, '/x'), logger: silent });
    const r = await s.lookup(UID);
    assert.equal(r.data.nickname, 'Skin');
    assert.equal(a.info.headers[0]['x-api-key'], 'GSK');
    assert.equal((await s.lookup(UID, { region: 'ru' })).code, 'REGION_NOT_SUPPORTED');
  });
  assert.equal(Object.keys(PRESETS).length, 4);
});

test('compatibilidad: FF_API_URLS (plantillas) sigue funcionando junto a los proveedores nombrados y va después', async () => {
  await withApis([ok(), ok()], async ([named, legacy]) => {
    const env = { FF_API_URLS: `${legacy.base}/{uid}`, FF_PROVIDER_1_URL: `${named.base}/{uid}`, FF_API_TIMEOUT: '400', FF_MERGE_PROVIDERS: 'false' };
    const s = new FreeFireService({ config: buildConfig(env, '/x'), logger: silent });
    await s.lookup(UID);
    assert.equal(named.info.hits, 1);
    assert.equal(legacy.info.hits, 0);
    assert.equal(s.summary().level, 'operativo');
  });
});

test('ProviderHealth y ProviderRouter: contadores y orden con proveedores en cooldown', () => {
  let t = 0;
  const h = new ProviderHealth({ now: () => t });
  const p = { priority: 1, enabled: true }; const q = { priority: 2, enabled: true, needsRegion: false, supportsRegion: () => true, misconfigured: false };
  p.needsRegion = false; p.supportsRegion = () => true; p.misconfigured = false;
  h.fail(p, 'API_DOWN'); h.fail(p, 'API_DOWN'); h.fail(p, 'API_DOWN');
  assert.equal(h.isOpen(p), true);
  const r = new ProviderRouter({ health: h, now: () => t });
  assert.deepEqual(r.plan([p, q]).pool, [q]);
  t += 61000;
  assert.deepEqual(r.plan([p, q]).pool, [p, q]);
  h.ok(p, 10);
  assert.equal(h.snapshot(p).successCount, 1);
});
