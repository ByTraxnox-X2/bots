'use strict';

const fs = require('node:fs');
const path = require('node:path');
const util = require('node:util');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const SENSITIVE_KEYS = /(api[_-]?key|token|secret|password|authorization|creds)/i;

function redact(value, depth = 0) {
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SENSITIVE_KEYS.test(k) ? '[REDACTED]' : redact(v, depth + 1);
  }
  return out;
}

/**
 * Logger estructurado con niveles. Escribe a consola y, opcionalmente, a un
 * archivo diario. Los errores de escritura nunca tumban el proceso.
 */
class Logger {
  constructor({ level = 'info', dir = null, toFile = false, scope = 'bot', sink = null, now = () => new Date() } = {}) {
    this.level = LEVELS[level] ? level : 'info';
    this.dir = dir;
    this.toFile = Boolean(toFile && dir);
    this.scope = scope;
    this.sink = sink; // función opcional para tests: (record) => void
    this.now = now;
    this._stream = null;
    this._streamDay = null;
    this._recent = [];
    if (this.toFile) {
      try {
        fs.mkdirSync(this.dir, { recursive: true });
      } catch {
        this.toFile = false;
      }
    }
  }

  child(scope) {
    const c = new Logger({
      level: this.level,
      dir: this.dir,
      toFile: this.toFile,
      scope,
      sink: this.sink,
      now: this.now,
    });
    c._parent = this._parent || this;
    return c;
  }

  /** Últimos avisos y errores en memoria (sin trazas ni datos sensibles). level: 'ERROR' | 'WARN' | null. */
  recent(level = null, limit = 20) {
    const owner = this._parent || this;
    return owner._recent.filter((r) => !level || r.level === level).slice(-limit);
  }

  setLevel(level) {
    if (LEVELS[level]) this.level = level;
  }

  _fileStream() {
    const day = this.now().toISOString().slice(0, 10);
    const owner = this._parent || this;
    if (owner._stream && owner._streamDay === day) return owner._stream;
    if (owner._stream) owner._stream.end();
    owner._streamDay = day;
    owner._stream = fs.createWriteStream(path.join(this.dir, `bot-${day}.log`), { flags: 'a' });
    owner._stream.on('error', () => {
      this.toFile = false;
    });
    return owner._stream;
  }

  _write(level, args) {
    if (LEVELS[level] < LEVELS[this.level]) return;
    let meta = null;
    const parts = [];
    for (const a of args) {
      if (a && typeof a === 'object') {
        meta = Object.assign(meta || {}, redact(a));
      } else {
        parts.push(String(a));
      }
    }
    const record = {
      time: this.now().toISOString(),
      level: level.toUpperCase(),
      scope: this.scope,
      msg: parts.join(' '),
      ...(meta ? { meta } : {}),
    };
    if (level === 'warn' || level === 'error') {
      const owner = this._parent || this;
      owner._recent.push({ time: record.time, level: record.level, scope: record.scope, msg: record.msg.slice(0, 300), error: meta?.message ? String(meta.message).slice(0, 200) : null });
      if (owner._recent.length > 200) owner._recent.splice(0, owner._recent.length - 200);
    }
    if (this.sink) this.sink(record);
    const line = `${record.time} ${record.level.padEnd(5)} [${record.scope}] ${record.msg}${
      meta ? ' ' + util.inspect(meta, { breakLength: Infinity, depth: 4 }) : ''
    }`;
    (level === 'error' ? process.stderr : process.stdout).write(line + '\n');
    if (this.toFile) {
      try {
        this._fileStream().write(JSON.stringify(record) + '\n');
      } catch {
        this.toFile = false;
      }
    }
  }

  debug(...a) { this._write('debug', a); }
  info(...a) { this._write('info', a); }
  warn(...a) { this._write('warn', a); }
  error(...a) { this._write('error', a); }

  close() {
    const owner = this._parent || this;
    if (owner._stream) {
      owner._stream.end();
      owner._stream = null;
    }
  }
}

module.exports = { Logger, redact, LEVELS };
