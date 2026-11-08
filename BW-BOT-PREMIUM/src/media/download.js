'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { MediaError } = require('./provider');
const { assertPublicUrl, UnsafeUrlError } = require('./net');

const RULES = {
  audio: { mime: /^audio\/(mpeg|mp3|mp4|x-m4a|m4a|aac|ogg|opus|webm|wav|x-wav|flac|x-flac)\b/, exts: ['mp3', 'm4a', 'aac', 'ogg', 'opus', 'weba', 'wav', 'flac', 'mp4', 'webm'], sniff: ['mp3', 'mp4', 'ogg', 'wav', 'webm', 'flac', 'aac'] },
  video: { mime: /^video\/(mp4|webm|3gpp|quicktime)\b/, exts: ['mp4', 'webm', '3gp', 'mov'], sniff: ['mp4', 'webm'] },
  image: { mime: /^image\/(jpeg|png|webp|gif)\b/, exts: ['jpg', 'jpeg', 'png', 'webp', 'gif'], sniff: ['jpg', 'png', 'webp', 'gif'] },
};

const OUT = {
  mp3: { audio: ['mp3', 'audio/mpeg'] },
  aac: { audio: ['aac', 'audio/aac'] },
  ogg: { audio: ['ogg', 'audio/ogg'] },
  wav: { audio: ['wav', 'audio/wav'] },
  flac: { audio: ['flac', 'audio/flac'] },
  mp4: { audio: ['m4a', 'audio/mp4'], video: ['mp4', 'video/mp4'] },
  webm: { audio: ['webm', 'audio/webm'], video: ['webm', 'video/webm'] },
  jpg: { image: ['jpg', 'image/jpeg'] },
  png: { image: ['png', 'image/png'] },
  webp: { image: ['webp', 'image/webp'] },
  gif: { image: ['gif', 'image/gif'] },
};

/** Tipo real del archivo según sus primeros bytes (no se confía en la extensión ni en el encabezado). */
function sniff(buf) {
  if (!buf || buf.length < 4) return null;
  const s4 = buf.subarray(0, 4).toString('latin1');
  if (s4 === 'OggS') return 'ogg';
  if (s4 === 'fLaC') return 'flac';
  if (s4 === 'GIF8') return 'gif';
  if (buf.subarray(0, 3).toString('latin1') === 'ID3') return 'mp3';
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return (buf[1] & 0xf6) === 0xf0 ? 'aac' : 'mp3';
  if (buf.length >= 8 && buf.subarray(4, 8).toString('latin1') === 'ftyp') return 'mp4';
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'webm';
  if (buf[0] === 0x89 && s4.slice(1) === 'PNG') return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (s4 === 'RIFF' && buf.length >= 12) {
    const t = buf.subarray(8, 12).toString('latin1');
    if (t === 'WAVE') return 'wav';
    if (t === 'WEBP') return 'webp';
  }
  return null;
}

function extOf(urlStr, disposition) {
  const fromName = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition || '')?.[1];
  const name = fromName || (() => { try { return new URL(urlStr).pathname; } catch { return ''; } })();
  const m = /\.([a-z0-9]{2,5})$/i.exec(name);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Descargas seguras: solo URLs públicas (con redirecciones comprobadas), valida MIME + extensión + tamaño
 * antes y durante la descarga, comprueba la firma real del archivo y borra todo rastro si algo falla.
 */
class DownloadManager {
  constructor({ config, fetchImpl = globalThis.fetch, allowPrivate = false, lookup }) {
    this.cfg = config.play;
    this.fetch = fetchImpl;
    this.allowPrivate = allowPrivate;
    this.lookup = lookup;
  }

  async _get(url, { signal, headers = {} } = {}) {
    let current = url;
    for (let hop = 0; hop <= 3; hop++) {
      try {
        await assertPublicUrl(current, { allowPrivate: this.allowPrivate, lookup: this.lookup });
      } catch (err) {
        if (err instanceof UnsafeUrlError) throw new MediaError('UNSAFE', err.message);
        throw err;
      }
      let res;
      try {
        res = await this.fetch(current, { signal, redirect: 'manual', headers: { 'user-agent': 'BW-BOT-PREMIUM', ...headers } });
      } catch (err) {
        if (err?.name === 'AbortError') throw new MediaError('TIMEOUT', 'tiempo de espera agotado');
        throw new MediaError('API_DOWN', String(err?.code || err?.message || 'error de red').slice(0, 80));
      }
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const loc = res.headers.get('location');
        try { await res.body?.cancel?.(); } catch { /* ignorar */ }
        if (!loc) throw new MediaError('INVALID_RESPONSE', 'redirección sin destino');
        current = new URL(loc, current).toString();
        continue;
      }
      return { res, finalUrl: current };
    }
    throw new MediaError('INVALID_RESPONSE', 'demasiadas redirecciones');
  }

  /** Valida estado, tamaño declarado, MIME y extensión a partir de los encabezados. */
  _checkHeaders(res, finalUrl, kind, maxBytes) {
    const rules = RULES[kind];
    if (res.status === 404) throw new MediaError('NOT_FOUND', 'el archivo ya no existe');
    if (res.status === 429) throw new MediaError('RATE_LIMITED', 'HTTP 429');
    if (res.status >= 500) throw new MediaError('API_DOWN', `HTTP ${res.status}`);
    if (res.status !== 200 && res.status !== 206) throw new MediaError('UNAVAILABLE', `HTTP ${res.status}`);
    const size = Number(res.headers.get('content-length'));
    if (Number.isFinite(size) && size > maxBytes) throw new MediaError('TOO_LARGE', `${Math.round(size / 1048576)} MB supera el límite de ${Math.round(maxBytes / 1048576)} MB`);
    const mime = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const ext = extOf(finalUrl, res.headers.get('content-disposition'));
    const generic = !mime || mime === 'application/octet-stream' || mime === 'binary/octet-stream';
    if (!generic && !rules.mime.test(mime)) throw new MediaError('BAD_TYPE', `el tipo ${mime} no es válido para ${kind}`);
    if (generic && ext && !rules.exts.includes(ext)) throw new MediaError('BAD_TYPE', `la extensión .${ext} no es válida para ${kind}`);
    return { mime, ext, size: Number.isFinite(size) && size > 0 ? size : null };
  }

  /** Disponibilidad: ¿el archivo existe y cumple tipo y tamaño? No descarga el cuerpo. */
  async probe(url, kind, { signal, maxBytes = this.cfg.maxFileSize } = {}) {
    const { res, finalUrl } = await this._get(url, { signal });
    try {
      return this._checkHeaders(res, finalUrl, kind, maxBytes);
    } finally {
      try { await res.body?.cancel?.(); } catch { /* ignorar */ }
    }
  }

  /** Descarga a `dir`. Devuelve { file, size, mime, ext }. Cualquier fallo borra el archivo parcial. */
  async download(url, kind, { dir, signal, maxBytes = this.cfg.maxFileSize } = {}) {
    fs.mkdirSync(dir, { recursive: true });
    const { res, finalUrl } = await this._get(url, { signal });
    const part = path.join(dir, `${crypto.randomBytes(8).toString('hex')}.part`);
    try {
      this._checkHeaders(res, finalUrl, kind, maxBytes);
      if (!res.body) throw new MediaError('INVALID_RESPONSE', 'respuesta sin contenido');
      let total = 0;
      let head = Buffer.alloc(0);
      const counter = new (require('node:stream').Transform)({
        transform(chunk, _enc, cb) {
          total += chunk.length;
          if (head.length < 16) head = Buffer.concat([head, chunk]).subarray(0, 16);
          if (total > maxBytes) return cb(new MediaError('TOO_LARGE', `supera el límite de ${Math.round(maxBytes / 1048576)} MB`));
          cb(null, chunk);
        },
      });
      try {
        await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(part), signal ? { signal } : {});
      } catch (err) {
        if (err instanceof MediaError) throw err;
        if (err?.name === 'AbortError' || signal?.aborted) throw new MediaError('TIMEOUT', 'tiempo de espera agotado');
        throw new MediaError('API_DOWN', String(err?.code || err?.message || 'descarga interrumpida').slice(0, 80));
      }
      if (total === 0) throw new MediaError('INVALID_RESPONSE', 'archivo vacío');
      const real = sniff(head);
      if (!real || !RULES[kind].sniff.includes(real) || !OUT[real][kind]) throw new MediaError('BAD_TYPE', 'el contenido descargado no es un archivo de ' + kind + ' válido');
      const [ext, mime] = OUT[real][kind];
      const file = part.replace(/\.part$/, `.${ext}`);
      fs.renameSync(part, file);
      return { file, size: total, mime, ext };
    } catch (err) {
      try { fs.rmSync(part, { force: true }); } catch { /* ignorar */ }
      throw err;
    }
  }
}

module.exports = { DownloadManager, sniff, RULES };
