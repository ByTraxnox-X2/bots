'use strict';

const { normalizePlayer } = require('./normalize');

const MAX_BODY_BYTES = 1024 * 1024; // 1 MiB: una ficha de jugador nunca necesita más

/** Error de una API concreta. `kind` es estable y lo usa el servicio para decidir el fallback. */
class FfApiError extends Error {
  constructor(kind, detail = '', extra = {}) {
    super(detail || kind);
    this.name = 'FfApiError';
    this.kind = kind; // NOT_FOUND | REGION_ERROR | API_DOWN | RATE_LIMITED | INVALID_RESPONSE
    this.detail = detail;
    Object.assign(this, extra);
    this.code = errorCode(kind, this);
  }
}

/** Código público estable de un fallo (taxonomía API_*). El de "no encontrado" lo fija el servicio (jugador/clan). */
function errorCode(kind, e = {}) {
  if (e.auth) return 'API_AUTH_ERROR';
  if (e.timeout) return 'API_TIMEOUT';
  switch (kind) {
    case 'NOT_FOUND': return 'NOT_FOUND';
    case 'REGION_ERROR': return 'REGION_NOT_SUPPORTED';
    case 'RATE_LIMITED': return 'API_RATE_LIMIT';
    case 'INVALID_RESPONSE': return 'API_INVALID_RESPONSE';
    case 'NOT_CONFIGURED': return 'API_NOT_CONFIGURED';
    default: return 'API_DOWN';
  }
}

const NOT_FOUND_RE = /not\s*found|no\s*encontrad|no\s*existe|does\s*not\s*exist|doesn.?t\s*exist|invalid\s*(uid|id|player|account|clan|guild)|(uid|id|player|account|clan|guild).{0,20}(invalid|incorrect|wrong|inv[aá]lid)|(player|clan|guild).{0,20}not|unknown\s*(player|uid|account|clan|guild)/i;
const AUTH_RE = /api.?key|auth(entication|orization)?\s*(failed|error)|unauthori[sz]ed|forbidden|invalid\s*token|token\s*invalid/i;
const REGION_RE = /region|server|regi[oó]n/i;

function messageOf(json) {
  if (!json || typeof json !== 'object') return '';
  for (const k of ['error', 'message', 'msg', 'detail', 'reason', 'errorMessage']) {
    if (typeof json[k] === 'string' && json[k].trim()) return json[k].trim().slice(0, 200);
  }
  return '';
}

function isErrorBody(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return false;
  if (json.success === false || json.ok === false) return true;
  if (typeof json.status === 'string' && /^(error|fail|failed|not_?found)$/i.test(json.status)) return true;
  if (json.status === false) return true;
  if (json.error === true || (typeof json.error === 'string' && json.error.trim())) return true;
  return false;
}

function isEmptyBody(json) {
  if (json === null || json === undefined) return true;
  if (Array.isArray(json)) return json.length === 0;
  if (typeof json !== 'object') return true;
  const values = Object.values(json);
  return values.length === 0 || values.every((v) => v === null || v === '' || (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && v !== null && Object.keys(v).length === 0));
}

/** Lee el cuerpo respetando un tope de tamaño, para que una respuesta enorme no consuma memoria. */
async function readCapped(res, maxBytes = MAX_BODY_BYTES) {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new FfApiError('INVALID_RESPONSE', 'Respuesta demasiado grande');
  }
  if (!res.body || typeof res.body.getReader !== 'function') {
    const text = await res.text();
    if (Buffer.byteLength(text) > maxBytes) throw new FfApiError('INVALID_RESPONSE', 'Respuesta demasiado grande');
    return text;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try { await reader.cancel(); } catch { /* ignorar */ }
      throw new FfApiError('INVALID_RESPONSE', 'Respuesta demasiado grande');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

/**
 * Una API de Free Fire configurada por plantilla de URL. Marcadores: {uid} {region} {key}
 * (para clanes el identificador se llama {id}: ver `idName`).
 *  - Si la plantilla no contiene {uid}, se añade uid=<uid> como parámetro de consulta.
 *  - La clave (FF_API_KEY) SOLO se envía a las URLs que contienen {key}.
 *  - Si la plantilla contiene {region}, la API necesita una región para funcionar.
 */
class FfProvider {
  constructor({ index, template = '', apiKey = '', timeoutMs = 8000, fetchImpl = globalThis.fetch, userAgent = 'BW-BOT-PREMIUM', idName = 'uid', idKey = 'uid', normalize = normalizePlayer, spec = null, preset = null, kind = 'player' }) {
    // spec (opcional): proveedor nombrado con prioridad, regiones, reintentos, límite propio y cabecera de autenticación.
    this.spec = spec;
    this.preset = preset;
    this.kindName = kind;
    this.enabled = spec ? spec.enabled !== false : true;
    this.priority = spec && Number.isFinite(spec.priority) ? spec.priority : index + 1;
    this.regions = spec && Array.isArray(spec.regions) ? spec.regions.map((r) => String(r).toLowerCase()) : [];
    this.retries = spec && Number.isInteger(spec.retries) ? spec.retries : null; // null = el del servicio
    this.rateLimitPerMin = spec ? spec.rateLimitPerMin || 0 : 0;
    this.authHeader = spec ? spec.authHeader || '' : '';
    this.authRequired = preset ? !!preset.authRequired : template.includes('{key}') || !!(spec && spec.authHeader);
    this.type = preset ? preset.id : 'generic';
    if (preset && preset.userAgent) userAgent = preset.userAgent;
    if (spec && spec.timeoutMs) timeoutMs = spec.timeoutMs;
    this.idName = idName; // nombre del marcador de la plantilla: {uid} (jugadores) o {id} (clanes)
    this.idKey = idKey; // campo normalizado que debe coincidir con el identificador pedido
    this.normalize = normalize;
    this.index = index;
    this.template = template;
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this.userAgent = userAgent;
    const presetKind = preset ? preset.kinds[kind] : null;
    this.needsRegion = presetKind ? !!presetKind.needsRegion : template.includes('{region}');
    this.needsKey = this.authRequired || template.includes('{key}');
    this.misconfigured = this.needsKey && !apiKey;
    this.name = spec && spec.name ? spec.name : labelFor(template, index, idName);
  }

  /** ¿Atiende esta región? Lista vacía = sin restricción conocida. */
  supportsRegion(region) {
    if (!region || this.regions.length === 0) return true;
    return this.regions.includes(String(region).toLowerCase());
  }

  /** URL y cabeceras de la petición. Los presets arman su propia consulta; los genéricos usan la plantilla. */
  buildRequest(uid, region) {
    const headers = { Accept: 'application/json', 'User-Agent': this.userAgent };
    if (this.preset) {
      const built = this.preset.kinds[this.kindName].build({ base: this.template, id: uid, region, key: this.apiKey });
      return { url: built.url, headers: { ...headers, ...(built.headers || {}) } };
    }
    if (this.authHeader && this.apiKey) headers[this.authHeader] = this.apiKey;
    return { url: this.buildUrl(uid, region), headers };
  }

  buildUrl(uid, region) {
    const marker = `{${this.idName}}`;
    let url = this.template
      .replaceAll(marker, encodeURIComponent(uid))
      .replaceAll('{region}', encodeURIComponent(region || ''))
      .replaceAll('{key}', encodeURIComponent(this.apiKey));
    if (!this.template.includes(marker)) {
      url += (url.includes('?') ? '&' : '?') + `${this.idName}=${encodeURIComponent(uid)}`;
    }
    return url;
  }

  /** Hace la petición HTTP con timeout y tope de tamaño. Lanza FfApiError si no hay respuesta utilizable. */
  async _request(uid, region) {
    if (typeof this.fetchImpl !== 'function') throw new FfApiError('API_DOWN', 'fetch no disponible en este Node');
    const { url, headers } = this.buildRequest(uid, region);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const started = Date.now();
    try {
      const res = await this.fetchImpl(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers,
      });
      const text = await readCapped(res);
      return { res, text, latencyMs: Date.now() - started };
    } catch (err) {
      if (err instanceof FfApiError) throw err;
      if (err && (err.name === 'AbortError' || controller.signal.aborted)) {
        throw new FfApiError('API_DOWN', `Tiempo de espera agotado (${this.timeoutMs} ms)`, { timeout: true });
      }
      // Solo el código de red (ECONNREFUSED, ENOTFOUND…): nunca la URL, que puede llevar la clave.
      const code = (err && (err.cause?.code || err.code)) || 'error de red';
      throw new FfApiError('API_DOWN', String(code));
    } finally {
      clearTimeout(timer);
    }
  }

  /** Respuesta cruda (estado y texto) para diagnóstico con scripts/ff-probe.js. */
  async fetchRaw(uid, region) {
    const { res, text } = await this._request(uid, region);
    return { status: res.status, text };
  }

  /** @returns { data, latencyMs } o lanza FfApiError. */
  async fetchPlayer(uid, region) {
    const { res, text, latencyMs } = await this._request(uid, region);
    let json = null;
    let parsed = true;
    try {
      json = text.trim() ? JSON.parse(text) : null;
    } catch {
      parsed = false;
    }
    const status = res.status;

    if (status >= 200 && status < 300) {
      if (!parsed) throw new FfApiError('INVALID_RESPONSE', 'La API no devolvió JSON válido', { status });
      return { ...this._interpretOk(json, uid, status), latencyMs };
    }
    throw this._classifyHttpError(status, parsed ? json : null, res);
  }

  _interpretOk(json, uid, status) {
    const errorBody = isErrorBody(json);
    const { found, data } = this.normalize(json);
    if (found && !errorBody) {
      if (data[this.idKey] && String(data[this.idKey]) !== String(uid)) {
        throw new FfApiError('INVALID_RESPONSE', 'La API devolvió datos de otro identificador', { status });
      }
      return { data };
    }
    const msg = messageOf(json);
    if (errorBody || msg) {
      if (AUTH_RE.test(msg)) throw new FfApiError('API_DOWN', msg, { status, auth: true });
      if (NOT_FOUND_RE.test(msg)) throw new FfApiError('NOT_FOUND', msg, { status });
      if (REGION_RE.test(msg)) throw new FfApiError('REGION_ERROR', msg, { status });
      if (errorBody) throw new FfApiError('INVALID_RESPONSE', msg || 'La API respondió con un error', { status });
    }
    if (isEmptyBody(json)) throw new FfApiError('NOT_FOUND', 'Respuesta vacía', { status });
    throw new FfApiError('INVALID_RESPONSE', 'La respuesta no contiene datos de jugador reconocibles', { status });
  }

  _classifyHttpError(status, json, res = null) {
    const msg = messageOf(json);
    if (status === 404) return new FfApiError('NOT_FOUND', msg || 'HTTP 404', { status });
    if (status === 429) {
      const ra = Number(res && res.headers && res.headers.get ? res.headers.get('retry-after') : 0);
      return new FfApiError('RATE_LIMITED', 'La API limitó las consultas (HTTP 429)', { status, retryAfterSec: Number.isFinite(ra) && ra > 0 ? ra : 0 });
    }
    if (status === 401 || status === 403) {
      return new FfApiError('API_DOWN', `La API rechazó la autenticación (HTTP ${status}); revisa FF_API_KEY`, { status, auth: true });
    }
    if (status === 400 || status === 422) {
      if (AUTH_RE.test(msg)) return new FfApiError('API_DOWN', msg, { status, auth: true });
      if (NOT_FOUND_RE.test(msg)) return new FfApiError('NOT_FOUND', msg, { status });
      if (REGION_RE.test(msg)) return new FfApiError('REGION_ERROR', msg, { status });
      return new FfApiError('INVALID_RESPONSE', msg || `HTTP ${status}`, { status });
    }
    if (status >= 500) return new FfApiError('API_DOWN', `HTTP ${status}`, { status });
    return new FfApiError('INVALID_RESPONSE', `HTTP ${status}`, { status });
  }
}

/** Etiqueta para mostrar (nunca incluye ruta ni parámetros): solo el host. */
function labelFor(template, index, idName = 'uid') {
  try {
    return new URL(template.replace(new RegExp(`\\{(${idName}|region|key)\\}`, 'g'), 'x')).host || `api${index + 1}`;
  } catch {
    return `api${index + 1}`;
  }
}

module.exports = { FfProvider, FfApiError, errorCode, readCapped, isErrorBody, messageOf, MAX_BODY_BYTES };
