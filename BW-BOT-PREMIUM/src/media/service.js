'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ProviderManager } = require('./manager');
const { DownloadManager } = require('./download');
const { MediaQueue } = require('./queue');
const { MediaCache } = require('./cache');
const { MediaError } = require('./provider');

const WA_MEDIA_LIMIT = 16 * 1048576; // por encima, WhatsApp espera el archivo como documento
const TMP_MAX_AGE_MS = 30 * 60 * 1000;

const isUrl = (s) => /^https?:\/\/\S+$/i.test(String(s || '').trim());

/**
 * MediaService: orquesta la búsqueda, el contexto de cada chat, la comprobación de disponibilidad y la descarga.
 * Nunca inventa datos: título, autor, duración, vistas, fecha, miniatura y URL son solo los que dio el proveedor.
 */
class MediaService {
  constructor({ config, db, logger = null, now = () => Date.now(), fetchImpl = globalThis.fetch, allowPrivate = false, lookup }) {
    this.config = config;
    this.cfg = config.play;
    this.logger = logger;
    this.now = now;
    this.tmpDir = path.join(config.paths.tmp, 'media');
    this.manager = new ProviderManager({ config, fetchImpl, now, logger });
    this.downloads = new DownloadManager({ config, fetchImpl, allowPrivate, lookup });
    this.queue = new MediaQueue({ maxConcurrent: this.cfg.maxConcurrent, maxQueue: this.cfg.maxQueue, maxPerUser: this.cfg.maxPerUser });
    this.cache = new MediaCache({ db, dir: path.join(config.paths.data, 'mediacache'), config, now, logger });
    this.contexts = new Map(); // `${chat}|${user}` -> { at, query, items, selected }
  }

  get configured() { return this.manager.configured; }
  get canSearch() { return this.manager.canSearch; }
  get canDownload() { return this.manager.canDownload; }

  // ---------- contexto por chat/usuario (con caducidad) ----------

  _key(chat, user) { return `${chat}|${user}`; }

  context(chat, user) {
    const k = this._key(chat, user);
    const c = this.contexts.get(k);
    if (!c) return null;
    if (this.now() - c.at > this.cfg.contextTtlSec * 1000) {
      this.contexts.delete(k);
      return null;
    }
    return c;
  }

  setContext(chat, user, { query, items, selected = null }) {
    this.contexts.set(this._key(chat, user), { at: this.now(), query, items, selected });
    while (this.contexts.size > 500) this.contexts.delete(this.contexts.keys().next().value);
  }

  clearContext(chat, user) { return this.contexts.delete(this._key(chat, user)); }

  /** Elemento elegido: índice (1-based) o el seleccionado del contexto. */
  pick(chat, user, index = null) {
    const c = this.context(chat, user);
    if (!c) return null;
    const i = index !== null ? index - 1 : c.selected;
    if (i === null || i === undefined || !c.items[i]) return null;
    c.selected = i;
    c.at = this.now();
    return c.items[i];
  }

  // ---------- búsqueda ----------

  /** Busca con caché y fallback entre proveedores. type: audio | video | all. */
  async search(query, { type = 'all', limit = this.cfg.results } = {}) {
    const q = String(query || '').trim();
    if (q.length < 2) throw new MediaError('NOT_FOUND', 'consulta vacía');
    const hit = this.cache.getSearch(q, type);
    if (hit) return { items: hit.items.slice(0, limit), provider: hit.provider, cached: true };
    const out = await this.manager.search(q, { type, limit });
    this.cache.putSearch(q, type, out.items, out.provider);
    return { items: out.items, provider: out.provider, cached: false };
  }

  // ---------- disponibilidad y descarga ----------

  _tooLong(item) {
    const max = this.cfg.maxDurationSec;
    return max > 0 && typeof item.duration === 'number' && item.duration > max;
  }

  /** ¿Se puede descargar? Pregunta al proveedor y comprueba encabezados SIN descargar el archivo. */
  async availability(item, kind) {
    if (!this.canDownload) return { available: false, reason: 'NOT_CONFIGURED' };
    if (this._tooLong(item)) return { available: false, reason: 'TOO_LONG' };
    const cached = this.cache.getFile(item, kind);
    if (cached) return { available: true, cached: true, size: cached.size, mime: cached.mime };
    let reason = 'UNAVAILABLE';
    for (const p of this.manager.candidates('download', item.provider)) {
      try {
        const dl = await p.resolveDownload(item, kind);
        const meta = await this.downloads.probe(dl.url, kind);
        this.manager.health.ok(p.name, 0);
        return { available: true, provider: p.name, size: meta.size ?? dl.size, mime: meta.mime ?? dl.mime };
      } catch (err) {
        reason = err instanceof MediaError ? err.kind : 'API_DOWN';
        this.manager.health.fail(p.name, reason, err.detail || err.message);
        if (reason === 'TOO_LARGE' || reason === 'BAD_TYPE') break;
      }
    }
    return { available: false, reason };
  }

  /**
   * Obtiene el archivo (de la caché o descargándolo). Devuelve { file, mime, size, ext, cached, temporary, provider }.
   * Si temporary=true, el llamador debe llamar a release(result) al terminar de enviarlo.
   */
  async prepare(item, kind, { userKey = null } = {}) {
    if (!this.canDownload) throw new MediaError('NOT_CONFIGURED', 'no hay proveedores de descarga configurados');
    if (this._tooLong(item)) throw new MediaError('TOO_LONG', 'dura más del máximo permitido');
    const cached = this.cache.getFile(item, kind);
    if (cached) return { ...cached, cached: true, temporary: false };

    this._maybeSweep();
    return this.queue.run(async () => {
      const attempts = [];
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.cfg.timeoutMs);
      try {
        for (const p of this.manager.candidates('download', item.provider)) {
          const t0 = this.now();
          try {
            const dl = await p.resolveDownload(item, kind, { signal: ctrl.signal });
            const file = await this.downloads.download(dl.url, kind, { dir: this.tmpDir, signal: ctrl.signal });
            this.manager.health.ok(p.name, this.now() - t0);
            const stored = this.cache.putFile(item, kind, file.file, file);
            if (stored) {
              try { fs.rmSync(file.file, { force: true }); } catch { /* ignorar */ }
              return { file: stored, mime: file.mime, size: file.size, ext: file.ext, cached: false, temporary: false, provider: p.name };
            }
            return { ...file, cached: false, temporary: true, provider: p.name };
          } catch (err) {
            const kindErr = err instanceof MediaError ? err.kind : 'API_DOWN';
            attempts.push({ provider: p.name, kind: kindErr });
            this.manager.health.fail(p.name, kindErr, err.detail || err.message);
            this.logger?.warn?.(`Descarga: ${p.name} → ${kindErr}`);
            // Límite de tamaño o tiempo total agotado: otro proveedor no lo arreglaría.
            if (kindErr === 'TOO_LARGE' || kindErr === 'TIMEOUT') throw Object.assign(err, { attempts });
          }
        }
      } finally {
        clearTimeout(timer);
      }
      const allUnavailable = attempts.length > 0 && attempts.every((a) => a.kind === 'UNAVAILABLE');
      const kindOut = attempts.length === 0 ? 'API_DOWN' : allUnavailable ? 'UNAVAILABLE' : attempts.some((a) => a.kind === 'BAD_TYPE') ? 'BAD_TYPE' : attempts.some((a) => a.kind === 'UNSAFE') ? 'UNSAFE' : 'API_DOWN';
      throw Object.assign(new MediaError(kindOut, 'ningún proveedor pudo entregar el archivo'), { attempts });
    }, { userKey });
  }

  /** Borra el archivo temporal (el de la caché se conserva). */
  release(result) {
    if (result && result.temporary && result.file) {
      try { fs.rmSync(result.file, { force: true }); } catch { /* ignorar */ }
    }
  }

  /** Descarga la miniatura que dio el proveedor (nunca se genera una). */
  async thumbnail(item) {
    if (!item.thumbnail) throw new MediaError('NOT_FOUND', 'el proveedor no entregó miniatura');
    const file = await this.downloads.download(item.thumbnail, 'image', { dir: this.tmpDir, maxBytes: 8 * 1048576 });
    return { ...file, temporary: true };
  }

  /** Cómo enviar por WhatsApp: audio/video normales hasta 16 MB; más grande, como documento. */
  sendKind(kind, size) {
    return size > WA_MEDIA_LIMIT ? 'document' : kind;
  }

  /** Limpieza al arrancar y periódica: temporales viejos y caché inconsistente. */
  sweep() {
    let removed = 0;
    try {
      if (fs.existsSync(this.tmpDir)) {
        for (const f of fs.readdirSync(this.tmpDir)) {
          const full = path.join(this.tmpDir, f);
          try {
            if (Date.now() - fs.statSync(full).mtimeMs > TMP_MAX_AGE_MS) { fs.rmSync(full, { force: true }); removed += 1; }
          } catch { /* ignorar */ }
        }
      }
    } catch (err) {
      this.logger?.warn?.('No se pudo limpiar la carpeta temporal de medios', err);
    }
    removed += this.cache.sweep();
    for (const [k, c] of this.contexts) if (this.now() - c.at > this.cfg.contextTtlSec * 1000) this.contexts.delete(k);
    return removed;
  }

  /** Al arrancar (app.js llama a syncAll de cada servicio): borra temporales huérfanos de una ejecución anterior. */
  syncAll() { return this.sweep(); }

  _maybeSweep() {
    if (this.now() - (this._sweptAt || 0) < 10 * 60 * 1000) return;
    this._sweptAt = this.now();
    this.sweep();
  }

  status() { return this.manager.status(); }
  stats() { return { ...this.queue.stats(), contexts: this.contexts.size }; }
}

module.exports = { MediaService, isUrl, WA_MEDIA_LIMIT };
