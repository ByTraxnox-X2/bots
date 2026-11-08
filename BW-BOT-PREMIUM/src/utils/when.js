'use strict';

const time = require('./time');

/**
 * Interpreta una fecha/hora local escrita por una persona: "20:30" (próxima vez que ocurra) o "2026-10-12 20:30".
 * Devuelve { ok, ms } o { ok:false, error }. Debe quedar en el futuro y a menos de `maxDays` días.
 */
function parseWhen(parts, { tz, now, maxDays = 60 }) {
  const text = (Array.isArray(parts) ? parts : [parts]).join(' ').trim();
  let ms;
  let m = text.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}:\d{2})$/);
  if (m) {
    const hm = time.parseHHMM(m[4]);
    if (!hm) return { ok: false, error: 'La hora debe tener formato HH:MM (00:00 a 23:59).' };
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const probe = new Date(Date.UTC(year, month - 1, day));
    if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return { ok: false, error: 'Esa fecha no existe.' };
    ms = time.zonedToUtc({ year, month, day, hour: hm.hour, minute: hm.minute }, tz);
  } else {
    m = text.match(/^(\d{1,2}:\d{2})$/);
    if (!m || !time.parseHHMM(m[1])) return { ok: false, error: 'Indica la hora como HH:MM (por ejemplo 20:30) o AAAA-MM-DD HH:MM.' };
    ms = time.nextDailyOccurrence({ hhmm: m[1], tz, afterMs: now }).runAt;
  }
  if (ms <= now) return { ok: false, error: 'Esa fecha y hora ya pasó.' };
  if (ms - now > maxDays * 86400000) return { ok: false, error: `La fecha no puede estar a más de ${maxDays} días.` };
  return { ok: true, ms };
}

function formatWhen(ms, tz) {
  return `${time.localDateString(ms, tz)} ${time.localTimeString(ms, tz)}`;
}

module.exports = { parseWhen, formatWhen };
