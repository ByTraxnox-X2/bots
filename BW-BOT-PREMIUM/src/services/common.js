'use strict';

const { UserError } = require('./users');

const LOG_CAP = 5000;

/** Siguiente id correlativo persistente: nextId(db, 'team', 'EQ') → EQ-0001, EQ-0002… (nunca se reutiliza). */
function nextId(db, key, prefix, width = 4) {
  const counters = db.ensure('meta', 'counters', () => ({}));
  counters[key] = (counters[key] || 0) + 1;
  db.touch();
  return `${prefix}-${String(counters[key]).padStart(width, '0')}`;
}

/** Registro de auditoría global (colección logs). Nunca guarda secretos: solo quién, qué y sobre qué. */
function audit(db, { scope, ref = null, actor = null, action, detail = '', at = Date.now() }) {
  const logs = db.col('logs');
  logs.push({ at: new Date(at).toISOString(), scope, ref, actor, action, detail: String(detail).slice(0, 300) });
  if (logs.length > LOG_CAP) logs.splice(0, logs.length - LOG_CAP);
  db.touch();
}

const fail = (code, message) => new UserError(code, message);

/** Quita elementos repetidos conservando el orden. */
const uniq = (list) => [...new Set(list)];

module.exports = { nextId, audit, fail, uniq, LOG_CAP };
