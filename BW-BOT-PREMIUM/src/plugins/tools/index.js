'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { UserError } = require('../../services/users');
const { plain } = require('../../utils/text');
const { isValidTimeZone } = require('../../utils/time');
const { evaluate, formatResult, CalcError } = require('../../tools/calc');
const { convert, units } = require('../../tools/convert');
const { encodeQr, toPng } = require('../../tools/qr');
const { PHRASES, JOKES, EIGHT_BALL } = require('../../tools/content');

const MAX_TEXT = 1500;
const common = { permissions: 'USER', scope: 'any', category: 'tools' };
const usage = (ctx, u) => new UserError('USAGE', `Uso: *${ctx.prefix}${u}*`);
const needText = (ctx, u) => {
  if (!ctx.argText) throw usage(ctx, u);
  if (ctx.argText.length > MAX_TEXT) throw new UserError('TOO_LONG', `El texto es demasiado largo (máximo ${MAX_TEXT} caracteres).`);
  return ctx.argText;
};
// Preserva espacios/saltos originales: ctx.argText ya los colapsa, así que se toma del texto crudo tras el comando.
const rawArg = (ctx) => {
  const m = /^\s*\S+\s?([\s\S]*)$/.exec(ctx.text || '');
  return (m ? m[1] : ctx.argText).trimEnd() || ctx.argText;
};
const randInt = (min, max) => crypto.randomInt(min, max + 1);

function fmtDate(ms, tz, opts) {
  return new Intl.DateTimeFormat('es', { timeZone: tz, ...opts }).format(new Date(ms));
}

function dayHash(user, dayKey, salt) {
  return crypto.createHash('sha256').update(`${user}|${dayKey}|${salt}`).digest().readUInt32BE(0);
}

function hexToRgb(h) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(h);
  if (!m) return null;
  let x = m[1];
  if (x.length === 3) x = [...x].map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16));
}
function rgbToHsl([r, g, b]) {
  const rn = r / 255; const gn = g / 255; const bn = b / 255;
  const max = Math.max(rn, gn, bn); const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0; let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
  }
  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}

const STYLES = {
  capitalizar: (t) => t.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, a, b) => a + b.toUpperCase()),
  snake: (t) => words(t).join('_'),
  kebab: (t) => words(t).join('-'),
  camel: (t) => words(t).map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join(''),
  slug: (t) => words(t).join('-'),
  sinacentos: (t) => t.normalize('NFD').replace(/\p{M}/gu, ''),
  espaciado: (t) => [...t].join(' '),
  alternado: (t) => [...t].map((c, i) => (i % 2 ? c.toUpperCase() : c.toLowerCase())).join(''),
};
function words(t) {
  return t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function deviceOf(id) {
  if (!id) return null;
  if (/^3A[0-9A-F]{18,}$/i.test(id) && id.length <= 22) return { name: 'iPhone (iOS)', why: 'ID que empieza por 3A' };
  if (/^BAE5/i.test(id)) return { name: 'Bot o cliente basado en Baileys', why: 'ID que empieza por BAE5' };
  if (/^3EB0/i.test(id)) return { name: 'WhatsApp Web / Escritorio', why: 'ID que empieza por 3EB0' };
  if (id.length > 21) return { name: 'Android', why: `ID largo (${id.length} caracteres)` };
  return { name: 'WhatsApp Web / Escritorio u otro', why: `ID corto (${id.length} caracteres)` };
}

function build() {
  return [
    {
      name: 'ping',
      aliases: ['p'],
      description: 'Comprueba que el bot responde y estima el retraso entre tu mensaje y su procesamiento.',
      usage: 'ping', example: 'ping', ...common, cooldown: 3,
      async handler(ctx) {
        const delay = ctx.messageTimestampMs ? Math.max(0, Date.now() - ctx.messageTimestampMs) : null;
        return `🏓 *Pong!*${delay !== null ? `\nRetraso mensaje→bot: ~${delay} ms _(WhatsApp marca la hora en segundos, así que es aproximado)_` : ''}`;
      },
    },
    {
      name: 'calculadora',
      aliases: ['calc', 'calcular'],
      description: 'Calculadora segura (sin ejecutar código): + − × ÷ % ^ paréntesis, pi, e y funciones sqrt abs round floor ceil sin cos tan ln log exp.',
      usage: 'calculadora <operación>', example: 'calc (2+3)*4^2', ...common, cooldown: 2,
      async handler(ctx) {
        const expr = needText(ctx, 'calc <operación>');
        try {
          return `🧮 ${plain(expr)} = *${formatResult(evaluate(expr))}*`;
        } catch (err) {
          if (err instanceof CalcError) throw new UserError('CALC', `⚠️ ${err.message}`);
          throw err;
        }
      },
    },
    {
      name: 'convertir',
      aliases: ['convert', 'conv'],
      description: 'Convierte unidades de longitud, masa, volumen, tiempo, velocidad, datos y temperatura. No convierte monedas (no hay tasas en vivo).',
      usage: 'convertir <valor> <unidad origen> <unidad destino>', example: 'convertir 10 km mi', ...common, cooldown: 2,
      async handler(ctx) {
        const [v, from, to0, to1] = ctx.args;
        const to = /^a$/i.test(to0 || '') ? to1 : to0; // "10 km a mi"
        const value = Number(String(v || '').replace(',', '.'));
        if (!v || !from || !to || !Number.isFinite(value)) throw new UserError('USAGE', `Uso: *${ctx.prefix}convertir 10 km mi*\nUnidades:\n${units().join('\n')}`);
        try {
          return `🔁 ${formatResult(value)} ${plain(from)} = *${formatResult(convert(value, from, to))}* ${plain(to)}`;
        } catch (err) {
          throw new UserError('CONVERT', `⚠️ ${err.message}`);
        }
      },
    },
    {
      name: 'fecha',
      aliases: ['date'],
      description: 'Fecha actual en la zona horaria del bot (o en otra zona IANA, por ejemplo America/Bogota).',
      usage: 'fecha [zona]', example: 'fecha', ...common, cooldown: 2,
      async handler(ctx) {
        const tz = ctx.args[0] || ctx.config.timezone;
        if (!isValidTimeZone(tz)) throw new UserError('TZ', `⚠️ Zona horaria desconocida: ${plain(tz)}. Usa nombres como America/Guayaquil.`);
        return `📅 ${fmtDate(Date.now(), tz, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}\n🌎 ${tz}`;
      },
    },
    {
      name: 'hora',
      aliases: ['time'],
      description: 'Hora actual en la zona horaria del bot (o en otra zona IANA).',
      usage: 'hora [zona]', example: 'hora Europe/Madrid', ...common, cooldown: 2,
      async handler(ctx) {
        const tz = ctx.args[0] || ctx.config.timezone;
        if (!isValidTimeZone(tz)) throw new UserError('TZ', `⚠️ Zona horaria desconocida: ${plain(tz)}. Usa nombres como America/Guayaquil.`);
        return `🕒 ${fmtDate(Date.now(), tz, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}\n🌎 ${tz}`;
      },
    },
    {
      name: 'timestamp',
      aliases: ['epoch'],
      description: 'Sin argumentos: la marca de tiempo Unix actual. Con un número: lo convierte a fecha. Con una fecha ISO (2026-10-05 18:30): lo convierte a Unix.',
      usage: 'timestamp [número | fecha]', example: 'timestamp 1760000000', ...common, cooldown: 2,
      async handler(ctx) {
        const tz = ctx.config.timezone;
        const show = (ms) => `${fmtDate(ms, tz, { dateStyle: 'full', timeStyle: 'medium' })} (${tz})\nISO UTC: ${new Date(ms).toISOString()}`;
        if (!ctx.argText) { const n = Date.now(); return `⏱️ Unix: *${Math.floor(n / 1000)}* s · ${n} ms\n${show(n)}`; }
        const a = ctx.args[0];
        if (/^\d{9,13}$/.test(a)) { const ms = a.length >= 12 ? Number(a) : Number(a) * 1000; return `⏱️ ${a}\n${show(ms)}`; }
        const iso = ctx.argText.replace(' ', 'T');
        const ms = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}${iso.includes('T') ? '' : 'T00:00:00'}Z`);
        if (!Number.isFinite(ms)) throw usage(ctx, 'timestamp [número | AAAA-MM-DD HH:MM]');
        return `⏱️ Unix: *${Math.floor(ms / 1000)}*\n${show(ms)}\n_Se interpretó como UTC si no indicaste zona._`;
      },
    },
    {
      name: 'qr',
      aliases: ['codigoqr'],
      description: 'Genera un código QR (imagen) con el texto o enlace indicado (hasta ~200 caracteres).',
      usage: 'qr <texto o enlace>', example: 'qr https://ejemplo.com', ...common, cooldown: 8,
      async handler(ctx) {
        const text = needText(ctx, 'qr <texto>');
        let qr;
        try { qr = encodeQr(rawArg(ctx).slice(0, MAX_TEXT)); } catch (err) { throw new UserError('QR', `⚠️ ${err.message}. Usa un texto de menos de ~200 caracteres.`); }
        const dir = path.join(ctx.config.paths.tmp, 'tools');
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `qr-${crypto.randomBytes(6).toString('hex')}.png`);
        fs.writeFileSync(file, toPng(qr));
        try {
          const out = await ctx.sendMedia({ kind: 'image', file, mimetype: 'image/png', caption: `📷 QR de: ${plain(text).slice(0, 80)}` });
          if (!out.ok) throw new UserError('SEND_FAILED', `⚠️ Generé el QR pero WhatsApp no permitió enviarlo (${plain(out.error || 'error')}).`);
        } finally {
          fs.rmSync(file, { force: true });
        }
        return undefined;
      },
    },
    {
      name: 'base64',
      aliases: ['b64'],
      description: 'Codifica o decodifica Base64: "base64 codificar hola" / "base64 decodificar aG9sYQ==". Sin modo, codifica.',
      usage: 'base64 [codificar|decodificar] <texto>', example: 'base64 hola', ...common, cooldown: 2,
      async handler(ctx) {
        needText(ctx, 'base64 [codificar|decodificar] <texto>');
        const mode = /^(decodificar|decode|decod|d)$/i.test(ctx.args[0]) ? 'd' : /^(codificar|encode|cod|e)$/i.test(ctx.args[0]) ? 'e' : null;
        const text = mode ? ctx.args.slice(1).join(' ') : ctx.argText;
        if (!text) throw usage(ctx, 'base64 [codificar|decodificar] <texto>');
        return mode === 'd' ? decode64(text) : `🔐 Base64:\n${Buffer.from(text, 'utf8').toString('base64')}`;
      },
    },
    {
      name: 'encode64',
      aliases: [],
      description: 'Codifica un texto en Base64.',
      usage: 'encode64 <texto>', example: 'encode64 hola', ...common, cooldown: 2,
      async handler(ctx) { return `🔐 Base64:\n${Buffer.from(needText(ctx, 'encode64 <texto>'), 'utf8').toString('base64')}`; },
    },
    {
      name: 'decode64',
      aliases: [],
      description: 'Decodifica un texto Base64 (solo si el resultado es texto UTF-8 válido).',
      usage: 'decode64 <base64>', example: 'decode64 aG9sYQ==', ...common, cooldown: 2,
      async handler(ctx) { return decode64(needText(ctx, 'decode64 <base64>')); },
    },
    {
      name: 'json',
      aliases: ['jsonformat'],
      description: 'Valida y da formato a un JSON. Si es inválido, indica el error.',
      usage: 'json <JSON>', example: 'json {"a":1}', ...common, cooldown: 3,
      async handler(ctx) {
        needText(ctx, 'json <JSON>');
        const src = rawArg(ctx);
        try {
          const out = JSON.stringify(JSON.parse(src), null, 2);
          return `✅ JSON válido:\n${out.length > 1500 ? `${out.slice(0, 1500)}\n…(recortado)` : out}`;
        } catch (err) {
          return `❌ JSON inválido: ${plain(String(err.message).slice(0, 120))}`;
        }
      },
    },
    {
      name: 'uuid',
      aliases: ['guid'],
      description: 'Genera un UUID v4 aleatorio (hasta 5).',
      usage: 'uuid [cantidad]', example: 'uuid', ...common, cooldown: 3,
      async handler(ctx) {
        const n = ctx.args[0] ? Number(ctx.args[0]) : 1;
        if (!Number.isInteger(n) || n < 1 || n > 5) throw usage(ctx, 'uuid [1-5]');
        return `🆔 ${Array.from({ length: n }, () => crypto.randomUUID()).join('\n')}`;
      },
    },
    {
      name: 'hash',
      aliases: [],
      description: 'Calcula el hash de un texto con md5, sha1, sha256 o sha512 (por defecto sha256).',
      usage: 'hash [algoritmo] <texto>', example: 'hash sha256 hola', ...common, cooldown: 2,
      async handler(ctx) {
        needText(ctx, 'hash [md5|sha1|sha256|sha512] <texto>');
        const algo = ['md5', 'sha1', 'sha256', 'sha512'].includes(ctx.args[0]?.toLowerCase()) ? ctx.args[0].toLowerCase() : 'sha256';
        const text = algo === ctx.args[0]?.toLowerCase() ? ctx.args.slice(1).join(' ') : ctx.argText;
        if (!text) throw usage(ctx, 'hash [algoritmo] <texto>');
        return `#️⃣ ${algo.toUpperCase()}:\n${crypto.createHash(algo).update(text, 'utf8').digest('hex')}`;
      },
    },
    {
      name: 'md5',
      aliases: [],
      description: 'Hash MD5 de un texto (no es seguro para contraseñas; solo para comprobar integridad).',
      usage: 'md5 <texto>', example: 'md5 hola', ...common, cooldown: 2,
      async handler(ctx) { return `#️⃣ MD5:\n${crypto.createHash('md5').update(needText(ctx, 'md5 <texto>'), 'utf8').digest('hex')}`; },
    },
    {
      name: 'sha256',
      aliases: [],
      description: 'Hash SHA-256 de un texto.',
      usage: 'sha256 <texto>', example: 'sha256 hola', ...common, cooldown: 2,
      async handler(ctx) { return `#️⃣ SHA-256:\n${crypto.createHash('sha256').update(needText(ctx, 'sha256 <texto>'), 'utf8').digest('hex')}`; },
    },
    {
      name: 'color',
      aliases: ['colour'],
      description: 'Convierte un color entre HEX, RGB y HSL. Acepta #ff8800 o "255 136 0".',
      usage: 'color <#hex | r g b>', example: 'color #ff8800', ...common, cooldown: 2,
      async handler(ctx) {
        needText(ctx, 'color <#hex | r g b>');
        let rgb = ctx.args.length >= 3 ? null : hexToRgb(ctx.args[0]);
        if (!rgb && ctx.args.length >= 3) {
          const n = ctx.args.slice(0, 3).map((x) => Number(x.replace(/,/g, '')));
          if (n.every((x) => Number.isInteger(x) && x >= 0 && x <= 255)) rgb = n;
        }
        if (!rgb) throw new UserError('COLOR', `⚠️ Color inválido. Usa *${ctx.prefix}color #ff8800* o *${ctx.prefix}color 255 136 0*.`);
        const [h, s, l] = rgbToHsl(rgb);
        return `🎨 HEX: *#${rgb.map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase()}*\nRGB: ${rgb.join(', ')}\nHSL: ${h}°, ${s}%, ${l}%`;
      },
    },
    {
      name: 'hex',
      aliases: [],
      description: 'Número → hexadecimal, 0x… → decimal, o texto → bytes UTF-8 en hexadecimal.',
      usage: 'hex <número | 0x… | texto>', example: 'hex 255', ...common, cooldown: 2,
      async handler(ctx) {
        const a = needText(ctx, 'hex <número | 0x… | texto>');
        if (/^0x[0-9a-f]{1,13}$/i.test(a)) return `🔢 ${a} = *${parseInt(a, 16)}* (decimal)`;
        if (/^\d{1,15}$/.test(a)) return `🔢 ${a} = *0x${Number(a).toString(16)}*`;
        return `🔢 Hex de “${plain(a).slice(0, 40)}”:\n${Buffer.from(a, 'utf8').toString('hex')}`;
      },
    },
    {
      name: 'random',
      aliases: ['aleatorio', 'rand'],
      description: 'Número aleatorio entre dos valores (por defecto 1 y 100), con aleatoriedad criptográfica.',
      usage: 'random [mín] [máx]', example: 'random 1 10', ...common, cooldown: 2,
      async handler(ctx) {
        let [a, b] = ctx.args.map(Number);
        if (ctx.args.length === 0) { a = 1; b = 100; } else if (ctx.args.length === 1) { b = a; a = 1; }
        if (![a, b].every((x) => Number.isInteger(x) && Math.abs(x) <= 1e9) || a > b) throw usage(ctx, 'random [mín] [máx] (enteros, mín ≤ máx)');
        return `🎲 Entre ${a} y ${b}: *${randInt(a, b)}*`;
      },
    },
    {
      name: 'dado',
      aliases: [],
      description: 'Lanza dados: "dado" (1d6), "dado 20" (1d20) o "dado 3d8" (hasta 10 dados de hasta 1000 caras).',
      usage: 'dado [caras | NdC]', example: 'dado 2d6', ...common, cooldown: 2,
      async handler(ctx) {
        const a = ctx.args[0] || '6';
        const m = /^(\d{1,2})?d?(\d{1,4})$/i.exec(a) || null;
        const n = m && /d/i.test(a) && m[1] ? Number(m[1]) : 1;
        const sides = m ? Number(m[2]) : 0;
        if (!m || n < 1 || n > 10 || sides < 2 || sides > 1000) throw usage(ctx, 'dado [caras | NdC]  (1-10 dados, 2-1000 caras)');
        const rolls = Array.from({ length: n }, () => randInt(1, sides));
        return `🎲 ${n}d${sides}: ${rolls.join(' + ')}${n > 1 ? ` = *${rolls.reduce((x, y) => x + y, 0)}*` : ''}`;
      },
    },
    {
      name: '8ball',
      aliases: ['bola8', 'bola'],
      description: 'La bola mágica responde a una pregunta de sí/no (solo diversión).',
      usage: '8ball <pregunta>', example: '8ball ¿ganaremos hoy?', ...common, cooldown: 3,
      async handler(ctx) {
        const q = needText(ctx, '8ball <pregunta>');
        return `🎱 ${plain(q).slice(0, 100)}\n*${EIGHT_BALL[randInt(0, EIGHT_BALL.length - 1)]}*`;
      },
    },
    {
      name: 'suerte',
      aliases: ['luck'],
      description: 'Tu suerte del día (0-100). Es un juego: se calcula a partir de tu usuario y la fecha, no predice nada real.',
      usage: 'suerte', example: 'suerte', ...common, cooldown: 3,
      async handler(ctx) {
        const day = fmtDate(Date.now(), ctx.config.timezone, { year: 'numeric', month: '2-digit', day: '2-digit' });
        const v = dayHash(ctx.sender, day, 'suerte') % 101;
        const msg = v >= 85 ? '¡Día para arriesgar!' : v >= 60 ? 'Buen día para jugar.' : v >= 35 ? 'Día tranquilo.' : 'Mejor practica con calma hoy.';
        return `🍀 Tu suerte de hoy: *${v}/100*\n${msg}\n_Es solo un juego, no predice nada._`;
      },
    },
    {
      name: 'frase',
      aliases: ['quote'],
      description: 'Una frase motivadora de gaming (texto original del bot).',
      usage: 'frase', example: 'frase', ...common, cooldown: 3,
      async handler() { return `💬 ${PHRASES[randInt(0, PHRASES.length - 1)]}`; },
    },
    {
      name: 'chiste',
      aliases: ['joke'],
      description: 'Un chiste corto y sano (texto original del bot).',
      usage: 'chiste', example: 'chiste', ...common, cooldown: 3,
      async handler() { return `😄 ${JOKES[randInt(0, JOKES.length - 1)]}`; },
    },
    {
      name: 'texto',
      aliases: ['estilo'],
      description: 'Transforma un texto: capitalizar, snake, kebab, camel, slug, sinacentos, espaciado, alternado.',
      usage: 'texto <estilo> <texto>', example: 'texto snake Hola Mundo', ...common, cooldown: 2,
      async handler(ctx) {
        const style = (ctx.args[0] || '').toLowerCase();
        if (!STYLES[style]) throw new UserError('USAGE', `Uso: *${ctx.prefix}texto <estilo> <texto>*\nEstilos: ${Object.keys(STYLES).join(', ')}`);
        const text = rawArg(ctx).replace(/^\S+\s?/, '');
        if (!text) throw usage(ctx, 'texto <estilo> <texto>');
        if (text.length > MAX_TEXT) throw new UserError('TOO_LONG', `El texto es demasiado largo (máximo ${MAX_TEXT} caracteres).`);
        return STYLES[style](text) || '⚠️ El resultado quedó vacío.';
      },
    },
    {
      name: 'mayus',
      aliases: ['upper'],
      description: 'Convierte un texto a MAYÚSCULAS.',
      usage: 'mayus <texto>', example: 'mayus hola', ...common, cooldown: 2,
      async handler(ctx) { needText(ctx, 'mayus <texto>'); return rawArg(ctx).toLocaleUpperCase('es'); },
    },
    {
      name: 'minus',
      aliases: ['lower'],
      description: 'Convierte un texto a minúsculas.',
      usage: 'minus <texto>', example: 'minus HOLA', ...common, cooldown: 2,
      async handler(ctx) { needText(ctx, 'minus <texto>'); return rawArg(ctx).toLocaleLowerCase('es'); },
    },
    {
      name: 'contar',
      aliases: ['count'],
      description: 'Cuenta caracteres, letras, dígitos, palabras y líneas de un texto.',
      usage: 'contar <texto>', example: 'contar hola mundo', ...common, cooldown: 2,
      async handler(ctx) {
        needText(ctx, 'contar <texto>');
        const t = rawArg(ctx);
        const chars = [...t];
        const ws = t.split(/\s+/).filter(Boolean);
        return ['🔢 *Conteo*', `Caracteres: ${chars.length} (sin espacios: ${chars.filter((c) => !/\s/.test(c)).length})`, `Letras: ${(t.match(/\p{L}/gu) || []).length} · Dígitos: ${(t.match(/\d/g) || []).length}`, `Palabras: ${ws.length} (únicas: ${new Set(ws.map((w) => w.toLowerCase())).size})`, `Líneas: ${t.split(/\r?\n/).length}`].join('\n');
      },
    },
    {
      name: 'reverse',
      aliases: ['invertir'],
      description: 'Invierte un texto (de atrás hacia adelante).',
      usage: 'reverse <texto>', example: 'reverse hola', ...common, cooldown: 2,
      async handler(ctx) { needText(ctx, 'reverse <texto>'); return [...rawArg(ctx)].reverse().join(''); },
    },
    {
      name: 'info',
      aliases: ['whoami', 'chatinfo'],
      description: 'Información real de este chat y de tu usuario (rol en el bot, registro, tipo de chat y datos del grupo).',
      usage: 'info', example: 'info', ...common, cooldown: 5,
      async handler(ctx) {
        const role = (await ctx.getRole()).role;
        const lines = ['ℹ️ *Información*', `👤 Tú: ${plain(ctx.pushName || (ctx.user && ctx.user.name) || 'sin nombre')} · rol ${role}`, `📝 Registrado en el bot: ${ctx.user ? 'sí' : 'no'}`];
        if (ctx.isGroup) {
          lines.push('💬 Tipo de chat: grupo');
          try {
            const meta = await ctx.services.wa.groupMetadata(ctx.chatJid);
            if (meta?.subject) lines.push(`👥 Grupo: ${plain(meta.subject)}`);
            if (Array.isArray(meta?.participants)) lines.push(`🔢 Participantes: ${meta.participants.length}`);
          } catch { lines.push('(No pude consultar los datos del grupo ahora.)'); }
        } else lines.push('💬 Tipo de chat: privado');
        lines.push(`⚙️ Prefijo: ${ctx.prefix} · Zona horaria del bot: ${ctx.config.timezone}`);
        return lines.join('\n');
      },
    },
    {
      name: 'device',
      aliases: ['dispositivo'],
      description: 'Estima el tipo de dispositivo (Android, iOS, Web/Escritorio, bot) a partir del ID del mensaje. Responde a un mensaje para analizar el suyo. Es una heurística, no un dato oficial.',
      usage: 'device (respondiendo a un mensaje)', example: 'device', ...common, cooldown: 5,
      async handler(ctx) {
        const id = ctx.quotedId || ctx.messageId;
        const d = deviceOf(id);
        if (!d) throw new UserError('DEVICE', 'ℹ️ No tengo el ID del mensaje.');
        return `📱 ${ctx.quotedId ? 'Mensaje citado' : 'Tu mensaje'}: *${d.name}*\n_Estimación heurística (${d.why}); WhatsApp no publica este dato oficialmente._`;
      },
    },
  ];
}

function decode64(text) {
  const clean = text.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(clean) || clean.length % 4 === 1) throw new UserError('B64', '⚠️ Eso no es Base64 válido.');
  const buf = Buffer.from(clean.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const out = buf.toString('utf8');
  if (out.includes('�') || /[\u0000-\u0008\u000E-\u001F]/.test(out)) throw new UserError('B64', '⚠️ El Base64 es válido pero no contiene texto UTF-8 legible.');
  return `🔓 Texto:\n${out.length > 1500 ? `${out.slice(0, 1500)}…` : out}`;
}

module.exports = { name: 'tools', build, deviceOf, hexToRgb, rgbToHsl };
