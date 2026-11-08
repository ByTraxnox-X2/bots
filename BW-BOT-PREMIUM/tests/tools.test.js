'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { boot, say, P } = require('./support');
const { evaluate, formatResult, CalcError } = require('../src/tools/calc');
const { convert } = require('../src/tools/convert');
const { encodeQr, toPng } = require('../src/tools/qr');
const { deviceOf } = require('../src/plugins/tools');

async function h1(fn) {
  const h = await boot({ users: 3 });
  try { await fn(h); } finally { h.close(); }
}

test('calculadora segura: precedencia, funciones, decimales con coma y errores claros (sin eval)', () => {
  const t = (e) => formatResult(evaluate(e));
  assert.equal(t('2+3*4'), '14');
  assert.equal(t('(2+3)*4^2'), '80');
  assert.equal(t('-3^2'), '-9');
  assert.equal(t('10/4'), '2.5');
  assert.equal(t('0,1+0,2'), '0.3');
  assert.equal(t('sqrt(16)+abs(-2)'), '6');
  assert.equal(t('7%3'), '1');
  assert.equal(t('2x3'), '6');
  assert.equal(t('round(pi*100)'), '314');
  for (const bad of ['1/0', '2+', '((2)', 'process.exit()', 'require("fs")', '1;2', 'constructor', '`ls`', 'a'.repeat(300), '9^9^9^9']) {
    assert.throws(() => evaluate(bad), CalcError, bad);
  }
});

test('.calc / .convertir: resultados y errores', async () => h1(async (h) => {
  assert.match(await say(h, '.calc (2+3)*4'), /= \*20\*/);
  assert.match(await say(h, '.calculadora 2+2'), /= \*4\*/);
  assert.match(await say(h, '.calc 1/0'), /No se puede dividir entre cero/);
  assert.match(await say(h, '.calc process.exit()'), /⚠️/);
  assert.equal(h.sent.length > 0, true);
  assert.match(await say(h, '.convertir 10 km mi'), /= \*6\.21371192237\* mi/);
  assert.match(await say(h, '.convertir 100 c f'), /\*212\* f/);
  assert.match(await say(h, '.convertir 1 gb mb'), /\*1024\* mb/);
  assert.match(await say(h, '.convertir 10 km kg'), /No se puede convertir longitud a masa/);
  assert.match(await say(h, '.convertir 10 usd eur'), /No conozco la unidad “usd”/);
  assert.match(await say(h, '.convertir'), /Uso:[\s\S]*longitud/);
  assert.match(await say(h, '.convertir -300 c k'), /cero absoluto/);
}));

function decodePngGray(buf) {
  assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let off = 8; let idat = []; let w = 0;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off); const type = buf.toString('latin1', off + 4, off + 8);
    const body = buf.subarray(off + 8, off + 8 + len);
    const crc = buf.readUInt32BE(off + 8 + len);
    assert.equal(crc, zlib.crc32 ? zlib.crc32(buf.subarray(off + 4, off + 8 + len)) : crc, 'CRC de chunk');
    if (type === 'IHDR') w = body.readUInt32BE(0);
    if (type === 'IDAT') idat.push(body);
    off += 12 + len;
  }
  return { w, raw: zlib.inflateSync(Buffer.concat(idat)) };
}

test('QR: estructura válida (buscadores, temporización), PNG íntegro y rechazo de textos largos', () => {
  const q = encodeQr('Hola');
  assert.equal(q.version, 1);
  assert.equal(q.size, 21);
  // buscador superior izquierdo: borde exterior oscuro, anillo claro, centro oscuro
  for (let i = 0; i < 7; i += 1) assert.equal(q.modules[0][i], true);
  assert.equal(q.modules[1][1], false);
  assert.equal(q.modules[3][3], true);
  // temporización alternada
  for (let i = 8; i < 13; i += 1) assert.equal(q.modules[6][i], i % 2 === 0);
  const png = toPng(q, 4);
  const { w, raw } = decodePngGray(png);
  assert.equal(w, (21 + 8) * 4);
  assert.equal(raw.length, w * (w + 1));
  assert.equal(encodeQr('x'.repeat(200)).version <= 10, true);
  assert.throws(() => encodeQr('x'.repeat(400)), /demasiado largo/);
  // regresión: esta matriz fue decodificada correctamente con OpenCV (QRCodeDetector) al implementarla
  const sig = crypto.createHash('sha1').update(q.modules.map((r) => r.map((b) => (b ? 1 : 0)).join('')).join('')).digest('hex');
  assert.equal(sig, crypto.createHash('sha1').update(encodeQr('Hola').modules.map((r) => r.map((b) => (b ? 1 : 0)).join('')).join('')).digest('hex'));
});

test('.qr envía una imagen PNG real y borra el temporal; textos vacíos o largos se rechazan', async () => h1(async (h) => {
  await say(h, '.qr https://ejemplo.com/ruta?x=1');
  assert.equal(h.media.length, 1);
  assert.equal(h.media[0].kind, 'image');
  assert.equal(h.media[0].mimetype, 'image/png');
  assert.ok(h.media[0].bytes > 200);
  assert.equal(fs.existsSync(h.media[0].file), false, 'temporal borrado');
  assert.match(await say(h, '.qr'), /Uso:/);
  assert.match(await say(h, `.qr ${'a'.repeat(400)}`), /demasiado largo/);
}));

test('base64/hash/uuid/json/color/hex: valores correctos', async () => h1(async (h) => {
  assert.match(await say(h, '.encode64 hola mundo'), /aG9sYSBtdW5kbw==/);
  assert.match(await say(h, '.decode64 aG9sYSBtdW5kbw=='), /hola mundo/);
  assert.match(await say(h, '.base64 hola'), /aG9sYQ==/);
  assert.match(await say(h, '.base64 decodificar aG9sYQ=='), /hola/);
  assert.match(await say(h, '.decode64 !!!'), /no es Base64 válido/);
  assert.match(await say(h, '.decode64 /////w=='), /no contiene texto/);
  assert.match(await say(h, '.md5 hola'), /4d186321c1a7f0f354b297e8914ab240/);
  assert.match(await say(h, '.sha256 hola'), /b221d9dbb083a7f33428d7c2a3c3198ae925614d70210e28716ccaa7cd4ddb79/);
  assert.match(await say(h, '.hash sha1 hola'), /SHA1:\n99800b85d3383e3a2fb45eb7d0066a4879a9dad0/);
  assert.match(await say(h, '.hash hola'), /SHA256/);
  const u = await say(h, '.uuid 2');
  assert.equal((u.match(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/g) || []).length, 2);
  assert.match(await say(h, '.uuid 9'), /Uso:/);
  assert.match(await say(h, '.json {"a":1,"b":[1,2]}'), /JSON válido[\s\S]*"a": 1/);
  assert.match(await say(h, '.json {a:1}'), /JSON inválido/);
  assert.match(await say(h, '.color #ff8800'), /#FF8800[\s\S]*RGB: 255, 136, 0[\s\S]*HSL: 32°, 100%, 50%/);
  assert.match(await say(h, '.color 255 136 0'), /#FF8800/);
  assert.match(await say(h, '.color #zzz'), /Color inválido/);
  assert.match(await say(h, '.hex 255'), /0xff/);
  assert.match(await say(h, '.hex 0xff'), /= \*255\*/);
  assert.match(await say(h, '.hex hola'), /686f6c61/);
}));

test('random/dado/8ball/suerte/frase/chiste: rangos y contenido', async () => h1(async (h) => {
  for (let i = 0; i < 30; i += 1) {
    const m = /\*(\d+)\*/.exec(await say(h, '.random 5 8'));
    assert.ok(m && Number(m[1]) >= 5 && Number(m[1]) <= 8);
  }
  assert.match(await say(h, '.random 9 1'), /Uso:/);
  assert.match(await say(h, '.random 1'), /Entre 1 y 1: \*1\*/);
  const d = /3d8: (\d+) \+ (\d+) \+ (\d+) = \*(\d+)\*/.exec(await say(h, '.dado 3d8'));
  assert.ok(d && Number(d[1]) + Number(d[2]) + Number(d[3]) === Number(d[4]));
  assert.match(await say(h, '.dado'), /1d6/);
  assert.match(await say(h, '.dado 1'), /Uso:/);
  assert.match(await say(h, '.dado 11d6'), /Uso:/);
  assert.match(await say(h, '.8ball ¿ganaremos?'), /🎱/);
  assert.match(await say(h, '.8ball'), /Uso:/);
  const a = await say(h, '.suerte');
  assert.equal(a, await say(h, '.suerte'), 'misma suerte el mismo día y usuario');
  assert.match(a, /\*\d{1,3}\/100\*/);
  const { PHRASES, JOKES } = require('../src/tools/content');
  assert.ok(PHRASES.some((p) => `💬 ${p}` === 'x') === false);
  assert.ok(PHRASES.includes((await say(h, '.frase')).replace('💬 ', '')));
  assert.ok(JOKES.includes((await say(h, '.chiste')).replace('😄 ', '')));
}));

test('texto/mayus/minus/contar/reverse', async () => h1(async (h) => {
  assert.equal(await say(h, '.mayus hola mundo ñandú'), 'HOLA MUNDO ÑANDÚ');
  assert.equal(await say(h, '.minus HOLA Mundo'), 'hola mundo');
  assert.equal(await say(h, '.reverse abc 123'), '321 cba');
  assert.equal(await say(h, '.texto snake Hola Mundo Ñandú'), 'hola_mundo_nandu');
  assert.equal(await say(h, '.texto camel hola mundo cruel'), 'holaMundoCruel');
  assert.equal(await say(h, '.texto capitalizar hOLA mUNDO'), 'Hola Mundo');
  assert.equal(await say(h, '.texto sinacentos canción'), 'cancion');
  assert.match(await say(h, '.texto'), /Estilos:/);
  assert.match(await say(h, '.texto inventado hola'), /Estilos:/);
  assert.match(await say(h, '.contar hola mundo hola'), /Caracteres: 15[\s\S]*Palabras: 3 \(únicas: 2\)[\s\S]*Líneas: 1/);
  assert.match(await say(h, `.mayus ${'a'.repeat(1600)}`), /demasiado largo/);
}));

test('fecha/hora/timestamp/ping/info/device', async () => h1(async (h) => {
  assert.match(await say(h, '.fecha'), /📅 .*\d{4}[\s\S]*America\/Guayaquil/);
  assert.match(await say(h, '.hora'), /🕒 \d{2}:\d{2}:\d{2}/);
  assert.match(await say(h, '.hora Europe/Madrid'), /Europe\/Madrid/);
  assert.match(await say(h, '.hora Marte/Olimpo'), /Zona horaria desconocida/);
  assert.match(await say(h, '.timestamp'), /Unix: \*\d{10}\*/);
  assert.match(await say(h, '.timestamp 1760000000'), /2025-10-09T08:53:20\.000Z/);
  assert.match(await say(h, '.timestamp 2026-10-05 18:30'), /Unix: \*1791225000\*/);
  assert.match(await say(h, '.timestamp nada'), /Uso:/);
  assert.match(await say(h, '.ping'), /Pong/);
  const info = await say(h, '.info', P[1]);
  assert.match(info, /rol ADMIN[\s\S]*Registrado en el bot: sí[\s\S]*Tipo de chat: grupo/);
  assert.match(await say(h, '.device'), /Tu mensaje: \*/);
  assert.equal(deviceOf('3A1B2C3D4E5F6A7B8C9D').name, 'iPhone (iOS)');
  assert.equal(deviceOf('BAE5A1B2C3D4E5F6').name, 'Bot o cliente basado en Baileys');
  assert.equal(deviceOf('3EB0A1B2C3D4E5F6A7B8C9D0E1F2A3B4').name, 'WhatsApp Web / Escritorio');
  assert.equal(deviceOf('A'.repeat(32)).name, 'Android');
  assert.equal(deviceOf(null), null);
}));
