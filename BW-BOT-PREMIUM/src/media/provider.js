'use strict';

const { normalizeSearch, normalizeDownload } = require('./normalize');

const MAX_JSON_BYTES = 2 * 1024 * 1024;

class MediaError extends Error {
  /** kind: NOT_FOUND | API_DOWN | RATE_LIMITED | INVALID_RESPONSE | UNAVAILABLE | TOO_LARGE | BAD_TYPE | UNSAFE | TIMEOUT */
  constructor(kind, detail = '') {
    super(detail || kind);
    this.name = 'MediaError';
    this.kind = kind;
    this.detail = detail;
  }
}

async function readJson(res, max = MAX_JSON_BYTES) {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) throw new MediaError('INVALID_RESPONSE', 'Respuesta demasiado grande');
  const text = await res.text();
  if (Buffer.byteLength(text) > max) throw new MediaError('INVALID_RESPONSE', 'Respuesta demasiado grande');
  try {
    return JSON.parse(text);
  } catch {
    throw new MediaError('INVALID_RESPONSE', 'La respuesta no es JSON');
  }
}

/**
 * Un proveedor multimedia configurado por plantilla de URL. Marcadores:
 *   {query} texto de búsqueda · {type} audio|video|all · {limit} · {url} URL del elemento · {id} ID del elemento · {key} clave de API
 * Capacidades: con {query} sabe buscar; con {url} o {id} sabe resolver descargas.
 * La clave solo se envía a plantillas que contienen {key}.
 */
class MediaProvider {
  constructor({ template, name, apiKey = '', timeoutMs = 15000, fetchImpl = globalThis.fetch }) {
    this.template = template;
    this.name = name;
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl;
    this.canSearch = template.includes('{query}');
    this.canDownload = template.includes('{url}') || template.includes('{id}');
    this.needsKey = template.includes('{key}');
    this.misconfigured = this.needsKey && !apiKey;
  }

  _build(vars) {
    let url = this.template;
    for (const [k, v] of Object.entries({ ...vars, key: this.apiKey })) url = url.split(`{${k}}`).join(encodeURIComponent(String(v ?? '')));
    return url;
  }

  async _request(url, { signal } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    const onAbort = () => ctrl.abort();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const res = await this.fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json, */*', 'user-agent': 'BW-BOT-PREMIUM' }, redirect: 'follow' });
      if (res.status === 429) throw new MediaError('RATE_LIMITED', 'HTTP 429');
      if (res.status === 404) throw new MediaError('NOT_FOUND', 'HTTP 404');
      if (res.status >= 500) throw new MediaError('API_DOWN', `HTTP ${res.status}`);
      if (res.status >= 400) throw new MediaError('UNAVAILABLE', `HTTP ${res.status}`);
      return res;
    } catch (err) {
      if (err instanceof MediaError) throw err;
      if (err?.name === 'AbortError') throw new MediaError(signal?.aborted ? 'TIMEOUT' : 'API_DOWN', 'tiempo de espera agotado');
      throw new MediaError('API_DOWN', String(err?.code || err?.message || 'error de red').slice(0, 80));
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  async search(query, { type = 'all', limit = 8, signal } = {}) {
    if (!this.canSearch) throw new MediaError('UNAVAILABLE', 'no soporta búsqueda');
    const res = await this._request(this._build({ query, type, limit }), { signal });
    const json = await readJson(res);
    return normalizeSearch(json, limit).map((i) => ({ ...i, provider: this.name }));
  }

  /**
   * Pide al proveedor el archivo de un elemento. Devuelve { url, size?, mime? } con la URL real del archivo.
   * Si el proveedor responde directamente con el archivo (audio/video/octet-stream), la URL es la propia petición.
   */
  async resolveDownload(item, kind, { signal } = {}) {
    if (!this.canDownload) throw new MediaError('UNAVAILABLE', 'no soporta descargas');
    if (!item.url && !item.id) throw new MediaError('UNAVAILABLE', 'el elemento no tiene URL ni ID');
    const url = this._build({ url: item.url || '', id: item.id || '', type: kind });
    const res = await this._request(url, { signal });
    const ctype = String(res.headers.get('content-type') || '').toLowerCase();
    if (/^(audio|video)\//.test(ctype) || ctype.startsWith('application/octet-stream')) {
      try { await res.body?.cancel?.(); } catch { /* ignorar */ }
      return { url, direct: true };
    }
    const json = await readJson(res);
    const dl = normalizeDownload(json, kind);
    if (!dl) {
      const msg = typeof json?.error === 'string' ? json.error : typeof json?.message === 'string' ? json.message : '';
      throw new MediaError('UNAVAILABLE', msg ? msg.slice(0, 100) : 'el proveedor no entregó un archivo para este elemento');
    }
    return dl;
  }
}

module.exports = { MediaProvider, MediaError, readJson };
