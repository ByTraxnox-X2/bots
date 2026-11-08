'use strict';

/**
 * Validadores de argumentos de comandos. Todos devuelven { ok: true, value } o { ok: false, error }
 * con el mensaje en español listo para mostrar al usuario. Nunca lanzan excepciones.
 */

const ok = (value) => ({ ok: true, value });
const fail = (error) => ({ ok: false, error });

/** UID de Free Fire: solo dígitos. */
function parseUid(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return fail('Debes indicar un UID de Free Fire.');
  if (!/^\d+$/.test(raw)) return fail('El UID solo puede contener números.');
  if (raw.length < 5 || raw.length > 15) return fail('El UID debe tener entre 5 y 15 dígitos.');
  return ok(raw);
}

/**
 * Región: 2 a 6 letras. Si se pasa `allowed` (lista no vacía), debe estar en ella.
 */
function parseRegion(text, allowed = []) {
  const raw = String(text ?? '').trim().toLowerCase();
  if (!raw) return fail('Debes indicar una región.');
  if (!/^[a-z]{2,6}$/.test(raw)) return fail('La región debe tener entre 2 y 6 letras (por ejemplo: sa, br, us).');
  if (allowed.length && !allowed.includes(raw)) {
    return fail(`Región no permitida. Opciones: ${allowed.join(', ')}.`);
  }
  return ok(raw);
}

/** Entero positivo dentro de un rango. */
function parseInteger(text, { min = 1, max = Number.MAX_SAFE_INTEGER, label = 'El número' } = {}) {
  const raw = String(text ?? '').trim();
  if (!/^\d+$/.test(raw)) return fail(`${label} debe ser un número entero válido.`);
  const n = Number(raw);
  if (!Number.isSafeInteger(n)) return fail(`${label} es demasiado grande.`);
  if (n < min || n > max) return fail(`${label} debe estar entre ${min} y ${max}.`);
  return ok(n);
}

/** ¿Parece un UID? (solo dígitos y longitud razonable). Sirve para distinguir `.perfil 123456789` de `.perfil @usuario`. */
function looksLikeUid(text) {
  return /^\d{5,15}$/.test(String(text ?? '').trim());
}

function formatNumber(n) {
  return Number(n).toLocaleString('en-US');
}

module.exports = { parseUid, parseRegion, parseInteger, looksLikeUid, formatNumber };
