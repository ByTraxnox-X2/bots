'use strict';

/** Conversión de unidades con tablas propias. No incluye monedas (requieren tasas en vivo que no se inventan). */
const TABLES = {
  longitud: { mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.344 },
  masa: { mg: 1e-6, g: 0.001, kg: 1, lb: 0.45359237, oz: 0.028349523125, t: 1000 },
  volumen: { ml: 0.001, l: 1, gal: 3.785411784, qt: 0.946352946, cup: 0.2365882365, floz: 0.0295735295625 },
  tiempo: { ms: 0.001, s: 1, min: 60, h: 3600, d: 86400, sem: 604800 },
  velocidad: { ms: 1, kmh: 1 / 3.6, mph: 0.44704, kn: 0.514444 },
  datos: { b: 1, kb: 1024, mb: 1048576, gb: 1073741824, tb: 1099511627776 },
};
const ALIASES = { metro: 'm', metros: 'm', kilometro: 'km', kilometros: 'km', milla: 'mi', millas: 'mi', pulgada: 'in', pulgadas: 'in', pie: 'ft', pies: 'ft', yarda: 'yd', yardas: 'yd', kilo: 'kg', kilos: 'kg', gramo: 'g', gramos: 'g', libra: 'lb', libras: 'lb', onza: 'oz', onzas: 'oz', litro: 'l', litros: 'l', galon: 'gal', galones: 'gal', segundo: 's', segundos: 's', minuto: 'min', minutos: 'min', hora: 'h', horas: 'h', dia: 'd', dias: 'd', 'm/s': 'ms', 'km/h': 'kmh', celsius: 'c', fahrenheit: 'f', kelvin: 'k', '°c': 'c', '°f': 'f' };
const TEMPS = ['c', 'f', 'k'];

const norm = (u) => { const x = String(u).toLowerCase().trim(); return ALIASES[x] || x; };

function tableOf(u) {
  for (const [name, t] of Object.entries(TABLES)) if (u in t) return name;
  return TEMPS.includes(u) ? 'temperatura' : null;
}

function convert(value, from, to) {
  const a = norm(from);
  const b = norm(to);
  const ta = tableOf(a);
  const tb = tableOf(b);
  if (!ta) throw new Error(`No conozco la unidad “${from}”.`);
  if (!tb) throw new Error(`No conozco la unidad “${to}”.`);
  if (ta !== tb) throw new Error(`No se puede convertir ${ta} a ${tb}.`);
  if (ta === 'temperatura') {
    const c = a === 'c' ? value : a === 'f' ? (value - 32) * 5 / 9 : value - 273.15;
    if (c < -273.15) throw new Error('Esa temperatura es inferior al cero absoluto.');
    return b === 'c' ? c : b === 'f' ? (c * 9) / 5 + 32 : c + 273.15;
  }
  return (value * TABLES[ta][a]) / TABLES[ta][b];
}

function units() {
  return Object.entries(TABLES).map(([k, t]) => `${k}: ${Object.keys(t).join(', ')}`).concat('temperatura: c, f, k');
}

module.exports = { convert, units };
