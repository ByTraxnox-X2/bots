'use strict';

/** Quita las marcas de formato de WhatsApp de un texto externo para que no rompa los mensajes del bot. */
function plain(value) {
  return String(value ?? '').replace(/[*_~`]/g, '');
}

/** Barra de progreso de texto, por ejemplo ████░░░░░░ */
function bar(percent, size = 10) {
  const p = Math.max(0, Math.min(100, Math.floor(Number(percent) || 0)));
  const filled = Math.round((p / 100) * size);
  return '█'.repeat(filled) + '░'.repeat(size - filled);
}

/** Tiempo transcurrido legible: "hace 5 min". */
function ago(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return 'hace unos segundos';
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} ${d === 1 ? 'día' : 'días'}`;
}

/** Fecha corta AAAA-MM-DD a partir de un ISO o epoch. */
function dateOnly(value) {
  const t = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : '';
}

module.exports = { plain, bar, ago, dateOnly };
