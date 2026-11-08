'use strict';

/**
 * Utilidades de zona horaria basadas en Intl (sin dependencias).
 * Funcionan igual en Termux, Linux y Docker mientras Node tenga datos ICU
 * (las imágenes oficiales de Node y Termux los incluyen).
 */

const formatters = new Map();

function formatter(tz) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    formatters.set(tz, f);
  }
  return f;
}

function isValidTimeZone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Componentes de fecha/hora locales de un instante UTC en la zona dada. */
function localParts(utcMs, tz) {
  const parts = {};
  for (const p of formatter(tz).formatToParts(new Date(utcMs))) {
    if (p.type !== 'literal') parts[p.type] = p.value;
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAYS[parts.weekday],
  };
}

function pad(n, len = 2) {
  return String(n).padStart(len, '0');
}

function localDateString(utcMs, tz) {
  const p = localParts(utcMs, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

function localTimeString(utcMs, tz) {
  const p = localParts(utcMs, tz);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** Desfase (ms) de la zona respecto a UTC en un instante dado. */
function offsetMs(utcMs, tz) {
  const p = localParts(utcMs, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Convierte una fecha/hora local de la zona a un instante UTC (ms). */
function zonedToUtc({ year, month, day, hour = 0, minute = 0 }, tz) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let utc = guess - offsetMs(guess, tz);
  // Segunda pasada por si el desfase cambia entre el cálculo y el instante real (horario de verano).
  utc = guess - offsetMs(utc, tz);
  return utc;
}

/** Valida "HH:MM" (24h). Devuelve { hour, minute } o null. */
function parseHHMM(text) {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(text || '').trim());
  return m ? { hour: Number(m[1]), minute: Number(m[2]) } : null;
}

function formatHHMM({ hour, minute }) {
  return `${pad(hour)}:${pad(minute)}`;
}

/**
 * Próxima ocurrencia (UTC ms) de una hora local "HH:MM" en la zona dada, estrictamente
 * posterior a `afterMs` menos `offsetMinutes` (offset negativo = antes de la hora base).
 * Devuelve { runAt, localDate, localTime } del instante resultante.
 */
function nextDailyOccurrence({ hhmm, tz, afterMs, offsetMinutes = 0 }) {
  const t = parseHHMM(hhmm);
  if (!t) throw new Error(`Hora inválida: ${hhmm}`);
  const today = localParts(afterMs, tz);
  for (let add = 0; add <= 2; add++) {
    const dayStart = Date.UTC(today.year, today.month - 1, today.day + add);
    const d = new Date(dayStart);
    const base = zonedToUtc(
      { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: t.hour, minute: t.minute },
      tz
    );
    const runAt = base + offsetMinutes * 60000;
    if (runAt > afterMs) {
      return { runAt, localDate: localDateString(runAt, tz), localTime: localTimeString(runAt, tz) };
    }
  }
  throw new Error('No se pudo calcular la próxima ocurrencia.');
}

module.exports = {
  isValidTimeZone,
  localParts,
  localDateString,
  localTimeString,
  offsetMs,
  zonedToUtc,
  parseHHMM,
  formatHHMM,
  nextDailyOccurrence,
};
