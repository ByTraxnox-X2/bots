'use strict';

const fs = require('node:fs');
const path = require('node:path');
const schema = require('./schema');

const MAX_ARRAY_LENGTH = { events: 2000, logs: 5000, history: 5000 };

/**
 * Base de datos JSON persistente con:
 *  - escritura atómica (archivo temporal + fsync + rename)
 *  - copia .bak del último estado bueno
 *  - recuperación desde .bak si el archivo principal se corrompe
 *  - migraciones de esquema
 *  - validación de estructura
 *  - backups con rotación
 *  - guardado diferido (debounce) y flush al cerrar
 */
class Database {
  constructor({ file, backupDir, backupKeep = 10, saveDebounceMs = 1500, logger = null } = {}) {
    if (!file) throw new Error('Database: falta la ruta del archivo.');
    this.file = path.resolve(file);
    this.bakFile = this.file + '.bak';
    this.tmpFile = this.file + '.tmp';
    this.backupDir = backupDir ? path.resolve(backupDir) : path.join(path.dirname(this.file), 'backups');
    this.backupKeep = backupKeep;
    this.saveDebounceMs = saveDebounceMs;
    this.logger = logger;
    this.data = null;
    this._timer = null;
    this._dirty = false;
    this._saving = false;
    this._closed = false;
    this.recoveredFrom = null; // 'bak' | 'fresh' | null
  }

  // ---------- carga ----------

  load() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.mkdirSync(this.backupDir, { recursive: true });
    // Un .tmp suelto es una escritura interrumpida: nunca es fiable.
    try { fs.rmSync(this.tmpFile, { force: true }); } catch { /* ignorar */ }

    let loaded = this._tryRead(this.file);
    if (!loaded) {
      const existed = fs.existsSync(this.file);
      if (existed) this._quarantine(this.file);
      loaded = this._tryRead(this.bakFile);
      if (loaded) {
        this.recoveredFrom = 'bak';
        this.logger?.warn('Base de datos recuperada desde .bak');
      } else {
        this.recoveredFrom = existed ? 'fresh' : null;
        loaded = schema.emptyData();
        if (existed) this.logger?.error('Base de datos corrupta y sin .bak válido: se inicia una nueva.');
      }
    }

    const applied = schema.migrate(loaded);
    if (applied.length) this.logger?.info(`Migraciones aplicadas: ${applied.join(', ')}`);
    const errors = schema.validate(loaded);
    if (errors.length) throw new Error('Base de datos inválida: ' + errors.join(' '));
    this.data = loaded;
    this._closed = false;
    if (applied.length || !fs.existsSync(this.file) || this.recoveredFrom) this.saveSync();
    return this;
  }

  _tryRead(file) {
    try {
      if (!fs.existsSync(file)) return null;
      const text = fs.readFileSync(file, 'utf8');
      if (!text.trim()) return null;
      const parsed = JSON.parse(text);
      return schema.isPlainObject(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  _quarantine(file) {
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      fs.renameSync(file, `${file}.corrupt-${stamp}`);
    } catch (err) {
      this.logger?.error('No se pudo aislar el archivo corrupto', err);
    }
  }

  // ---------- guardado ----------

  _serialize() {
    for (const [name, max] of Object.entries(MAX_ARRAY_LENGTH)) {
      const arr = this.data[name];
      if (Array.isArray(arr) && arr.length > max) arr.splice(0, arr.length - max);
    }
    return JSON.stringify(this.data);
  }

  /** Guardado atómico síncrono. */
  saveSync() {
    if (!this.data) return;
    const payload = this._serialize();
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const fd = fs.openSync(this.tmpFile, 'w');
    try {
      fs.writeSync(fd, payload);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    if (fs.existsSync(this.file)) {
      try { fs.copyFileSync(this.file, this.bakFile); } catch (err) {
        this.logger?.warn('No se pudo actualizar .bak', err);
      }
    }
    fs.renameSync(this.tmpFile, this.file);
    this._dirty = false;
  }

  /** Marca cambios y programa un guardado diferido. */
  touch() {
    if (this._closed) return;
    this._dirty = true;
    if (this.saveDebounceMs === 0) {
      this._safeSave();
      return;
    }
    if (this._timer) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      this._safeSave();
    }, this.saveDebounceMs);
    if (this._timer.unref) this._timer.unref();
  }

  _safeSave() {
    if (this._saving) return;
    this._saving = true;
    try {
      if (this._dirty) this.saveSync();
    } catch (err) {
      this.logger?.error('Error guardando la base de datos', err);
    } finally {
      this._saving = false;
    }
  }

  flush() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    if (this._dirty) this.saveSync();
  }

  close() {
    this.flush();
    this._closed = true;
  }

  // ---------- acceso a colecciones ----------

  col(name) {
    if (!this.data || this.data[name] === undefined) {
      throw new Error(`Colección desconocida: ${name}`);
    }
    return this.data[name];
  }

  get(name, id) {
    return this.col(name)[id];
  }

  has(name, id) {
    return Object.prototype.hasOwnProperty.call(this.col(name), id);
  }

  set(name, id, value) {
    if (id === '__proto__' || id === 'constructor' || id === 'prototype') {
      throw new Error('Identificador no permitido.');
    }
    this.col(name)[id] = value;
    this.touch();
    return value;
  }

  /** Devuelve el registro existente o lo crea con `factory()`. */
  ensure(name, id, factory) {
    if (!this.has(name, id)) this.set(name, id, factory());
    return this.get(name, id);
  }

  update(name, id, patch) {
    const current = this.get(name, id);
    if (!current) throw new Error(`No existe ${name}/${id}`);
    Object.assign(current, patch);
    this.touch();
    return current;
  }

  delete(name, id) {
    const removed = delete this.col(name)[id];
    this.touch();
    return removed;
  }

  values(name) {
    return Object.values(this.col(name));
  }

  push(name, entry) {
    const arr = this.col(name);
    if (!Array.isArray(arr)) throw new Error(`"${name}" no es una lista.`);
    arr.push(entry);
    this.touch();
    return entry;
  }

  stats() {
    const out = {};
    for (const name of [...schema.OBJECT_COLLECTIONS, ...schema.ARRAY_COLLECTIONS]) {
      const c = this.data[name];
      out[name] = Array.isArray(c) ? c.length : Object.keys(c).length;
    }
    return out;
  }

  // ---------- backups ----------

  backup(label = 'auto') {
    this.flush();
    fs.mkdirSync(this.backupDir, { recursive: true });
    const safeLabel = String(label).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20) || 'auto';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const name = `db-${stamp}-${safeLabel}.json`;
    fs.copyFileSync(this.file, path.join(this.backupDir, name));
    this._prune();
    return name;
  }

  listBackups() {
    if (!fs.existsSync(this.backupDir)) return [];
    return fs
      .readdirSync(this.backupDir)
      .filter((f) => /^db-.*\.json$/.test(f))
      .sort()
      .reverse()
      .map((f) => {
        const st = fs.statSync(path.join(this.backupDir, f));
        return { name: f, size: st.size, mtime: st.mtime };
      });
  }

  _prune() {
    const list = this.listBackups();
    for (const old of list.slice(this.backupKeep)) {
      try { fs.rmSync(path.join(this.backupDir, old.name), { force: true }); } catch { /* ignorar */ }
    }
  }

  /** Restaura un backup por nombre. Valida el nombre (sin rutas) y el contenido antes de reemplazar. */
  restore(name) {
    if (!/^db-[A-Za-z0-9_.-]+\.json$/.test(name) || name.includes('..')) {
      throw new Error('Nombre de backup inválido.');
    }
    const full = path.join(this.backupDir, name);
    if (path.dirname(full) !== this.backupDir) throw new Error('Nombre de backup inválido.');
    const candidate = this._tryRead(full);
    if (!candidate) throw new Error('El backup está vacío o corrupto.');
    schema.migrate(candidate);
    const errors = schema.validate(candidate);
    if (errors.length) throw new Error('Backup inválido: ' + errors.join(' '));
    this.backup('prerestore');
    this.data = candidate;
    this.saveSync();
    return name;
  }
}

module.exports = { Database };
