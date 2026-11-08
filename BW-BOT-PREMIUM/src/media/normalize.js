'use strict';

/**
 * Normalización de respuestas de proveedores multimedia. Regla de oro: SOLO se devuelven campos que el proveedor
 * entregó realmente. Nada se inventa ni se completa (ni título, ni autor, ni duración, ni vistas, ni fecha, ni URL).
 */

const ARRAY_KEYS = ['results', 'items', 'data', 'videos', 'result', 'entries', 'response', 'tracks', 'songs', 'list'];

const pickStr = (obj, keys) => {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const inner = v.name || v.title || v.url;
      if (typeof inner === 'string' && inner.trim()) return inner.trim();
    }
  }
  return null;
};

const pickNum = (obj, keys) => {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
    if (typeof v === 'string' && /^\d[\d.,]*$/.test(v.trim())) {
      const n = Number(v.replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.'));
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
};

/** "3:45" | "1:02:03" | 225 → segundos. null si no se puede interpretar. */
function parseDuration(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.round(value);
  if (typeof value !== 'string') return null;
  const t = value.trim();
  if (/^\d+$/.test(t)) return Number(t);
  const m = t.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

function pickDuration(obj) {
  for (const k of ['duration', 'durationSeconds', 'lengthSeconds', 'seconds', 'timestamp', 'length']) {
    const v = obj?.[k];
    const d = parseDuration(v && typeof v === 'object' ? v.seconds ?? v.timestamp : v);
    if (d !== null) return d;
  }
  return null;
}

function pickThumb(obj) {
  for (const k of ['thumbnail', 'thumb', 'image', 'cover', 'thumbnailUrl', 'thumbnail_url', 'poster']) {
    const v = obj?.[k];
    if (typeof v === 'string' && /^https?:\/\//i.test(v)) return v;
    if (v && typeof v === 'object' && typeof v.url === 'string' && /^https?:\/\//i.test(v.url)) return v.url;
  }
  const arr = obj?.thumbnails;
  if (Array.isArray(arr)) {
    const last = [...arr].reverse().find((t) => typeof t?.url === 'string' && /^https?:\/\//i.test(t.url));
    if (last) return last.url;
  }
  return null;
}

const httpUrl = (s) => (typeof s === 'string' && /^https?:\/\/[^\s]+$/i.test(s.trim()) ? s.trim() : null);

/** Un elemento de resultado → ficha normalizada, o null si no tiene lo mínimo (título y URL o ID). */
function normalizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = pickStr(raw, ['title', 'name', 'titulo', 'fulltitle']);
  const url = httpUrl(pickStr(raw, ['url', 'link', 'webpage_url', 'videoUrl', 'video_url', 'permalink']));
  const id = pickStr(raw, ['id', 'videoId', 'video_id']) || (typeof raw.id === 'number' ? String(raw.id) : null);
  if (!title || (!url && !id)) return null;
  const item = { title: title.slice(0, 200) };
  if (url) item.url = url;
  if (id) item.id = id.slice(0, 80);
  const author = pickStr(raw, ['author', 'channel', 'uploader', 'artist', 'creator', 'channelTitle']);
  if (author) item.author = author.slice(0, 100);
  const duration = pickDuration(raw);
  if (duration !== null) item.duration = duration;
  const views = pickNum(raw, ['views', 'viewCount', 'view_count', 'plays']);
  if (views !== null) item.views = Math.round(views);
  const date = pickStr(raw, ['published', 'publishedAt', 'uploadDate', 'upload_date', 'date', 'ago']);
  if (date) item.date = date.slice(0, 40);
  const thumbnail = pickThumb(raw);
  if (thumbnail) item.thumbnail = thumbnail;
  return item;
}

function findArray(json, depth = 0) {
  if (Array.isArray(json)) return json;
  if (!json || typeof json !== 'object' || depth > 3) return null;
  for (const k of ARRAY_KEYS) {
    const found = findArray(json[k], depth + 1);
    if (found) return found;
  }
  for (const v of Object.values(json)) {
    if (Array.isArray(v) && v.some((x) => x && typeof x === 'object')) return v;
  }
  return null;
}

function normalizeSearch(json, limit = 10) {
  const arr = findArray(json);
  if (!arr) return [];
  const seen = new Set();
  const out = [];
  for (const raw of arr) {
    const item = normalizeItem(raw);
    if (!item) continue;
    const key = item.url || `id:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

const FILE_URL_KEYS = ['download', 'downloadUrl', 'download_url', 'dl', 'file', 'fileUrl', 'direct', 'directUrl', 'audio', 'video', 'url', 'link', 'src'];

/** Busca en una respuesta JSON la URL del archivo (y datos opcionales: tamaño, MIME, título). Devuelve null si no hay. */
function normalizeDownload(json, kind) {
  const preferred = kind === 'audio' ? ['audio', ...FILE_URL_KEYS] : ['video', ...FILE_URL_KEYS];
  const visit = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 4) return null;
    for (const k of preferred) {
      const v = node[k];
      const direct = httpUrl(v);
      if (direct) return { node, url: direct };
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const inner = visit(v, depth + 1);
        if (inner) return inner;
      }
    }
    for (const k of ['data', 'result', 'response', 'media']) {
      const inner = visit(node[k], depth + 1);
      if (inner) return inner;
    }
    return null;
  };
  const found = visit(Array.isArray(json) ? json[0] : json, 0);
  if (!found) return null;
  const n = found.node;
  const size = pickNum(n, ['size', 'filesize', 'fileSize', 'contentLength']);
  const mime = pickStr(n, ['mime', 'mimetype', 'mimeType', 'contentType']);
  return { url: found.url, ...(size !== null ? { size } : {}), ...(mime ? { mime } : {}) };
}

module.exports = { normalizeItem, normalizeSearch, normalizeDownload, parseDuration };
