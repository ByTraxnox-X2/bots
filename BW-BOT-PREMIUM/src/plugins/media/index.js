'use strict';

const { UserError } = require('../../services/users');
const { plain } = require('../../utils/text');
const { formatNumber } = require('../../utils/validators');
const { isUrl } = require('../../media/service');

const clock = (s) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

/** Ficha del elemento con SOLO los datos que entregó el proveedor. */
function cardLines(item, icon = '🎵') {
  const l = [];
  if (item.title) l.push(`${icon} *${plain(item.title)}*`);
  if (item.author) l.push(`👤 ${plain(item.author)}`);
  if (item.duration !== undefined) l.push(`⏱️ ${clock(item.duration)}`);
  if (item.views !== undefined) l.push(`👁️ ${formatNumber(item.views)} vistas`);
  if (item.date) l.push(`📅 ${plain(item.date)}`);
  if (item.url) l.push(`🔗 ${item.url}`);
  if (!l.length) l.push(`${icon} Elemento sin datos del proveedor`);
  return l;
}

function describeError(err, ctx) {
  const p = ctx.prefix;
  switch (err && err.kind) {
    case 'NOT_CONFIGURED': return `ℹ️ La función de música/video no está configurada en este bot (el administrador debe definir MEDIA_PROVIDER_1_URL o PLAY_API_URLS en .env).`;
    case 'NOT_FOUND': return '🔎 No encontré resultados para esa búsqueda.';
    case 'TOO_LONG': return `⏱️ Ese contenido dura más del máximo permitido (${Math.round(ctx.config.play.maxDurationSec / 60)} min).`;
    case 'TOO_LARGE': return `📦 El archivo supera el tamaño máximo permitido (${Math.round(ctx.config.play.maxFileSize / 1048576)} MB).`;
    case 'UNAVAILABLE': return '🚫 El proveedor no permite obtener ese contenido (no está disponible para descarga).';
    case 'BAD_TYPE': return '⚠️ El proveedor entregó un archivo que no es un audio/video válido, así que no lo envié.';
    case 'UNSAFE': return '⚠️ El proveedor apuntó a una dirección no permitida; no descargué nada.';
    case 'QUEUE_FULL': return '⏳ Hay muchas descargas en curso. Inténtalo en un minuto.';
    case 'USER_BUSY': return '⏳ Ya tienes una descarga en curso. Espera a que termine.';
    case 'TIMEOUT': return '⏱️ La descarga tardó demasiado y se canceló.';
    case 'RATE_LIMITED': return '⏳ El proveedor está limitando las consultas. Inténtalo en un momento.';
    case 'INVALID_RESPONSE': return '⚠️ El proveedor respondió con datos inválidos.';
    default: return `⚠️ Los proveedores no respondieron ahora mismo. Inténtalo de nuevo más tarde (*${p}apistatus* muestra el estado).`;
  }
}

/** Ejecuta fn() convirtiendo errores de medios en mensajes claros (UserError), sin ocultar los errores inesperados. */
async function guarded(ctx, fn) {
  try {
    return await fn();
  } catch (err) {
    if (err && err.name === 'MediaError') throw new UserError('MEDIA_' + err.kind, describeError(err, ctx));
    throw err;
  }
}

function needSearch(ctx) {
  const { media } = ctx.services;
  if (!media.canSearch) throw new UserError('NOT_CONFIGURED', describeError({ kind: 'NOT_CONFIGURED' }, ctx));
  return media;
}

/** Resuelve el elemento a usar: N (de la lista actual), URL, texto (búsqueda) o el seleccionado. */
async function resolveItem(ctx, { type = 'all', allowSearch = true } = {}) {
  const { media } = ctx.services;
  const arg = ctx.argText.trim();
  if (!arg) {
    const it = media.pick(ctx.chatJid, ctx.sender);
    if (!it) throw new UserError('NO_CONTEXT', `ℹ️ No hay un elemento seleccionado (o ya expiró). Busca primero con *${ctx.prefix}play canción o video*.`);
    return it;
  }
  if (/^\d{1,2}$/.test(arg)) {
    const it = media.pick(ctx.chatJid, ctx.sender, Number(arg));
    if (!it) throw new UserError('NO_CONTEXT', `ℹ️ No tengo el resultado ${arg}: la lista expiró o no existe. Busca de nuevo con *${ctx.prefix}buscar*.`);
    return it;
  }
  if (isUrl(arg)) {
    const item = { url: arg };
    media.setContext(ctx.chatJid, ctx.sender, { query: arg, items: [item], selected: 0 });
    return item;
  }
  if (!allowSearch) throw new UserError('USAGE', 'Escribe el número del resultado (por ejemplo 2).');
  needSearch(ctx);
  const out = await guarded(ctx, () => media.search(arg, { type, limit: ctx.config.play.results }));
  media.setContext(ctx.chatJid, ctx.sender, { query: arg, items: out.items, selected: 0 });
  return out.items[0];
}

function safeName(item, ext) {
  const base = String(item.title || 'archivo').replace(/[^\p{L}\p{N} _.-]+/gu, '').trim().slice(0, 60) || 'archivo';
  return `${base}.${ext}`;
}

async function download(ctx, kind) {
  const { media } = ctx.services;
  if (!media.canDownload) throw new UserError('NOT_CONFIGURED', describeError({ kind: 'NOT_CONFIGURED' }, ctx));
  const item = await resolveItem(ctx, { type: kind });
  const icon = kind === 'audio' ? '🎵' : '🎬';
  await ctx.reply(`⏳ Preparando el ${kind}${item.title ? ` de *${plain(item.title).slice(0, 80)}*` : ''}…`);
  let res;
  try {
    res = await guarded(ctx, () => media.prepare(item, kind, { userKey: ctx.sender }));
    const sendKind = media.sendKind(kind, res.size);
    const out = await ctx.sendMedia({ kind: sendKind, file: res.file, mimetype: res.mime, fileName: safeName(item, res.ext), caption: item.title ? `${icon} ${plain(item.title)}${item.author ? ` — ${plain(item.author)}` : ''}` : '' });
    if (!out.ok) {
      throw new UserError('SEND_FAILED', `⚠️ No pude enviar el archivo por WhatsApp (${plain(out.error || 'error')}).`);
    }
  } finally {
    media.release(res);
  }
  return undefined;
}

function listText(title, items, ctx) {
  return [title, ...items.map((it, i) => `${i + 1}. *${plain(it.title)}*${it.author ? ` — ${plain(it.author)}` : ''}${it.duration !== undefined ? ` (${clock(it.duration)})` : ''}`)].join('\n');
}

function listActions(items, ctx) {
  return items.slice(0, 5).map((it, i) => ({ label: `${i + 1}. ${plain(it.title).slice(0, 28)}`, command: `${ctx.prefix}play ${i + 1}` }));
}

async function searchCommand(ctx, type, label) {
  const media = needSearch(ctx);
  if (!ctx.argText) throw new UserError('USAGE', `Uso: *${ctx.prefix}${ctx.command.name} texto a buscar*`);
  const out = await guarded(ctx, () => media.search(ctx.argText, { type, limit: ctx.config.play.results }));
  media.setContext(ctx.chatJid, ctx.sender, { query: ctx.argText, items: out.items });
  return { text: listText(`🔎 *${label}* para “${plain(ctx.argText).slice(0, 60)}”${out.cached ? ' _(caché)_' : ''}`, out.items, ctx) + `\n\nElige con *${ctx.prefix}play N*`, actions: listActions(out.items, ctx) };
}

const common = { permissions: 'USER', scope: 'any' };

function build() {
  return [
    {
      name: 'play',
      aliases: ['reproducir'],
      description: 'Busca una canción o video, muestra sus datos reales y ofrece descargar el audio o el video. También acepta un enlace o el número de un resultado anterior.',
      usage: 'play <búsqueda | enlace | N>',
      example: 'play nombre de la canción',
      category: 'play',
      ...common,
      cooldown: 8,
      async handler(ctx) {
        const { media } = ctx.services;
        if (!ctx.argText) throw new UserError('USAGE', `Uso: *${ctx.prefix}play canción o video*\nTambién: *${ctx.prefix}play N* (elige un resultado de ${ctx.prefix}buscar).`);
        let item;
        let more = [];
        let cachedNote = '';
        if (/^\d{1,2}$/.test(ctx.argText.trim()) || isUrl(ctx.argText.trim())) {
          item = await resolveItem(ctx, { allowSearch: false });
          const c = media.context(ctx.chatJid, ctx.sender);
          more = c ? c.items.filter((x) => x !== item) : [];
        } else {
          needSearch(ctx);
          const out = await guarded(ctx, () => media.search(ctx.argText, { type: 'all', limit: ctx.config.play.results }));
          media.setContext(ctx.chatJid, ctx.sender, { query: ctx.argText, items: out.items, selected: 0 });
          item = out.items[0];
          more = out.items.slice(1);
          cachedNote = out.cached ? ' _(caché)_' : '';
        }
        const lines = [...cardLines(item), cachedNote].filter(Boolean);
        if (more.length) {
          const c = media.context(ctx.chatJid, ctx.sender);
          lines.push('', '📋 Otros resultados:', ...more.slice(0, 4).map((it) => `${c.items.indexOf(it) + 1}. ${plain(it.title || it.url).slice(0, 60)}`), `_Elige otro con ${ctx.prefix}play N_`);
        }
        const actions = [];
        if (media.canDownload) actions.push({ label: '🎵 AUDIO', command: `${ctx.prefix}playaudio` }, { label: '🎬 VIDEO', command: `${ctx.prefix}playvideo` });
        if (item.url) actions.push({ label: '🔗 ABRIR', command: `${ctx.prefix}abrir` });
        actions.push({ label: '❌ CANCELAR', command: `${ctx.prefix}playcancelar` });
        if (!media.canDownload) lines.push('', 'ℹ️ Este bot no tiene proveedores de descarga configurados: solo puedo mostrar la información.');

        // Miniatura real del proveedor (si la dio y se pudo bajar); si no, solo texto.
        if (item.thumbnail) {
          let thumb = null;
          try {
            thumb = await media.thumbnail(item);
            const out = await ctx.sendMedia({ kind: 'image', file: thumb.file, mimetype: thumb.mime, caption: lines.join('\n'), actions });
            if (out.ok) return undefined;
          } catch {
            /* sin miniatura: se envía el texto */
          } finally {
            media.release(thumb);
          }
        }
        return { text: lines.join('\n'), actions };
      },
    },
    {
      name: 'playaudio',
      aliases: ['audio', 'mp3'],
      description: 'Descarga y envía el AUDIO del resultado elegido (o de una búsqueda/enlace/número) si el proveedor lo permite.',
      usage: 'playaudio [búsqueda | enlace | N]',
      example: 'playaudio 2',
      category: 'play',
      ...common,
      cooldown: 15,
      handler: (ctx) => download(ctx, 'audio'),
    },
    {
      name: 'playvideo',
      aliases: ['video', 'mp4'],
      description: 'Descarga y envía el VIDEO del resultado elegido (o de una búsqueda/enlace/número) si el proveedor lo permite.',
      usage: 'playvideo [búsqueda | enlace | N]',
      example: 'playvideo 1',
      category: 'play',
      ...common,
      cooldown: 20,
      handler: (ctx) => download(ctx, 'video'),
    },
    {
      name: 'buscar',
      aliases: ['search'],
      description: 'Busca canciones y videos y lista los resultados reales del proveedor.',
      usage: 'buscar <texto>',
      example: 'buscar nombre de la canción',
      category: 'play',
      ...common,
      cooldown: 6,
      handler: (ctx) => searchCommand(ctx, 'all', 'Resultados'),
    },
    {
      name: 'buscarvideo',
      aliases: ['searchvideo'],
      description: 'Busca solo videos.',
      usage: 'buscarvideo <texto>',
      example: 'buscarvideo tutorial',
      category: 'play',
      ...common,
      cooldown: 6,
      handler: (ctx) => searchCommand(ctx, 'video', 'Videos'),
    },
    {
      name: 'buscarmusica',
      aliases: ['searchmusic'],
      description: 'Busca solo música (audio).',
      usage: 'buscarmusica <texto>',
      example: 'buscarmusica nombre de la canción',
      category: 'play',
      ...common,
      cooldown: 6,
      handler: (ctx) => searchCommand(ctx, 'audio', 'Música'),
    },
    {
      name: 'infoaudio',
      aliases: [],
      description: 'Muestra los datos del resultado elegido y comprueba si su AUDIO se puede descargar (sin descargarlo).',
      usage: 'infoaudio [N]',
      example: 'infoaudio 1',
      category: 'play',
      ...common,
      cooldown: 8,
      async handler(ctx) { return info(ctx, 'audio'); },
    },
    {
      name: 'infovideo',
      aliases: [],
      description: 'Muestra los datos del resultado elegido y comprueba si su VIDEO se puede descargar (sin descargarlo).',
      usage: 'infovideo [N]',
      example: 'infovideo 1',
      category: 'play',
      ...common,
      cooldown: 8,
      async handler(ctx) { return info(ctx, 'video'); },
    },
    {
      name: 'miniatura',
      aliases: ['thumbnail', 'thumb'],
      description: 'Envía la miniatura del resultado elegido, solo si el proveedor entregó una.',
      usage: 'miniatura [N]',
      example: 'miniatura 1',
      category: 'play',
      ...common,
      cooldown: 8,
      async handler(ctx) {
        const { media } = ctx.services;
        const item = await resolveItem(ctx, { allowSearch: false });
        if (!item.thumbnail) return 'ℹ️ El proveedor no entregó miniatura para este elemento.';
        let thumb;
        try {
          thumb = await guarded(ctx, () => media.thumbnail(item));
          const out = await ctx.sendMedia({ kind: 'image', file: thumb.file, mimetype: thumb.mime, caption: item.title ? `🖼️ ${plain(item.title)}` : '' });
          if (!out.ok) throw new UserError('SEND_FAILED', `⚠️ No pude enviar la imagen por WhatsApp (${plain(out.error || 'error')}).`);
        } finally {
          media.release(thumb);
        }
        return undefined;
      },
    },
    {
      name: 'abrir',
      aliases: ['open'],
      description: 'Muestra el enlace real del elemento elegido.',
      usage: 'abrir [N]',
      example: 'abrir',
      category: 'play',
      ...common,
      cooldown: 3,
      async handler(ctx) {
        const item = await resolveItem(ctx, { allowSearch: false });
        return item.url ? `🔗 ${item.url}` : 'ℹ️ El proveedor no entregó un enlace para este elemento.';
      },
    },
    {
      name: 'playcancelar',
      aliases: ['playcancel'],
      description: 'Cancela la selección actual de .play (los botones asociados dejan de servir).',
      usage: 'playcancelar',
      example: 'playcancelar',
      category: 'play',
      ...common,
      cooldown: 2,
      async handler(ctx) {
        const had = ctx.services.media.clearContext(ctx.chatJid, ctx.sender);
        return had ? '❌ Selección cancelada.' : 'ℹ️ No había ninguna selección activa.';
      },
    },
  ];
}

async function info(ctx, kind) {
  const { media } = ctx.services;
  const item = await resolveItem(ctx, { allowSearch: false });
  const lines = cardLines(item, kind === 'audio' ? '🎵' : '🎬');
  if (!media.canDownload) lines.push('', 'ℹ️ No hay proveedores de descarga configurados.');
  else {
    const av = await media.availability(item, kind);
    if (av.available) {
      const extra = [av.size ? `${(av.size / 1048576).toFixed(1)} MB` : null, av.mime || null, av.cached ? 'ya en caché' : null].filter(Boolean).join(' · ');
      lines.push('', `✅ ${kind === 'audio' ? 'Audio' : 'Video'} disponible${extra ? ` (${extra})` : ''}`);
    } else {
      const reasons = { TOO_LONG: 'dura más del máximo permitido', TOO_LARGE: 'supera el tamaño máximo', UNAVAILABLE: 'el proveedor no permite descargarlo', BAD_TYPE: 'el proveedor no entrega un archivo válido', NOT_CONFIGURED: 'sin proveedores de descarga' };
      lines.push('', `❌ No disponible: ${reasons[av.reason] || 'los proveedores no respondieron'}`);
    }
  }
  return lines.join('\n');
}

module.exports = { name: 'media', build, cardLines, describeError, clock };
