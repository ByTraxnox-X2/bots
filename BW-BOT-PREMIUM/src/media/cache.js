'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const COLLECTION = 'mediaCache';
const SEARCH_MAX = 300;

/** Caché de búsquedas (en la base de datos, con caducidad) y de archivos (en disco, con límite de tamaño y LRU). */
class MediaCache {
  constructor({ db, dir, config, now = () => Date.now(), logger = null }) {
    this.db = db;
    this.dir = dir;
    this.ttlMs = config.play.cacheTtlSec * 1000;
    this.maxBytes = config.play.fileCacheMb * 1048576;
    this.now = now;
    this.logger = logger;
  }

  // ---------- búsquedas ----------

  _skey(query, type) {
    return `s:${type}:${crypto.createHash('sha1').update(String(query).toLowerCase().trim()).digest('hex').slice(0, 20)}`;
  }

  getSearch(query, type) {
    if (this.ttlMs <= 0) return null;
    const e = this.db.get(COLLECTION, this._skey(query, type));
    if (!e) return null;
    if (this.now() - e.at >= this.ttlMs) {
      this.db.delete(COLLECTION, this._skey(query, type));
      return null;
    }
    return e;
  }

  putSearch(query, type, items, provider) {
    if (this.ttlMs <= 0 || !items.length) return;
    this.db.set(COLLECTION, this._skey(query, type), { at: this.now(), items, provider });
    const keys = Object.keys(this.db.col(COLLECTION)).filter((k) => k.startsWith('s:'));
    if (keys.length > SEARCH_MAX) {
      const sorted = keys.map((k) => [k, this.db.get(COLLECTION, k).at]).sort((a, b) => a[1] - b[1]);
      for (const [k] of sorted.slice(0, keys.length - SEARCH_MAX)) this.db.delete(COLLECTION, k);
    }
  }

  // ---------- archivos ----------

  key(item, kind) {
    return `f:${kind}:${crypto.createHash('sha1').update(String(item.url || item.id)).digest('hex').slice(0, 24)}`;
  }

  get enabled() {
    return this.maxBytes > 0;
  }

  getFile(item, kind) {
    if (!this.enabled) return null;
    const k = this.key(item, kind);
    const e = this.db.get(COLLECTION, k);
    if (!e) return null;
    const file = path.join(this.dir, e.name);
    if (!fs.existsSync(file) || this.now() - e.at >= this.ttlMs) {
      this.db.delete(COLLECTION, k);
      try { fs.rmSync(file, { force: true }); } catch { /* ignorar */ }
      return null;
    }
    e.last = this.now();
    this.db.touch();
    return { file, mime: e.mime, size: e.size, ext: e.ext };
  }

  /** Copia el archivo descargado a la caché (si cabe) y devuelve su ruta definitiva; si no, null. */
  putFile(item, kind, src, meta) {
    if (!this.enabled || meta.size > this.maxBytes) return null;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const name = `${crypto.randomBytes(8).toString('hex')}.${meta.ext}`;
      fs.copyFileSync(src, path.join(this.dir, name));
      this.db.set(COLLECTION, this.key(item, kind), { at: this.now(), last: this.now(), name, mime: meta.mime, size: meta.size, ext: meta.ext });
      this._evict();
      return path.join(this.dir, name);
    } catch (err) {
      this.logger?.warn?.('No se pudo guardar en la caché de archivos', err);
      return null;
    }
  }

  _evict() {
    const entries = Object.entries(this.db.col(COLLECTION)).filter(([k]) => k.startsWith('f:'));
    let total = entries.reduce((n, [, e]) => n + e.size, 0);
    for (const [k, e] of entries.sort((a, b) => a[1].last - b[1].last)) {
      if (total <= this.maxBytes) break;
      try { fs.rmSync(path.join(this.dir, e.name), { force: true }); } catch { /* ignorar */ }
      this.db.delete(COLLECTION, k);
      total -= e.size;
    }
  }

  /** Quita entradas sin archivo y archivos sin entrada (p. ej. tras una caída). */
  sweep() {
    let removed = 0;
    const known = new Set();
    for (const [k, e] of Object.entries(this.db.col(COLLECTION))) {
      if (!k.startsWith('f:')) continue;
      if (!fs.existsSync(path.join(this.dir, e.name))) {
        this.db.delete(COLLECTION, k);
        removed++;
      } else known.add(e.name);
    }
    if (fs.existsSync(this.dir)) {
      for (const f of fs.readdirSync(this.dir)) {
        if (!known.has(f)) {
          try { fs.rmSync(path.join(this.dir, f), { force: true }); removed++; } catch { /* ignorar */ }
        }
      }
    }
    return removed;
  }
}

module.exports = { MediaCache };
