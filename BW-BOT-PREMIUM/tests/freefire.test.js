'use strict';

// Pruebas del proveedor de Free Fire contra servidores HTTP locales reales (sin Internet).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');

const { normalizePlayer } = require('../src/providers/freefire/normalize');
const { FreeFireService } = require('../src/providers/freefire/service');
const { FfProvider } = require('../src/providers/freefire/provider');
const { buildConfig, validateConfig } = require('../src/config');

const UID = '123456789';
const PLAYER = { basicInfo: { accountId: UID, nickname: 'Pro', level: 65, region: 'SA', liked: 900 } };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const silent = { debug() {}, info() {}, warn() {}, error() {}, child() { return silent; } };

/** Servidor local. `handler(req, res, info)`; guarda las URLs recibidas y la concurrencia máxima. */
async function api(handler) {
  const info = { hits: 0, urls: [], headers: [], active: 0, maxActive: 0 };
  const server = http.createServer(async (req, res) => {
    info.hits += 1;
    info.urls.push(req.url);
    info.headers.push(req.headers);
    info.active += 1;
    info.maxActive = Math.max(info.maxActive, info.active);
    res.on('close', () => { info.active -= 1; });
    try { await handler(req, res, info); } catch { res.destroy(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return {
    info,
    port,
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
  };
}

const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const okPlayer = (req, res) => json(res, 200, PLAYER);
const notFound404 = (req, res) => json(res, 404, { error: 'Player not found' });
const serverError = (req, res) => json(res, 500, { error: 'boom' });
// Responde con el UID que se le pidió (la API real nunca devuelve el de otro jugador)
const okEcho = (req, res) => json(res, 200, { basicInfo: { accountId: req.url.split('?')[0].split('/').pop(), nickname: 'Eco', level: 10 } });

function service(urls, env = {}, now) {
  const config = buildConfig({ FF_API_URLS: urls.join(','), FF_API_TIMEOUT: '500', ...env }, '/x');
  return new FreeFireService({ config, logger: silent, ...(now ? { now } : {}) });
}

async function withApis(handlers, fn) {
  const servers = [];
  try {
    for (const h of handlers) servers.push(await api(h));
    await fn(servers);
  } finally {
    await Promise.all(servers.map((s) => s.close()));
  }
}

// ---------- normalizador ----------

test('normalizar: solo devuelve lo que la API entrega (nada inventado)', () => {
  const { found, data } = normalizePlayer({ basicInfo: { nickname: 'Solo', level: 12 } });
  assert.equal(found, true);
  assert.deepEqual(data, { nickname: 'Solo', level: 12 });
  for (const k of ['likes', 'rank', 'exp', 'region', 'avatarUrl', 'avatarId', 'bannerId', 'clanName', 'bio', 'createdAt']) {
    assert.equal(k in data, false, `no debe existir ${k}`);
  }
});

test('normalizar: forma anidada habitual, tipos y contextos', () => {
  const { data } = normalizePlayer({
    basicInfo: { accountId: UID, nickname: 'Pro', level: '65', exp: 123456, liked: 900, region: 'SA', rank: 321, rankingPoints: 3500, csRank: 'Heroic', csRankingPoints: 12, createAt: '1530000000', lastLoginAt: 1700000000, avatarId: 102000007, bannerId: '901000014' },
    clanBasicInfo: { clanId: '77', clanName: 'Los Mejores', clanLevel: 7, memberNum: 45, capacity: 50 },
    captainBasicInfo: { nickname: 'Capi', level: 99 },
    socialInfo: { signature: 'Hola   mundo' },
    petInfo: { name: 'Mascota', level: 9 },
  });
  assert.deepEqual(data, {
    uid: UID, nickname: 'Pro', level: 65, exp: 123456, likes: 900, region: 'sa', bio: 'Hola mundo',
    createdAt: '2018-06-26T08:00:00.000Z', lastLogin: '2023-11-14T22:13:20.000Z',
    rank: 321, rankPoints: 3500, csRank: 'Heroic', csRankPoints: 12, avatarId: 102000007, bannerId: 901000014,
    clanId: '77', clanName: 'Los Mejores', clanLevel: 7, clanMembers: 45, clanCapacity: 50,
  });
});

test('normalizar: el nombre del clan o del capitán nunca se toma como nickname', () => {
  const { found, data } = normalizePlayer({ clan: { name: 'Mi Clan', level: 5 }, captainBasicInfo: { nickname: 'Capi', level: 70 } });
  assert.equal(found, false);
  assert.equal(data.nickname, undefined);
  assert.equal(data.level, undefined);
  assert.equal(data.clanName, 'Mi Clan');
});

test('normalizar: valida URLs, números, fechas y limpia texto', () => {
  const { data } = normalizePlayer({
    nickname: 'A\u0000B‮C', level: -5, likes: 'muchos', exp: 1e15,
    avatarUrl: 'javascript:alert(1)', bannerUrl: 'https://cdn.ejemplo.com/b.png',
    createAt: 5, lastLoginAt: '1999-01-01', region: 'sa-east-1!',
  });
  assert.equal(data.nickname, 'ABC');
  for (const k of ['level', 'likes', 'exp', 'avatarUrl', 'createdAt', 'lastLogin', 'region']) assert.equal(k in data, false, k);
  assert.equal(data.bannerUrl, 'https://cdn.ejemplo.com/b.png');
});

test('normalizar: respuestas vacías, raíz de arreglo y tipos raros', () => {
  assert.equal(normalizePlayer(null).found, false);
  assert.equal(normalizePlayer('texto').found, false);
  assert.equal(normalizePlayer({}).found, false);
  assert.deepEqual(normalizePlayer([{ nickname: 'En arreglo' }]).data, { nickname: 'En arreglo' });
  assert.equal(normalizePlayer({ nickname: 'x'.repeat(500) }).data.nickname.length, 80);
});

// ---------- plantillas de URL ----------

test('plantilla: sustituye marcadores, codifica valores y añade uid si falta', () => {
  const p = new FfProvider({ index: 0, template: 'https://a.test/p/{uid}?r={region}&k={key}', apiKey: 'a b&c' });
  assert.equal(p.buildUrl('123456789', 'sa'), 'https://a.test/p/123456789?r=sa&k=a%20b%26c');
  assert.equal(p.needsRegion && p.needsKey, true);
  const q = new FfProvider({ index: 1, template: 'https://b.test/info' });
  assert.equal(q.buildUrl(UID, 'sa'), `https://b.test/info?uid=${UID}`);
  const r = new FfProvider({ index: 2, template: 'https://c.test/info?lang=es' });
  assert.equal(r.buildUrl(UID, null), `https://c.test/info?lang=es&uid=${UID}`);
  assert.equal(new FfProvider({ index: 3, template: 'https://d.test/{uid}/{region}' }).buildUrl(UID, null), `https://d.test/${UID}/`);
});

test('plantilla: la clave solo se usa con {key} y una URL sin {key} nunca la recibe', async () => {
  await withApis([okPlayer, okPlayer], async ([withKey, noKey]) => {
    const svc = service([`${withKey.base}/p/{uid}?key={key}`, `${noKey.base}/q/{uid}`], { FF_API_KEY: 'SECRETKEY', FF_MERGE_PROVIDERS: 'false' });
    // La primera responde, así que forzamos a consultar la segunda dejando caer la primera
    await svc.lookup(UID);
    assert.match(withKey.info.urls[0], /key=SECRETKEY/);
    assert.equal(noKey.info.hits, 0);
    const second = service([`${noKey.base}/q/{uid}`, `${withKey.base}/p/{uid}?key={key}`], { FF_API_KEY: 'SECRETKEY', FF_MERGE_PROVIDERS: 'false' });
    await second.lookup(UID);
    assert.equal(noKey.info.hits, 1, 'la segunda configuración sí consultó la API sin {key}');
    assert.equal(JSON.stringify(noKey.info.urls).includes('SECRETKEY'), false);
    assert.equal(JSON.stringify(noKey.info.headers).includes('SECRETKEY'), false);
  });
});

test('configuración: valida las URLs de FF_API_URLS sin mostrar claves', () => {
  const bad = buildConfig({ FF_API_URLS: 'ftp://x/{uid},no-es-url?key=SECRETO' }, '/x');
  const problems = validateConfig(bad);
  assert.equal(problems.filter((p) => p.includes('FF_API_URLS')).length, 2);
  assert.equal(problems.join(' ').includes('SECRETO'), false);
  assert.deepEqual(validateConfig(buildConfig({ FF_API_URLS: 'https://a.test/{uid}?k={key}' }, '/x')), []);
});

// ---------- consulta correcta ----------

test('lookup: éxito, normalización y cache', async () => {
  await withApis([okPlayer], async ([a]) => {
    const svc = service([`${a.base}/p/{uid}`]);
    const r = await svc.lookup(UID);
    assert.equal(r.ok, true);
    assert.deepEqual(r.data, { uid: UID, nickname: 'Pro', level: 65, likes: 900, region: 'sa' });
    assert.equal(r.region, 'sa');
    assert.equal(r.cached, false);
    assert.match(r.provider, /^127\.0\.0\.1:/);
    const again = await svc.lookup(UID);
    assert.equal(again.cached, true);
    assert.equal(a.info.hits, 1, 'la segunda consulta sale de la cache');
    await svc.lookup(UID, { fresh: true });
    assert.equal(a.info.hits, 2, 'fresh ignora la cache');
  });
});

test('lookup: los datos devueltos no se pueden modificar (protege la cache)', async () => {
  await withApis([okPlayer], async ([a]) => {
    const svc = service([`${a.base}/p/{uid}`]);
    const r = await svc.lookup(UID);
    assert.throws(() => { 'use strict'; r.data.level = 999; }, TypeError);
    assert.equal((await svc.lookup(UID)).data.level, 65);
  });
});

test('cache: caduca por TTL y no guarda fallos de API', async () => {
  let t = 1_000_000;
  let mode = 'down';
  await withApis([(req, res) => (mode === 'down' ? serverError(req, res) : okPlayer(req, res))], async ([a]) => {
    const svc = service([`${a.base}/p/{uid}`], { FF_CACHE_TTL: '300' }, () => t);
    assert.equal((await svc.lookup(UID)).kind, 'API_DOWN');
    assert.equal((await svc.lookup(UID)).kind, 'API_DOWN');
    assert.equal(a.info.hits, 2, 'un fallo no se cachea');
    mode = 'ok';
    t += 70_000; // fuera de la pausa del breaker
    assert.equal((await svc.lookup(UID)).ok, true);
    const hits = a.info.hits;
    t += 299_000;
    assert.equal((await svc.lookup(UID)).cached, true);
    t += 2_000;
    assert.equal((await svc.lookup(UID)).cached, false);
    assert.equal(a.info.hits, hits + 1);
  });
});

test('cache: FF_CACHE_TTL=0 desactiva la cache', async () => {
  await withApis([okPlayer], async ([a]) => {
    const svc = service([`${a.base}/p/{uid}`], { FF_CACHE_TTL: '0' });
    await svc.lookup(UID);
    await svc.lookup(UID);
    assert.equal(a.info.hits, 2);
  });
});

test('consultas simultáneas del mismo UID comparten una sola petición', async () => {
  await withApis([async (req, res) => { await sleep(100); okPlayer(req, res); }], async ([a]) => {
    const svc = service([`${a.base}/p/{uid}`]);
    const results = await Promise.all(Array.from({ length: 6 }, () => svc.lookup(UID)));
    assert.equal(a.info.hits, 1);
    assert.ok(results.every((r) => r.ok));
  });
});

test('límite de concurrencia: nunca más de FF_API_MAX_CONCURRENT peticiones a la vez', async () => {
  await withApis([async (req, res) => { await sleep(80); json(res, 200, { nickname: 'X', level: 1 }); }], async ([a]) => {
    const svc = service([`${a.base}/p/{uid}`], { FF_API_MAX_CONCURRENT: '2' });
    const uids = Array.from({ length: 6 }, (_, i) => String(100000 + i));
    const results = await Promise.all(uids.map((u) => svc.lookup(u)));
    assert.ok(results.every((r) => r.ok));
    assert.equal(a.info.hits, 6);
    assert.ok(a.info.maxActive <= 2, `máximo simultáneo: ${a.info.maxActive}`);
  });
});

// ---------- diferenciación de errores ----------

test('sin configurar: no hay APIs, o la API pide {key} y no hay clave; no se hace ninguna petición', async () => {
  const none = service([]);
  const r = await none.lookup(UID);
  assert.deepEqual([r.ok, r.kind], [false, 'NOT_CONFIGURED']);
  assert.match(r.message, /FF_API_URLS/);
  assert.equal(none.configured, false);

  const noKey = service(['https://api.test/p/{uid}?k={key}']);
  assert.equal(noKey.configured, false);
  assert.equal((await noKey.lookup(UID)).kind, 'NOT_CONFIGURED');
  assert.equal(noKey.status()[0].state, 'sin_configurar');
});

test('UID inválido se rechaza antes de consultar', async () => {
  const svc = service(['https://api.test/p/{uid}']);
  for (const bad of ['abc', '123', '', undefined, '1'.repeat(20), '12 34 56']) {
    assert.equal((await svc.lookup(bad)).kind, 'INVALID_UID', String(bad));
  }
});

const NOT_FOUND_SHAPES = [
  ['HTTP 404', notFound404],
  ['200 con error "Player not found"', (req, res) => json(res, 200, { error: 'Player not found' })],
  ['200 con status error y mensaje', (req, res) => json(res, 200, { status: 'error', message: 'UID not found' })],
  ['200 con success=false', (req, res) => json(res, 200, { success: false, message: 'No encontrado' })],
  ['200 con cuerpo vacío', (req, res) => json(res, 200, {})],
  ['200 con data null', (req, res) => json(res, 200, { data: null })],
  ['400 con uid inválido', (req, res) => json(res, 400, { message: 'Invalid UID' })],
];
for (const [name, handler] of NOT_FOUND_SHAPES) {
  test(`jugador no encontrado: ${name}`, async () => {
    await withApis([handler], async ([a]) => {
      const svc = service([`${a.base}/p/{uid}`]);
      const r = await svc.lookup(UID);
      assert.deepEqual([r.ok, r.kind, r.partial], [false, 'NOT_FOUND', false]);
      assert.match(r.message, /No encontré/);
    });
  });
}

const DOWN_SHAPES = [
  ['HTTP 500', serverError],
  ['HTTP 503', (req, res) => json(res, 503, {})],
  ['HTTP 429', (req, res) => json(res, 429, { error: 'slow down' })],
  ['HTTP 401 (clave rechazada)', (req, res) => json(res, 401, { error: 'bad key' })],
  ['JSON inválido', (req, res) => { res.writeHead(200); res.end('<html>oops'); }],
  ['200 sin datos reconocibles', (req, res) => json(res, 200, { foo: 'bar', baz: 1 })],
  ['200 con error desconocido', (req, res) => json(res, 200, { error: 'internal failure' })],
];
for (const [name, handler] of DOWN_SHAPES) {
  test(`API caída/inválida: ${name}`, async () => {
    await withApis([handler], async ([a]) => {
      const svc = service([`${a.base}/p/{uid}`]);
      const r = await svc.lookup(UID);
      assert.deepEqual([r.ok, r.kind], [false, 'API_DOWN']);
      assert.match(r.message, /no respondieron/);
    });
  });
}

test('API caída: conexión rechazada y el detalle no revela la URL', async () => {
  const dead = await api(okPlayer);
  const base = dead.base;
  await dead.close();
  const svc = service([`${base}/p/{uid}?key=SECRETKEY`]);
  const r = await svc.lookup(UID);
  assert.equal(r.kind, 'API_DOWN');
  const st = svc.status()[0];
  assert.match(st.lastError, /ECONNREFUSED/);
  assert.equal(JSON.stringify(st).includes('SECRETKEY'), false);
  assert.equal(JSON.stringify(st).includes('/p/'), false);
});

test('timeout por API: la lenta se abandona y responde la siguiente', async () => {
  await withApis([async () => { await sleep(1500); }, okPlayer], async ([slow, fast]) => {
    const svc = service([`${slow.base}/p/{uid}`, `${fast.base}/p/{uid}`]);
    const started = Date.now();
    const r = await svc.lookup(UID);
    assert.equal(r.ok, true);
    assert.match(r.provider, new RegExp(String(fast.port)));
    assert.ok(Date.now() - started < 1400, 'no esperó a la API lenta');
    const st = svc.status().find((s) => s.name.includes(String(slow.port)));
    assert.match(st.lastError, /Tiempo de espera/);
  });
});

test('respuesta enorme: se rechaza sin cargarla completa', async () => {
  await withApis([(req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ nickname: 'x', pad: 'a'.repeat(2 * 1024 * 1024) })); }], async ([a]) => {
    const r = await service([`${a.base}/p/{uid}`]).lookup(UID);
    assert.equal(r.kind, 'API_DOWN');
  });
});

test('la API devuelve datos de otro UID: se rechaza', async () => {
  await withApis([(req, res) => json(res, 200, { basicInfo: { accountId: '999999999', nickname: 'Otro', level: 3 } })], async ([a]) => {
    const r = await service([`${a.base}/p/{uid}`]).lookup(UID);
    assert.equal(r.ok, false);
    assert.equal(r.kind, 'API_DOWN');
  });
});

// ---------- fallback ----------

test('fallback: si la primera cae, usa la segunda; si cae la segunda, usa la tercera', async () => {
  await withApis([serverError, (req, res) => json(res, 200, { foo: 1 }), okPlayer], async ([a, b, c]) => {
    const svc = service([`${a.base}/p/{uid}`, `${b.base}/p/{uid}`, `${c.base}/p/{uid}`]);
    const r = await svc.lookup(UID);
    assert.equal(r.ok, true);
    assert.match(r.provider, new RegExp(String(c.port)));
    assert.deepEqual([a.info.hits, b.info.hits, c.info.hits], [1, 1, 1]);
  });
});

test('fallback: si una API dice "no encontrado" pero otra lo tiene, gana la que lo tiene', async () => {
  await withApis([notFound404, okPlayer], async ([a, b]) => {
    const r = await service([`${a.base}/p/{uid}`, `${b.base}/p/{uid}`]).lookup(UID);
    assert.equal(r.ok, true);
    assert.equal(r.data.nickname, 'Pro');
  });
});

test('"no encontrado" definitivo se cachea poco tiempo; parcial (otra API caída) no se cachea', async () => {
  await withApis([notFound404, notFound404], async ([a, b]) => {
    const svc = service([`${a.base}/p/{uid}`, `${b.base}/p/{uid}`]);
    const r = await svc.lookup(UID);
    assert.deepEqual([r.kind, r.partial], ['NOT_FOUND', false]);
    const again = await svc.lookup(UID);
    assert.equal(again.cached, true);
    assert.equal(a.info.hits, 1);
  });
  await withApis([notFound404, serverError], async ([a, b]) => {
    const svc = service([`${a.base}/p/{uid}`, `${b.base}/p/{uid}`]);
    const r = await svc.lookup(UID);
    assert.deepEqual([r.kind, r.partial], ['NOT_FOUND', true]);
    assert.match(r.message, /podría no ser definitivo/);
    await svc.lookup(UID);
    assert.equal(a.info.hits, 2, 'el resultado parcial no se cachea');
  });
});

test('todas las APIs caídas: API_DOWN con detalle por proveedor sin URLs', async () => {
  await withApis([serverError, (req, res) => json(res, 502, {})], async ([a, b]) => {
    const r = await service([`${a.base}/p/{uid}`, `${b.base}/p/{uid}`]).lookup(UID);
    assert.equal(r.kind, 'API_DOWN');
    assert.equal(r.attempts.length, 2);
    assert.equal(JSON.stringify(r).includes('/p/'), false);
  });
});

// ---------- circuit breaker ----------

test('breaker: tras 3 fallos seguidos la API se pausa 60 s y luego se reintenta', async () => {
  let t = 5_000_000;
  await withApis([serverError, okEcho], async ([bad, good]) => {
    const svc = service([`${bad.base}/p/{uid}`, `${good.base}/p/{uid}`], {}, () => t);
    for (let i = 0; i < 3; i++) assert.equal((await svc.lookup(String(200000 + i))).ok, true);
    assert.equal(bad.info.hits, 3);
    assert.equal(svc.status()[0].state, 'caida');
    for (let i = 3; i < 6; i++) assert.equal((await svc.lookup(String(200000 + i))).ok, true);
    assert.equal(bad.info.hits, 3, 'en pausa: ya no se le consulta');
    t += 61_000;
    await svc.lookup('200999');
    assert.equal(bad.info.hits, 4, 'pasada la pausa se vuelve a probar');
  });
});

test('breaker: si todas las APIs están en pausa se intentan igualmente', async () => {
  let t = 9_000_000;
  let mode = 'down';
  await withApis([(req, res) => (mode === 'down' ? serverError(req, res) : okEcho(req, res))], async ([a]) => {
    const svc = service([`${a.base}/p/{uid}`], {}, () => t);
    for (let i = 0; i < 3; i++) await svc.lookup(String(300000 + i));
    assert.equal(svc.status()[0].state, 'caida');
    mode = 'ok';
    assert.equal((await svc.lookup('300500')).ok, true, 'no se queda sin servicio aunque todas estén en pausa');
    assert.equal(svc.status()[0].state, 'ok');
  });
});

test('"no encontrado" no cuenta como fallo del servicio para el breaker', async () => {
  await withApis([notFound404], async ([a]) => {
    const svc = service([`${a.base}/p/{uid}`]);
    for (let i = 0; i < 5; i++) await svc.lookup(String(400000 + i));
    assert.equal(svc.status()[0].state, 'ok');
    assert.equal(a.info.hits, 5);
  });
});

// ---------- región ----------

test('región: se detecta probando FF_REGIONS en orden y se recuerda para ese UID', async () => {
  const onlySa = (req, res) => (req.url.includes('/sa/') ? okPlayer(req, res) : notFound404(req, res));
  await withApis([onlySa], async ([a]) => {
    const svc = service([`${a.base}/r/{region}/{uid}`], { FF_REGIONS: 'br,sa,us' });
    const r = await svc.lookup(UID);
    assert.equal(r.ok, true);
    assert.equal(r.region, 'sa');
    assert.deepEqual(a.info.urls.map((u) => u.split('/')[2]), ['br', 'sa'], 'probó br y luego sa; no llegó a us');
    await svc.lookup(UID, { fresh: true });
    assert.equal(a.info.urls.at(-1).split('/')[2], 'sa', 'ahora empieza por la región recordada');
    assert.equal(a.info.hits, 3);
  });
});

test('región: FF_DEFAULT_REGION se prueba primero y la indicada por el usuario manda', async () => {
  await withApis([okPlayer], async ([a]) => {
    const svc = service([`${a.base}/r/{region}/{uid}`], { FF_DEFAULT_REGION: 'br', FF_REGIONS: 'sa' });
    await svc.lookup(UID);
    assert.equal(a.info.urls[0].split('/')[2], 'br');
    await svc.lookup('987654321', { region: 'us' });
    assert.equal(a.info.urls.at(-1).split('/')[2], 'us');
    assert.equal(a.info.hits, 2, 'con región explícita no se prueban otras');
  });
});

test('región: si ninguna región configurada lo tiene, "no encontrado" indica las regiones probadas', async () => {
  await withApis([notFound404], async ([a]) => {
    const r = await service([`${a.base}/r/{region}/{uid}`], { FF_REGIONS: 'br,sa' }).lookup(UID);
    assert.equal(r.kind, 'NOT_FOUND');
    assert.deepEqual(r.regionsTried, ['br', 'sa']);
    assert.match(r.message, /br, sa/);
    assert.equal(a.info.hits, 2);
  });
});

test('región: una API que necesita región y ninguna conocida pide la región sin hacer peticiones', async () => {
  await withApis([okPlayer], async ([a]) => {
    const r = await service([`${a.base}/r/{region}/{uid}`]).lookup(UID);
    assert.deepEqual([r.kind, r.needRegion], ['REGION_ERROR', true]);
    assert.match(r.message, /región/);
    assert.equal(a.info.hits, 0);
  });
});

test('región: error de región de la API se distingue de "no encontrado"', async () => {
  await withApis([(req, res) => json(res, 400, { message: 'Invalid region' })], async ([a]) => {
    const r = await service([`${a.base}/r/{region}/{uid}`]).lookup(UID, { region: 'zz' });
    assert.equal(r.kind, 'REGION_ERROR');
    assert.match(r.message, /zz/);
  });
});

test('región: una API sin {region} se consulta una sola vez aunque se prueben varias regiones', async () => {
  await withApis([notFound404, notFound404], async ([noRegion, withRegion]) => {
    const svc = service([`${noRegion.base}/p/{uid}`, `${withRegion.base}/r/{region}/{uid}`], { FF_REGIONS: 'br,sa,us' });
    const r = await svc.lookup(UID);
    assert.equal(r.kind, 'NOT_FOUND');
    assert.equal(noRegion.info.hits, 1);
    assert.equal(withRegion.info.hits, 3);
  });
});

test('región: sin respuesta de ninguna API no se sigue probando regiones (no se satura)', async () => {
  await withApis([serverError], async ([a]) => {
    const r = await service([`${a.base}/r/{region}/{uid}`], { FF_REGIONS: 'br,sa,us,me,id' }).lookup(UID);
    assert.equal(r.kind, 'API_DOWN');
    assert.equal(a.info.hits, 1);
  });
});

test('estado de las APIs: solo hosts, sin rutas ni claves', async () => {
  await withApis([okPlayer], async ([a]) => {
    const svc = service([`${a.base}/p/{uid}?key={key}`], { FF_API_KEY: 'SECRETKEY' });
    assert.equal(svc.status()[0].state, 'sin_probar');
    await svc.lookup(UID);
    const st = svc.status();
    assert.equal(st[0].state, 'ok');
    assert.ok(st[0].lastLatencyMs >= 0);
    assert.equal(JSON.stringify(st).includes('SECRETKEY'), false);
    assert.equal(JSON.stringify(st).includes('/p/'), false);
  });
});

test('dos APIs del mismo host se distinguen en el estado', () => {
  const svc = service(['https://api.test/a/{uid}', 'https://api.test/b/{uid}']);
  assert.deepEqual(svc.status().map((s) => s.name), ['api.test', 'api.test#2']);
});

test('fetch del sistema no disponible: se reporta API_DOWN sin romper', async () => {
  const config = buildConfig({ FF_API_URLS: 'https://api.test/p/{uid}' }, '/x');
  const svc = new FreeFireService({ config, logger: silent, fetchImpl: undefined });
  svc.providers.forEach((p) => { p.fetchImpl = undefined; });
  assert.equal((await svc.lookup(UID)).kind, 'API_DOWN');
});

test('puerto cerrado de verdad: el timeout no deja temporizadores colgados', async () => {
  // Servidor que acepta la conexión TCP pero nunca responde
  const srv = net.createServer(() => {});
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  try {
    const r = await service([`http://127.0.0.1:${port}/p/{uid}`]).lookup(UID);
    assert.equal(r.kind, 'API_DOWN');
  } finally {
    srv.close();
  }
});
