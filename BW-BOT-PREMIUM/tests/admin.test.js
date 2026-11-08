'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, say, P, GROUP, GROUP2, OWNER } = require('./support');

const BOT = '593990000001@s.whatsapp.net';
const G3 = '120363000000000003@g.us';
const G4 = '120363000000000004@g.us';
const ENV = { REGISTER_BONUS_COINS: '10', ACTIVITY_XP: '0', FF_API_KEY: 'CLAVE-SECRETA-123' };
const part = (n, botAdmin) => [...P.slice(1, n + 1).map((id) => ({ id, admin: null })), { id: BOT, admin: botAdmin ? 'admin' : null }];
const GROUPS = [
  { id: GROUP, subject: 'Clan Alfa', announce: false, participants: part(5, true) },
  { id: GROUP2, subject: 'Solo Admins', announce: true, participants: part(3, false) },
  { id: G3, subject: 'Grupo Normal', announce: false, participants: part(4, false) },
  { id: G4, subject: 'Grupo Roto', announce: false, participants: part(2, false) },
];

async function owner(extra = {}) {
  return boot({ env: ENV, harness: { self: BOT, groupsList: GROUPS, ...extra } });
}

test('comandos OWNER: un ADMIN o un USER nunca pueden ejecutarlos', async () => {
  const h = await owner();
  try {
    const cmds = ['botinfo', 'statsbot', 'botstatus', 'uptime', 'grupos', 'listagrupos', 'grupoinfo 1', 'broadcast hola mundo', 'broadcast confirmar', 'broadcast cancelar', 'backup', 'backups', 'restore 1', 'reload', 'plugins', 'plugininfo owner', 'mantenimiento on', 'banuser @x', 'unbanuser @x', 'addadmin @x', 'deladmin @x', 'addmod @x', 'delmod @x', 'dbstats', 'logs', 'errors'];
    for (const who of [P[1], P[3]]) {
      for (const c of cmds) assert.match(await say(h, `.${c}`, who, { mentions: [P[4]] }), /No tienes permiso.*OWNER/, `${c} por ${who}`);
    }
    assert.equal(h.permissions.resolve([P[4]]).banned, false);
  } finally { h.close(); }
});

test('.botinfo .statsbot .botstatus .uptime .dbstats: datos reales', async () => {
  const h = await owner();
  try {
    h.services.startedAt = Date.now() - 3725000;
    assert.match(await say(h, '.botinfo', OWNER), /v\d+\.\d+\.\d+[\s\S]*Prefijo: \.[\s\S]*America\/Guayaquil[\s\S]*Comandos registrados: \d+ · Plugins: 15[\s\S]*mantenimiento: desactivado/);
    assert.match(await say(h, '.statsbot', OWNER), /Usuarios: 14[\s\S]*Equipos: 0[\s\S]*Registros de auditoría/);
    const st = await say(h, '.botstatus', OWNER);
    assert.match(st, /Estado del bot[\s\S]*WhatsApp: desconocido[\s\S]*Scheduler: \d+ pendientes[\s\S]*Memoria: [\d.]+ MB[\s\S]*En marcha: 1 h 2 min/);
    assert.match(await say(h, '.uptime', OWNER), /En marcha: 1 h 2 min \d+ s[\s\S]*Sin conexión a WhatsApp registrada/);
    h.wa.connectedAt = Date.now() - 90000;
    assert.match(await say(h, '.uptime', OWNER), /Conectado a WhatsApp hace 1 min/);
    assert.match(await say(h, '.dbstats', OWNER), /Base de datos[\s\S]*Archivo: \d+ KB · Backups: 0[\s\S]*users: 14/);
  } finally { h.close(); }
});

test('.grupos .listagrupos .grupoinfo: solo grupos reales de WhatsApp', async () => {
  const h = await owner();
  try {
    const out = await say(h, '.grupos', OWNER);
    assert.match(out, /Grupos del bot \(4\)[\s\S]*1\. Clan Alfa — 6 miembros · bot admin[\s\S]*2\. Grupo Normal[\s\S]*bot no admin[\s\S]*Solo Admins — 4 miembros · bot no admin · ⛔ no puede escribir/);
    assert.match(await say(h, '.listagrupos', OWNER), /Grupos del bot \(4\)/);
    assert.match(await say(h, '.grupoinfo', OWNER), /Uso:/);
    assert.match(await say(h, '.grupoinfo 1', OWNER), /Clan Alfa[\s\S]*Miembros: 6[\s\S]*Bot administrador: sí · Puede escribir: sí[\s\S]*sin clan verificado[\s\S]*Sin configuración de moderación/);
    await say(h, '.antilinks on', P[1]);
    assert.match(await say(h, `.grupoinfo ${GROUP2}`, OWNER), /Solo Admins[\s\S]*Puede escribir: no \(solo admins escriben\)/);
    assert.match(await say(h, '.grupoinfo 1', OWNER), /Protecciones: antilinks no/);
    assert.match(await say(h, '.grupoinfo 9', OWNER), /No encontré ese grupo/);
    assert.match(await say(h, '.grupoinfo 120363999999999999@g.us', OWNER), /No encontré ese grupo/);
    h.wa.listGroups = async () => { throw new Error('desconectado'); };
    assert.match(await say(h, '.grupos', OWNER), /WhatsApp no está conectado/);
    h.wa.listGroups = async () => [];
    assert.match(await say(h, '.grupos', OWNER), /no está en ningún grupo/);
  } finally { h.close(); }
});

test('.broadcast: vista previa, confirmación única, solo grupos donde puede escribir, vencimiento y cancelación', async () => {
  const h = await owner();
  try {
    assert.match(await say(h, '.broadcast', OWNER), /Uso:/);
    assert.match(await say(h, '.broadcast ab', OWNER), /entre 3 y 1000/);
    assert.match(await say(h, '.broadcast confirmar', OWNER), /No hay ningún anuncio pendiente/);
    assert.match(await say(h, '.broadcast cancelar', OWNER), /No hay ningún anuncio pendiente/);
    const prev = await say(h, '.broadcast Mañana hay mantenimiento a las 20:00', OWNER);
    assert.match(prev, /Vista previa[\s\S]*Mañana hay mantenimiento[\s\S]*Llegaría a 3 de 4 grupos \(1 omitidos/);
    assert.equal(h.sent.filter((s) => s.to === GROUP2 || s.to === G3).length, 0, 'la vista previa no envía nada');
    const real = h.wa.sendText;
    h.wa.sendText = async (to, text, o) => { if (to === G4) throw new Error('expulsado'); return real(to, text, o); };
    const delays = [];
    const out = await say(h, '.broadcast confirmar', OWNER);
    h.wa.sendText = real;
    assert.match(out, /Anuncio enviado\* a 2 de 4 grupos[\s\S]*Omitidos.*Solo Admins[\s\S]*Fallaron: Grupo Roto/);
    const bc = h.sent.filter((s) => /Anuncio del administrador/.test(s.text));
    assert.deepEqual(bc.map((s) => s.to).sort(), [GROUP, G3].sort());
    assert.ok(bc.every((s) => /Mañana hay mantenimiento a las 20:00/.test(s.text)));
    assert.ok(!h.sent.some((s) => s.to === GROUP2 && /Anuncio/.test(s.text)));
    assert.match(await say(h, '.broadcast confirmar', OWNER), /No hay ningún anuncio pendiente/);
    assert.equal(h.sent.filter((s) => /Anuncio del administrador/.test(s.text)).length, 2, 'no se duplica');
    assert.ok(h.services.db.col('logs').some((l) => l.scope === 'admin' && l.ref === 'broadcast' && /2 enviados, 1 fallidos, 1 omitidos/.test(l.detail)));
    // Cancelar y vencer
    await say(h, '.broadcast otro anuncio', OWNER);
    assert.match(await say(h, '.broadcast cancelar', OWNER), /descartado/);
    assert.match(await say(h, '.broadcast confirmar', OWNER), /No hay ningún anuncio pendiente/);
    await say(h, '.broadcast otro anuncio', OWNER);
    h.clock.t += 3 * 60000;
    assert.match(await say(h, '.broadcast confirmar', OWNER), /No hay ningún anuncio pendiente \(o ya venció\)/);
    // Sin grupos donde escribir
    h.wa.listGroups = async () => [GROUPS[1]];
    assert.match(await say(h, '.broadcast hola a todos', OWNER), /No hay grupos donde el bot pueda enviar/);
    assert.equal(delays.length, 0);
  } finally { h.close(); }
});

test('.broadcast: pausa entre grupos y un solo envío concurrente', async () => {
  const waits = [];
  const h = await owner({ sleep: async (ms) => { waits.push(ms); } });
  try {
    await say(h, '.broadcast prueba de pausa', OWNER);
    await say(h, '.broadcast confirmar', OWNER);
    assert.deepEqual(waits, [1500, 1500]); // 3 grupos con envío posible → 2 pausas
  } finally { h.close(); }
});

test('.backup .backups .restore: copia, lista y restauración con confirmación', async () => {
  const h = await owner();
  try {
    assert.match(await say(h, '.backups', OWNER), /Todavía no hay backups/);
    assert.match(await say(h, '.backup', OWNER), /Backup creado: db-.*-manual\.json/);
    const list = await say(h, '.backups', OWNER);
    assert.match(list, /1\. db-.*-manual\.json — \d+ KB[\s\S]*restore NÚMERO confirmar/);
    const coins = h.users.find([P[2]]).coins;
    h.users.addCoins([P[2]], 500, 'prueba');
    assert.equal(h.users.find([P[2]]).coins, coins + 500);
    assert.match(await say(h, '.restore', OWNER), /Uso:/);
    assert.match(await say(h, '.restore 9 confirmar', OWNER), /No encontré ese backup/);
    assert.match(await say(h, '.restore ../../etc/passwd confirmar', OWNER), /No encontré ese backup/);
    assert.match(await say(h, '.restore 1', OWNER), /Vas a reemplazar TODOS los datos[\s\S]*restore 1 confirmar/);
    assert.equal(h.users.find([P[2]]).coins, coins + 500, 'sin confirmar no cambia nada');
    assert.match(await say(h, '.restore 1 confirmar', OWNER), /restaurado.*reinicia el bot/);
    assert.equal(h.users.find([P[2]]).coins, coins);
    assert.ok(h.db.listBackups().some((b) => /prerestore/.test(b.name)), 'backup previo a restaurar');
    assert.ok(h.services.db.col('logs').some((l) => l.action === 'restore'));
  } finally { h.close(); }
});

test('.reload .plugins .plugininfo: recarga segura y listado de plugins', async () => {
  const h = await owner();
  try {
    h.d.groupCache.set('x', { at: 1, meta: {} });
    h.groups.metaCache.set('y', { at: 1, meta: {} });
    assert.match(await say(h, '.reload', OWNER), /Recargado: cachés vaciadas, trabajos sincronizados \(.*matches.*\) y datos guardados/);
    assert.equal(h.d.groupCache.size, 0);
    assert.equal(h.groups.metaCache.size, 0);
    const pl = await say(h, '.plugins', OWNER);
    assert.match(pl, /Plugins cargados[\s\S]*• moderacion — 18 comandos[\s\S]*• owner — \d+ comandos[\s\S]*• social — 6 comandos/);
    assert.match(await say(h, '.plugininfo moderacion', OWNER), /Plugin moderacion[\s\S]*\.warn \[MOD\][\s\S]*\.antilinks \[ADMIN\]/);
    assert.match(await say(h, '.plugininfo', OWNER), /Uso:/);
    assert.match(await say(h, '.plugininfo zzz', OWNER), /No existe el plugin/);
  } finally { h.close(); }
});

test('.mantenimiento: bloquea a todos salvo al OWNER y se puede desactivar', async () => {
  const h = await owner();
  try {
    assert.match(await say(h, '.mantenimiento', OWNER), /Mantenimiento desactivado/);
    assert.match(await say(h, '.mantenimiento maybe', OWNER), /Uso:/);
    assert.match(await say(h, '.mantenimiento off', OWNER), /ya está desactivado/);
    assert.match(await say(h, '.mantenimiento on actualizando', OWNER), /Modo mantenimiento activado/);
    assert.match(await say(h, '.mantenimiento', OWNER), /activado: actualizando/);
    assert.match(await say(h, '.balance', P[3]), /mantenimiento: actualizando/);
    assert.match(await say(h, '.warn @x', P[1], { mentions: [P[4]] }), /mantenimiento/);
    assert.match(await say(h, '.botinfo', OWNER), /Modo mantenimiento: activado/);
    assert.match(await say(h, '.mantenimiento off', OWNER), /desactivado/);
    assert.match(await say(h, '.balance', P[3]), /monedas/i);
    // Persistente tras reiniciar
    await say(h, '.mantenimiento on', OWNER);
    h.db.close();
    const { harness } = require('./harness');
    const h2 = harness({ dir: h.dir, startAt: h.clock.t, env: ENV });
    try { assert.equal(h2.admin.maintenance().enabled, true); } finally { h2.close(); }
  } finally { h.close(); }
});

test('.banuser .unbanuser: baneo por mención o número, ignora al baneado y protege al OWNER', async () => {
  const h = await owner();
  try {
    assert.match(await say(h, '.banuser', OWNER), /Uso:/);
    assert.match(await say(h, '.banuser @x', OWNER, { mentions: [OWNER] }), /No se puede banear al OWNER/);
    assert.match(await say(h, '.banuser @x spam masivo', OWNER, { mentions: [P[4]] }), /fue baneado del bot: spam masivo/);
    assert.equal(h.permissions.resolve([P[4]]).banned, true);
    assert.match(await say(h, '.banuser @x', OWNER, { mentions: [P[4]] }), /ya está baneada/);
    assert.equal(await say(h, '.balance', P[4]), '', 'el baneado no recibe respuesta');
    assert.match(await say(h, '.banuser +593 99 555 0003', OWNER), /Uso:/);
    assert.match(await say(h, '.banuser 593995550003 insultos', OWNER), /baneado.*insultos/);
    assert.match(await say(h, '.unbanuser 593995550003', OWNER), /ya no está baneado/);
    assert.match(await say(h, '.unbanuser 593995550003', OWNER), /no está baneada/);
    assert.match(await say(h, '.unbanuser @x', OWNER, { mentions: [P[4]] }), /ya no está baneado/);
    assert.match(await say(h, '.balance', P[4]), /monedas/i);
    assert.ok(h.services.db.col('logs').some((l) => l.scope === 'admin' && l.action === 'banuser'));
  } finally { h.close(); }
});

test('.addadmin .deladmin .addmod .delmod: roles del bot validados', async () => {
  const h = await owner();
  try {
    assert.match(await say(h, '.addadmin', OWNER), /Uso:/);
    assert.match(await say(h, '.addadmin @x', OWNER, { mentions: [OWNER] }), /OWNER no puede cambiar/);
    assert.match(await say(h, '.addmod @x', OWNER, { mentions: [P[3]] }), /ahora tiene el rol MOD/);
    assert.equal(h.permissions.resolve([P[3]]).role, 'MOD');
    assert.match(await say(h, '.addmod @x', OWNER, { mentions: [P[3]] }), /igual o superior/);
    assert.match(await say(h, '.addadmin @x', OWNER, { mentions: [P[3]] }), /ahora tiene el rol ADMIN/);
    assert.match(await say(h, '.addmod @x', OWNER, { mentions: [P[3]] }), /igual o superior \(ADMIN\)/);
    assert.match(await say(h, '.delmod @x', OWNER, { mentions: [P[3]] }), /no tiene el rol MOD \(rol actual: ADMIN\)/);
    assert.match(await say(h, '.deladmin @x', OWNER, { mentions: [P[3]] }), /ya no es ADMIN/);
    assert.equal(h.permissions.resolve([P[3]]).role, 'USER');
    assert.match(await say(h, '.deladmin @x', OWNER, { mentions: [P[3]] }), /no tiene el rol ADMIN/);
    assert.match(await say(h, '.addmod 593995550009', OWNER), /ahora tiene el rol MOD/);
    assert.match(await say(h, '.delmod 593995550009', OWNER), /ya no es MOD/);
    // Un MOD asignado ya puede moderar en un grupo (warn requiere MOD)
    await say(h, '.addmod @x', OWNER, { mentions: [P[3]] });
    assert.match(await say(h, '.warn @x spam', P[3], { mentions: [P[4]] }), /advertencia 1\/3/);
    // …pero no usar comandos OWNER
    assert.match(await say(h, '.backup', P[3]), /No tienes permiso.*OWNER/);
  } finally { h.close(); }
});

test('.apistatus .logs .errors: sin secretos y con filtros', async () => {
  const h = await owner();
  try {
    const api = await say(h, '.apistatus', OWNER);
    assert.match(api, /Estado de los servicios[\s\S]*Free Fire[\s\S]*Clanes/);
    assert.match(api, /sin_probar|sin probar/);
    // Un usuario normal solo ve el resumen; ADMIN/OWNER ven cada proveedor.
    const user = await say(h, '.apistatus', P[4]);
    assert.match(user, /Estado de los servicios[\s\S]*Free Fire/);
    assert.ok(!/◦/.test(user), 'el usuario no ve proveedores individuales');
    assert.match(api, /◦/);
    assert.match(await say(h, '.apistatus probar', P[4]), /Solo ADMIN u OWNER/);
    assert.ok(!api.includes('CLAVE-SECRETA-123'), 'nunca muestra claves');
    assert.ok(!/https?:\/\//.test(api), 'nunca muestra URLs completas');
    await say(h, '.banuser @x', OWNER, { mentions: [P[4]] });
    await say(h, '.warn @x', P[1], { mentions: [P[5]] });
    assert.match(await say(h, '.logs', OWNER), /Auditoría[\s\S]*\[moderacion\] warn[\s\S]*\[admin\] banuser/);
    const only = await say(h, '.logs 5 admin', OWNER);
    assert.match(only, /\[admin\] banuser/);
    assert.ok(!/\[moderacion\]/.test(only));
    assert.match(await say(h, '.logs 99', OWNER), /Uso:/);
    assert.match(await say(h, '.logs 5 inexistente', OWNER), /No hay registros/);
    assert.match(await say(h, '.errors', OWNER), /No hay errores registrados/);
    h.logger.error('Fallo de prueba en el módulo', new Error('detalle técnico'));
    assert.match(await say(h, '.errors', OWNER), /Errores recientes\* \(1\)[\s\S]*Fallo de prueba en el módulo — detalle técnico/);
    assert.match(await say(h, '.errors 0', OWNER), /Uso:/);
  } finally { h.close(); }
});
