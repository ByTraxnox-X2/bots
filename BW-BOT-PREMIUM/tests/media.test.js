'use strict';

// .play y comandos de medios contra un proveedor HTTP local real (sin Internet). Verifica que NUNCA se inventan datos
// y que cada fallo se informa tal cual. La conexión con proveedores reales NO se prueba aquí (ver docs/API_PROVIDERS.md).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { boot, say, P } = require('./support');

const MP3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(3000, 7)]);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypmp42'), Buffer.alloc(3000, 3)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(500, 1)]);

const FULL = { title: 'Canción Real', url: 'https://videos.example/watch?v=abc', author: 'Artista Uno', duration: '3:45', views: 1234567, published: 'hace 2 años' };
const MINIMAL = { title: 'Solo Título', url: 'https://videos.example/watch?v=zzz' };

/** Proveedor local: /search, /dl (resuelve a /file/...) y los archivos. `opts` ajusta el comportamiento. */
async function provider(opts = {}) {
  const info = { hits: {}, urls: [] };
  const base = () => `http://127.0.0.1:${server.address().port}`;
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    info.hits[u.pathname] = (info.hits[u.pathname] || 0) + 1;
    info.urls.push(req.url);
    const json = (s, b) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (u.pathname === '/search') {
      if (opts.searchStatus) return json(opts.searchStatus, { error: 'x' });
      return json(200, { results: opts.results || [{ ...FULL, thumbnail: `${base()}/file/thumb.png` }, { ...MINIMAL }] });
    }
    if (u.pathname === '/dl') {
      if (opts.unavailable) return json(200, { error: 'Contenido protegido, no disponible' });
      if (opts.privateUrl) return json(200, { download: 'http://127.0.0.1:9/file/a.mp3' });
      const kind = u.searchParams.get('type') === 'video' ? 'mp4' : 'mp3';
      return json(200, { download: `${base()}/file/${opts.fileName || `a.${kind}`}` });
    }
    if (u.pathname.startsWith('/file/')) {
      if (opts.html) { res.writeHead(200, { 'content-type': 'audio/mpeg' }); return res.end('<html>no soy audio</html>'); }
      if (opts.big) { res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': String(opts.big) }); return res.end(); }
      if (opts.slowMs) return setTimeout(() => { res.writeHead(200, { 'content-type': 'audio/mpeg' }); res.end(MP3); }, opts.slowMs);
      if (u.pathname.endsWith('.png')) { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(PNG); }
      if (u.pathname.endsWith('.mp4')) { res.writeHead(200, { 'content-type': 'video/mp4' }); return res.end(MP4); }
      res.writeHead(200, { 'content-type': 'audio/mpeg' });
      return res.end(MP3);
    }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { info, base: base(), close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) };
}

async function setup(opts = {}, { env = {}, harness = {}, noDownload = false } = {}) {
  const prov = await provider(opts);
  const h = await boot({
    env: { MEDIA_PROVIDER_1_URL: `${prov.base}/search?q={query}&type={type}`, ...(noDownload ? {} : { MEDIA_PROVIDER_2_URL: `${prov.base}/dl?url={url}&type={type}` }), PLAY_TIMEOUT: '3000', ...env },
    harness: { mediaOptions: { allowPrivate: true }, ...harness },
  });
  return { h, prov, close: async () => { h.close(); await prov.close(); } };
}
const tmpLeft = (h) => { const d = path.join(h.config.paths.tmp, 'media'); return fs.existsSync(d) ? fs.readdirSync(d) : []; };

test('.play: muestra SOLO los datos reales, botones numerados y otros resultados; sin miniatura inventada', async () => {
  const { h, close } = await setup({ results: [{ ...FULL }, { ...MINIMAL }] });
  try {
    const out = await say(h, '.play canción real');
    assert.match(out, /Canción Real/);
    assert.match(out, /Artista Uno/);
    assert.match(out, /3:45/);
    assert.match(out, /1[.,]234[.,]567 vistas/);
    assert.match(out, /hace 2 años/);
    assert.match(out, /videos\.example\/watch\?v=abc/);
    assert.match(out, /\*\.1\* 🎵 AUDIO[\s\S]*\*\.2\* 🎬 VIDEO[\s\S]*\*\.3\* 🔗 ABRIR[\s\S]*\*\.4\* ❌ CANCELAR/);
    assert.match(out, /Otros resultados[\s\S]*2\. Solo Título/);
    assert.equal(h.media.length, 0, 'sin miniatura del proveedor no se envía imagen');
    // El segundo resultado no tiene autor/duración/vistas: no se muestran ni se inventan
    const second = await say(h, '.play 2');
    assert.match(second, /Solo Título/);
    assert.ok(!/👤|⏱️|👁️|📅/.test(second), 'campos ausentes no aparecen');
  } finally { await close(); }
});

test('.play con miniatura: envía la imagen real del proveedor con la ficha como pie de foto', async () => {
  const { h, close } = await setup();
  try {
    const out = await say(h, '.play canción real');
    assert.equal(out, '', 'la ficha va como pie de la imagen, no como texto aparte');
    assert.equal(h.media.length, 1);
    assert.equal(h.media[0].kind, 'image');
    assert.equal(h.media[0].mimetype, 'image/png');
    assert.match(h.media[0].caption, /Canción Real[\s\S]*\.1\* 🎵 AUDIO/);
    assert.deepEqual(tmpLeft(h), [], 'la miniatura temporal se borra');
  } finally { await close(); }
});

test('flujo completo con botones numerados: .1 = AUDIO descarga, valida y envía el archivo; limpia temporales', async () => {
  const { h, prov, close } = await setup();
  try {
    await say(h, '.play canción real');
    h.media.length = 0;
    const out = await say(h, '.1');
    assert.match(out, /Preparando el audio de \*Canción Real\*/);
    assert.ok(!/descargado correctamente/i.test(out));
    assert.equal(h.media.length, 1);
    const m = h.media[0];
    assert.equal(m.kind, 'audio');
    assert.equal(m.mimetype, 'audio/mpeg');
    assert.equal(m.bytes, MP3.length);
    assert.equal(m.exists, true);
    assert.match(m.fileName, /^Canción Real\.mp3$/);
    assert.deepEqual(tmpLeft(h), []);
    // Segunda vez: sale de la caché de archivos (el proveedor no vuelve a ser consultado)
    await say(h, '.playaudio');
    assert.equal(h.media.length, 2);
    assert.equal(prov.info.hits['/file/a.mp3'], 1);
    assert.equal(prov.info.hits['/dl'], 1);
  } finally { await close(); }
});

test('.playvideo: valida MP4 y lo envía como video', async () => {
  const { h, close } = await setup();
  try {
    await say(h, '.play canción real');
    h.media.length = 0;
    await say(h, '.playvideo');
    assert.equal(h.media.length, 1);
    assert.equal(h.media[0].kind, 'video');
    assert.equal(h.media[0].mimetype, 'video/mp4');
  } finally { await close(); }
});

test('.audio con búsqueda directa y .buscar/.buscarmusica/.buscarvideo listan solo resultados reales', async () => {
  const { h, prov, close } = await setup();
  try {
    await say(h, '.audio canción real');
    assert.equal(h.media.filter((m) => m.kind === 'audio').length, 1);
    const list = await say(h, '.buscar canción');
    assert.match(list, /1\. \*Canción Real\* — Artista Uno \(3:45\)[\s\S]*2\. \*Solo Título\*/);
    assert.match(list, /Elige con \*\.play N\*/);
    await say(h, '.buscarmusica canción');
    await say(h, '.buscarvideo canción');
    assert.ok(prov.info.urls.some((u) => u.includes('type=audio')) && prov.info.urls.some((u) => u.includes('type=video')));
    assert.match(await say(h, '.buscar'), /Uso:/);
  } finally { await close(); }
});

test('sin proveedor configurado: mensaje claro y nada inventado', async () => {
  const h = await boot({ env: {}, harness: {} });
  try {
    assert.match(await say(h, '.play algo'), /no está configurada/);
    assert.match(await say(h, '.buscar algo'), /no está configurada/);
    assert.match(await say(h, '.playaudio algo'), /no está configurada/);
    assert.equal(h.media.length, 0);
  } finally { h.close(); }
});

test('solo búsqueda (sin proveedor de descarga): muestra la ficha, sin botones de descarga, y descargar lo explica', async () => {
  const { h, close } = await setup({}, { noDownload: true });
  try {
    await say(h, '.play canción real');
    const out = h.media[0].caption; // la miniatura real viaja con la ficha
    assert.match(out, /solo puedo mostrar la información/);
    assert.ok(!/AUDIO|VIDEO/.test(out));
    assert.match(await say(h, '.playaudio 1'), /no está configurada/);
  } finally { await close(); }
});

test('proveedor que NO permite descargar: lo dice y no envía nada', async () => {
  const { h, close } = await setup({ unavailable: true });
  try {
    await say(h, '.play canción real');
    h.media.length = 0;
    const out = await say(h, '.playaudio');
    assert.match(out, /no permite obtener ese contenido/);
    assert.ok(!/descargado correctamente/i.test(out));
    assert.equal(h.media.length, 0);
    assert.match(await say(h, '.infoaudio'), /❌ No disponible: el proveedor no permite descargarlo/);
  } finally { await close(); }
});

test('contenido inválido (HTML como audio), demasiado grande y URL privada: se rechazan y no quedan temporales', async () => {
  for (const [opts, re] of [[{ html: true }, /no es un audio\/video válido/], [{ big: 999999999 }, /supera el tamaño máximo/]]) {
    const { h, close } = await setup(opts, { env: { MAX_PLAY_FILE_SIZE: '1048576' } });
    try {
      await say(h, '.play canción real');
      h.media.length = 0;
      assert.match(await say(h, '.playaudio'), re);
      assert.equal(h.media.length, 0);
      assert.deepEqual(tmpLeft(h), []);
    } finally { await close(); }
  }
  const { h, close } = await setup({ privateUrl: true }, { harness: { mediaOptions: {} } });
  try {
    await say(h, '.play canción real');
    h.media.length = 0;
    assert.match(await say(h, '.playaudio'), /dirección no permitida/);
    assert.equal(h.media.length, 0);
  } finally { await close(); }
});

test('si WhatsApp rechaza el archivo: lo informa y borra el temporal (sin "descargado correctamente")', async () => {
  const { h, close } = await setup({}, { env: { PLAY_FILE_CACHE_MB: '0' }, harness: { mediaFails: true } });
  try {
    await say(h, '.play canción real');
    const out = await say(h, '.playaudio');
    assert.match(out, /No pude enviar el archivo por WhatsApp/);
    assert.ok(!/descargado correctamente/i.test(out));
    assert.deepEqual(tmpLeft(h), []);
  } finally { await close(); }
});

test('fallback entre proveedores de búsqueda y caché de búsquedas', async () => {
  const bad = await provider({ searchStatus: 503 });
  const good = await provider();
  const h = await boot({ env: { MEDIA_PROVIDER_1_URL: `${bad.base}/search?q={query}`, MEDIA_PROVIDER_2_URL: `${good.base}/search?q={query}` }, harness: { mediaOptions: { allowPrivate: true } } });
  try {
    assert.match(await say(h, '.buscar canción'), /Canción Real/);
    assert.equal(bad.info.hits['/search'], 1);
    assert.equal(good.info.hits['/search'], 1);
    assert.match(await say(h, '.buscar canción'), /caché/);
    assert.equal(good.info.hits['/search'], 1, 'segunda búsqueda sale de la caché');
    const st = h.services.media.status();
    assert.equal(st.length, 2);
  } finally { h.close(); await bad.close(); await good.close(); }
});

test('todos los proveedores caídos: aviso claro, sin resultados inventados', async () => {
  const bad = await provider({ searchStatus: 500 });
  const h = await boot({ env: { MEDIA_PROVIDER_1_URL: `${bad.base}/search?q={query}` }, harness: { mediaOptions: { allowPrivate: true } } });
  try {
    assert.match(await say(h, '.play algo'), /no respondieron/);
  } finally { h.close(); await bad.close(); }
});

test('contexto: caduca, .playcancelar lo borra y los números viejos no hacen nada', async () => {
  const { h, close } = await setup();
  try {
    await say(h, '.play canción real');
    h.clock.t += 6 * 60 * 1000;
    assert.match(await say(h, '.playaudio'), /No hay un elemento seleccionado/);
    assert.equal(await say(h, '.1'), '', 'un número sin lista vigente se ignora');
    await say(h, '.play canción real');
    assert.match(await say(h, '.playcancelar'), /cancelada/);
    assert.match(await say(h, '.abrir'), /No hay un elemento seleccionado/);
    assert.match(await say(h, '.playcancelar'), /No había/);
  } finally { await close(); }
});

test('.abrir, .infovideo, .miniatura y duración máxima', async () => {
  const { h, close } = await setup({ results: [{ ...FULL, thumbnail: undefined }, { ...MINIMAL, duration: 99999 }] }, { env: { PLAY_MAX_DURATION: '600' } });
  try {
    await say(h, '.play canción real');
    assert.match(await say(h, '.abrir'), /videos\.example\/watch\?v=abc/);
    assert.match(await say(h, '.infovideo'), /✅ Video disponible \(0\.0 MB · video\/mp4\)|✅ Video disponible/);
    assert.match(await say(h, '.miniatura'), /no entregó miniatura/);
    const t = await say(h, '.play 2');
    assert.match(t, /Solo Título/);
    assert.match(await say(h, '.playaudio'), /dura más del máximo permitido/);
    assert.match(await say(h, '.infoaudio'), /❌ No disponible: dura más del máximo/);
  } finally { await close(); }
});

test('cola: un usuario no puede tener dos descargas a la vez', async () => {
  const { h, close } = await setup({ slowMs: 400 });
  try {
    await say(h, '.play canción real');
    h.media.length = 0;
    const a = say(h, '.playaudio');
    await new Promise((r) => setTimeout(r, 100));
    const b = await say(h, '.playvideo');
    await a;
    assert.match(b, /Ya tienes una descarga en curso|Preparando/);
    assert.equal(h.media.filter((m) => m.kind === 'audio').length, 1);
  } finally { await close(); }
});

test('botón pulsado (buttonsResponseMessage) ejecuta el mismo comando; otro usuario no puede usarlo; expira', async () => {
  const { h, close } = await setup();
  try {
    await say(h, '.play canción real', P[2]);
    const it = [...h.services.interactions.byToken.values()].pop();
    const press = (from, id) => h.d.handleMessage({ key: { remoteJid: require('./support').GROUP, participant: from, id: `B${Math.random()}` }, pushName: 'x', messageTimestamp: Math.floor(h.clock.t / 1000), message: { buttonsResponseMessage: { selectedButtonId: id, selectedDisplayText: 'AUDIO' } } });
    h.media.length = 0; h.sent.length = 0;
    await press(P[3], it.items[0].buttonId);
    assert.match(h.sent.map((s) => s.text).join('\n'), /Ese botón es de otra persona/);
    assert.equal(h.media.length, 0);
    await press(P[2], it.items[0].buttonId);
    assert.equal(h.media.filter((m) => m.kind === 'audio').length, 1);
    h.clock.t += 6 * 60 * 1000; h.sent.length = 0;
    h.d.denyLimiter.clear(`d:${P[2]}`);
    await press(P[2], it.items[0].buttonId);
    assert.match(h.sent.map((s) => s.text).join('\n'), /ya expiró/);
  } finally { await close(); }
});
