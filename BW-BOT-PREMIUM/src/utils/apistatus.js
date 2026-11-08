'use strict';

const { plain } = require('./text');

const LEVEL = { operativo: '🟢 operativo', parcial: '🟡 parcial (algún proveedor falla)', caido: '🔴 sin respuesta', sin_configurar: '⚪ sin configurar' };
const STATE = { ok: '🟢 ok', sin_probar: '⚪ sin probar', degradada: '🟡 degradada', caida: '🔴 en cooldown', sin_configurar: '⚪ sin clave/URL', desactivada: '⚫ desactivada' };

function sources(services) {
  return [
    ['Free Fire (jugadores)', services.ff],
    ['Clanes', services.clanApi],
    ['Medios (.play)', services.media && services.media.manager ? services.media.manager : null],
  ].filter(([, svc]) => svc && typeof svc.status === 'function');
}

function summaryOf(svc) {
  if (typeof svc.summary === 'function') return svc.summary();
  const st = svc.status().filter((s) => s.state !== 'sin_configurar');
  if (!st.length) return { configured: 0, available: 0, level: 'sin_configurar' };
  const available = st.filter((s) => s.state === 'ok' || s.state === 'sin_probar' || s.state === 'degradada').length;
  return { configured: st.length, available, level: available === 0 ? 'caido' : available === st.length ? 'operativo' : 'parcial' };
}

const secs = (ms) => `${Math.max(0, Math.ceil(ms / 1000))} s`;

/** Texto de .apistatus. Usuarios: solo resumen por servicio. ADMIN/OWNER: detalle por proveedor. Nunca claves ni URLs. */
function apiStatusText(services, { detailed = false, now = Date.now() } = {}) {
  const list = sources(services);
  if (!list.length) return '🌐 *Estado de los servicios*\nNo hay servicios externos configurados.';
  const out = ['🌐 *Estado de los servicios*'];
  for (const [title, svc] of list) {
    const sum = summaryOf(svc);
    out.push(`• ${title}: ${LEVEL[sum.level] || sum.level}${sum.configured ? ` (${sum.available}/${sum.configured} disponibles)` : ''}`);
    if (!detailed) continue;
    for (const s of svc.status()) {
      const bits = [STATE[s.state] || s.state];
      if (s.priority !== undefined) bits.unshift(`#${s.priority}`);
      if (s.lastLatencyMs) bits.push(`${s.lastLatencyMs} ms`);
      if (s.successCount !== undefined) bits.push(`✔${s.successCount} ✖${s.errorCount}`);
      if (s.cooldownUntil) bits.push(`cooldown ${secs(s.cooldownUntil - now)}`);
      if (s.lastErrorCode || s.lastError) bits.push(`último error: ${plain(String(s.lastErrorCode || s.lastError).slice(0, 40))}`);
      if (s.regions && s.regions.length) bits.push(`regiones: ${s.regions.slice(0, 6).join('/')}${s.regions.length > 6 ? '…' : ''}`);
      if (s.authRequired) bits.push('requiere clave');
      out.push(`    ◦ ${plain(s.name)}${s.type && s.type !== 'generic' ? ` (${s.type})` : ''} — ${bits.join(' · ')}`);
    }
  }
  if (!detailed) out.push('ADMIN/OWNER pueden ver el detalle de cada proveedor.');
  else out.push('"sin probar" = aún sin consultas reales. Usa *apistatus probar* para verificar ahora.');
  return out.join('\n');
}

/** Verifica todos los proveedores que tengan identificador de prueba configurado. */
async function probeAll(services) {
  let checked = 0;
  for (const svc of [services.ff, services.clanApi, services.media && services.media.manager].filter(Boolean)) {
    if (typeof svc.checkHealth === 'function') checked += (await svc.checkHealth()).checked || 0;
  }
  return { checked };
}

module.exports = { apiStatusText, probeAll, summaryOf };
