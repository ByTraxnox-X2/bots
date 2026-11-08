'use strict';

const jid = require('../../whatsapp/jid');
const { UserError } = require('../../services/users');
const { roleLevel } = require('../../middleware/permissions');
const { plain } = require('../../utils/text');
const { formatNumber } = require('../../utils/validators');
const { targetJid, tag } = require('../shared');

const usage = (ctx, text) => new UserError('USAGE', `Uso: *${ctx.prefix}${text}*`);
const A = (ctx) => ctx.services.admin;

function duration(sec) {
  const s = Math.max(0, Math.floor(sec));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return [d ? `${d} d` : null, h || d ? `${h} h` : null, `${m} min`, `${s % 60} s`].filter(Boolean).join(' ');
}

/** Persona objetivo: mención/cita o un número de teléfono (con prefijo de país). */
function personArg(ctx, text) {
  const t = targetJid(ctx);
  if (t) return t;
  const num = ctx.args.find((a) => /^\+?\d{8,15}$/.test(a));
  const j = num ? jid.fromNumber(num) : '';
  if (!j) throw usage(ctx, `${text} (menciona a la persona o escribe su número con prefijo de país)`);
  return j;
}

function setRoleCommand({ name, verb, role, remove }) {
  return {
    name,
    description: remove ? `Quita el rol ${role} a una persona (vuelve a USER). Solo si tenía exactamente ese rol.` : `Asigna el rol ${role} del bot a una persona.`,
    usage: `${name} @usuario|número`,
    example: `${name} @usuario`,
    category: 'owner',
    permissions: 'OWNER',
    cooldown: 3,
    async handler(ctx) {
      const target = personArg(ctx, `${name} @usuario|número`);
      const perms = ctx.services.permissions;
      if (perms.isOwner([target])) throw new UserError('TARGET_OWNER', 'El OWNER no puede cambiar de rol.');
      const current = perms.resolve([target]).role;
      try {
        if (remove) {
          if (current !== role) throw new UserError('WRONG_ROLE', `Esa persona no tiene el rol ${role} (rol actual: ${current}).`);
          perms.setRole(target, 'USER', { by: ctx.sender });
        } else {
          if (roleLevel(current) >= roleLevel(role)) throw new UserError('ALREADY', `Esa persona ya tiene un rol igual o superior (${current}).`);
          perms.setRole(target, role, { by: ctx.sender });
        }
      } catch (err) {
        if (err instanceof UserError) throw err;
        throw new UserError('ROLE_FAILED', plain(err.message));
      }
      ctx.services.db.touch();
      require('../../services/common').audit(ctx.services.db, { scope: 'admin', ref: target, actor: ctx.sender, action: name, detail: role, at: Date.now() });
      return { text: remove ? `✅ ${tag(target)} ya no es ${role} (ahora USER).` : `✅ ${tag(target)} ahora tiene el rol ${role}.`, mentions: [target] };
    },
  };
}

const broadcastSubs = [
  {
    name: 'confirmar',
    aliases: ['confirm', 'enviar'],
    description: 'Envía el anuncio preparado a todos los grupos donde el bot puede escribir (una sola vez).',
    usage: 'broadcast confirmar',
    permissions: 'OWNER',
    async handler(ctx) {
      await ctx.reply('📤 Enviando el anuncio a los grupos…');
      const r = await A(ctx).confirmBroadcast(ctx.sender);
      return [
        `✅ *Anuncio enviado* a ${r.sent} de ${r.total} grupos.`,
        r.skipped.length ? `⏭️ Omitidos (el bot no puede escribir): ${r.skipped.slice(0, 10).map(plain).join(', ')}${r.skipped.length > 10 ? '…' : ''}` : null,
        r.failed.length ? `⚠️ Fallaron: ${r.failed.slice(0, 10).map(plain).join(', ')}${r.failed.length > 10 ? '…' : ''}` : null,
      ].filter(Boolean).join('\n');
    },
  },
  {
    name: 'cancelar',
    aliases: ['cancel'],
    description: 'Descarta el anuncio preparado sin enviarlo.',
    usage: 'broadcast cancelar',
    permissions: 'OWNER',
    async handler(ctx) {
      A(ctx).cancelBroadcast();
      return '🗑️ Anuncio descartado.';
    },
  },
];

function build() {
  return [
    {
      name: 'botinfo',
      aliases: ['infobot'],
      description: 'Información del bot: nombre, versión, entorno, prefijo, zona horaria y cantidad de comandos y plugins.',
      usage: 'botinfo',
      example: 'botinfo',
      category: 'owner',
      permissions: 'OWNER',
      cooldown: 5,
      async handler(ctx) {
        const { config, registry } = ctx.services;
        const { PLUGINS } = require('../index');
        return [
          `🤖 *${plain(config.name)}* v${config.version}`,
          `Node ${process.version} · ${process.platform} · PID ${process.pid}`,
          `Prefijo: ${config.prefix} · Zona horaria: ${config.timezone}`,
          `Comandos registrados: ${registry.size} · Plugins: ${PLUGINS.length}`,
          `Modo mantenimiento: ${A(ctx).maintenance().enabled ? 'activado' : 'desactivado'}`,
        ].join('\n');
      },
    },
    {
      name: 'statsbot',
      aliases: ['estadisticasbot'],
      description: 'Estadísticas de uso reales del bot: usuarios, grupos, equipos, partidas, torneos, scrims, juegos y actividad acumulada.',
      usage: 'statsbot',
      example: 'statsbot',
      category: 'owner',
      permissions: 'OWNER',
      cooldown: 10,
      async handler(ctx) {
        const { db } = ctx.services;
        const c = db.stats();
        const users = db.values('users');
        const messages = users.reduce((n, u) => n + (u.activity?.messages || 0), 0);
        const commands = users.reduce((n, u) => n + (u.activity?.commands || 0), 0);
        return [
          '📊 *Estadísticas del bot*',
          `Usuarios: ${formatNumber(c.users)} · Grupos con datos: ${formatNumber(c.groups)} · Clanes: ${formatNumber(c.clans)}`,
          `Equipos: ${formatNumber(c.teams)} · Partidas: ${formatNumber(c.matches)} · Torneos: ${formatNumber(c.tournaments)} · Scrims: ${formatNumber(c.scrims)} · Juegos: ${formatNumber(c.games)}`,
          `Actividad acumulada de usuarios registrados: ${formatNumber(messages)} mensajes · ${formatNumber(commands)} comandos`,
          `Registros de auditoría: ${formatNumber(c.logs)}`,
        ].join('\n');
      },
    },
    {
      name: 'botstatus',
      aliases: ['estadobot'],
      description: 'Estado en vivo del bot: conexión de WhatsApp, scheduler, memoria y modo mantenimiento.',
      usage: 'botstatus',
      example: 'botstatus',
      category: 'owner',
      permissions: 'OWNER',
      cooldown: 5,
      async handler(ctx) {
        const { wa, scheduler, startedAt } = ctx.services;
        const mem = process.memoryUsage();
        const st = scheduler.stats();
        const maint = A(ctx).maintenance();
        return [
          '🩺 *Estado del bot*',
          `WhatsApp: ${wa?.state || 'desconocido'}${wa?.selfNumber ? ` (${wa.selfNumber})` : ''}${wa?.connectedAt ? ` · conectado desde ${new Date(wa.connectedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC` : ''}`,
          `Reconexiones: ${wa?.backoff?.attempts ?? 0}`,
          `Scheduler: ${st.pending} pendientes · ${st.done} hechos · ${st.failed} fallidos · ${st.missed} perdidos · ${st.interrupted} interrumpidos`,
          `Memoria: ${(mem.rss / 1048576).toFixed(1)} MB (heap ${(mem.heapUsed / 1048576).toFixed(1)} MB)`,
          startedAt ? `En marcha: ${duration((Date.now() - startedAt) / 1000)}` : null,
          `Mantenimiento: ${maint.enabled ? `🛠️ activado${maint.reason ? ` (${plain(maint.reason)})` : ''}` : 'no'}`,
        ].filter(Boolean).join('\n');
      },
    },
    {
      name: 'uptime',
      aliases: ['tiempoactivo'],
      description: 'Tiempo que lleva el bot en marcha (proceso) y desde cuándo está conectado a WhatsApp.',
      usage: 'uptime',
      example: 'uptime',
      category: 'owner',
      permissions: 'OWNER',
      cooldown: 3,
      async handler(ctx) {
        const { wa, startedAt } = ctx.services;
        return [`⏱️ En marcha: ${duration((Date.now() - (startedAt || Date.now())) / 1000)}`, wa?.connectedAt ? `🔌 Conectado a WhatsApp hace ${duration((Date.now() - wa.connectedAt) / 1000)}` : '🔌 Sin conexión a WhatsApp registrada.'].join('\n');
      },
    },
    {
      name: 'grupos',
      aliases: ['listagrupos'],
      description: 'Lista los grupos en los que el bot está presente ahora (consultados a WhatsApp), con miembros y si puede escribir.',
      usage: 'grupos',
      example: 'grupos',
      category: 'owner',
      permissions: 'OWNER',
      cooldown: 10,
      async handler(ctx) {
        const list = await A(ctx).listGroups();
        if (!list.length) return 'ℹ️ El bot no está en ningún grupo.';
        const rows = list.slice(0, 40).map((g, i) => `${i + 1}. ${plain(g.name)} — ${g.size} miembros · ${g.botAdmin ? 'bot admin' : 'bot no admin'}${g.canSend ? '' : ' · ⛔ no puede escribir'}`);
        return [`👥 *Grupos del bot (${list.length})*`, ...rows, list.length > 40 ? `… y ${list.length - 40} más` : null, `Detalle: *${ctx.prefix}grupoinfo NÚMERO*`].filter(Boolean).join('\n');
      },
    },
    {
      name: 'grupoinfo',
      aliases: ['infogrupobot'],
      description: 'Detalle de un grupo de la lista de *grupos* (por número) o por su ID: miembros, admins, permisos del bot, clan y protecciones.',
      usage: 'grupoinfo NÚMERO|ID',
      example: 'grupoinfo 1',
      category: 'owner',
      permissions: 'OWNER',
      cooldown: 5,
      async handler(ctx) {
        const arg = ctx.args[0];
        if (!arg) throw usage(ctx, 'grupoinfo NÚMERO|ID');
        const list = await A(ctx).listGroups();
        const g = /^\d{1,3}$/.test(arg) ? list[Number(arg) - 1] : list.find((x) => x.id === jid.normalize(arg));
        if (!g) throw new UserError('NO_GROUP', 'No encontré ese grupo entre los que el bot tiene ahora. Mira *' + ctx.prefix + 'grupos*.');
        const meta = await ctx.services.groups.meta(g.id, { fresh: true }).catch(() => null);
        const parts = meta?.participants || [];
        const m = ctx.services.groups.peek(g.id);
        const clan = ctx.services.clans.clanOfGroup(g.id);
        return [
          `👥 *${plain(g.name)}*`,
          `ID: ${g.id}`,
          `Miembros: ${g.size} · Administradores: ${parts.filter((p) => p.admin).length || 'desconocido'}`,
          `Bot administrador: ${g.botAdmin ? 'sí' : 'no'} · Puede escribir: ${g.canSend ? 'sí' : 'no'}${g.announce ? ' (solo admins escriben)' : ''}`,
          `Clan: ${clan ? plain(clan.name || clan.id) : 'sin clan verificado'}`,
          m ? `Protecciones: antilinks ${m.antilinks ? 'sí' : 'no'} · antispam ${m.antispam ? 'sí' : 'no'} · antiflood ${m.antiflood ? 'sí' : 'no'} · advertidos: ${Object.keys(m.warns).length} · silenciados: ${ctx.services.groups.activeMutes(g.id).length}` : 'Sin configuración de moderación guardada.',
        ].join('\n');
      },
    },
    {
      name: 'broadcast',
      aliases: ['difusion', 'anuncio'],
      description: 'Anuncio a todos los grupos donde el bot puede escribir. Primero muestra una vista previa; se envía con "broadcast confirmar" (vence en 2 min).',
      usage: 'broadcast TEXTO',
      example: 'broadcast Mañana hay mantenimiento a las 20:00',
      category: 'owner',
      permissions: 'OWNER',
      cooldown: 5,
      subcommands: broadcastSubs,
      async handler(ctx) {
        const text = ctx.args.join(' ');
        if (!text) throw usage(ctx, 'broadcast TEXTO');
        const p = await A(ctx).prepareBroadcast(text, ctx.sender);
        return [
          '📢 *Vista previa del anuncio*',
          '',
          plain(p.text),
          '',
          `Llegaría a ${p.targets} de ${p.total} grupos${p.skipped ? ` (${p.skipped} omitidos: el bot no puede escribir en ellos)` : ''}.`,
          `Para enviarlo: *${ctx.prefix}broadcast confirmar* · Para descartarlo: *${ctx.prefix}broadcast cancelar*`,
        ].join('\n');
      },
    },
    {
      name: 'backup',
      aliases: ['respaldar'],
      description: 'Crea ahora una copia de seguridad de la base de datos.',
      usage: 'backup',
      example: 'backup',
      category: 'owner',
      permissions: 'OWNER',
      cooldown: 30,
      async handler(ctx) {
        let name;
        try {
          name = ctx.services.db.backup('manual');
        } catch (err) {
          ctx.services.logger.error('Falló el backup manual', err);
          throw new UserError('BACKUP_FAILED', '❌ No se pudo crear el backup. Revisa el espacio en disco y los permisos de la carpeta de backups.');
        }
        require('../../services/common').audit(ctx.services.db, { scope: 'admin', ref: name, actor: ctx.sender, action: 'backup', at: Date.now() });
        return `💾 Backup creado: ${name}`;
      },
    },
    {
      name: 'backups',
      aliases: ['listabackups'],
      description: 'Lista los backups disponibles (los más recientes primero).',
      usage: 'backups',
      example: 'backups',
      category: 'owner',
      permissions: 'OWNER',
      cooldown: 5,
      async handler(ctx) {
        const list = ctx.services.db.listBackups();
        if (!list.length) return 'ℹ️ Todavía no hay backups.';
        return ['💾 *Backups* (más recientes primero)', ...list.slice(0, 10).map((b, i) => `${i + 1}. ${b.name} — ${Math.max(1, Math.round(b.size / 1024))} KB`), list.length > 10 ? `… y ${list.length - 10} más` : null, `Restaurar: *${ctx.prefix}restore NÚMERO confirmar*`].filter(Boolean).join('\n');
      },
    },
    {
      name: 'restore',
      aliases: ['restaurar'],
      description: 'Restaura un backup (por número de la lista de *backups* o por nombre). Hace antes un backup "prerestore" y exige escribir "confirmar".',
      usage: 'restore NÚMERO|NOMBRE confirmar',
      example: 'restore 1 confirmar',
      category: 'owner',
      permissions: 'OWNER',
      cooldown: 10,
      async handler(ctx) {
        const ref = ctx.args[0];
        if (!ref) throw usage(ctx, 'restore NÚMERO|NOMBRE confirmar');
        const list = ctx.services.db.listBackups();
        const name = /^\d{1,3}$/.test(ref) ? list[Number(ref) - 1]?.name : ref;
        if (!name || !list.some((b) => b.name === name)) throw new UserError('NO_BACKUP', `No encontré ese backup. Mira la lista con *${ctx.prefix}backups*.`);
        if ((ctx.args[1] || '').toLowerCase() !== 'confirmar') return `⚠️ Vas a reemplazar TODOS los datos actuales por el backup ${name}. Se guardará antes un backup "prerestore".\nConfirma con: *${ctx.prefix}restore ${ref} confirmar*`;
        try {
          ctx.services.db.restore(name);
        } catch (err) {
          throw new UserError('RESTORE_FAILED', `❌ No se pudo restaurar: ${plain(err.message)}`);
        }
        ctx.services.groups?.invalidateAll();
        require('../../services/common').audit(ctx.services.db, { scope: 'admin', ref: name, actor: ctx.sender, action: 'restore', at: Date.now() });
        return `✅ Backup ${name} restaurado. Recomendado: reinicia el bot (por ejemplo "pm2 restart") para que todos los módulos y trabajos programados partan del estado restaurado.`;
      },
    },
    {
      name: 'reload',
      aliases: ['recargar'],
      description: 'Vacía las cachés (grupos y APIs), vuelve a sincronizar los trabajos programados con la base de datos y guarda los datos. No recarga código ni .env (para eso, reinicia el bot).',
      usage: 'reload',
      example: 'reload',
      category: 'owner',
      permissions: 'OWNER',
      cooldown: 15,
      async handler(ctx) {
        const s = ctx.services;
        s.groups?.invalidateAll();
        s.dispatcher?.groupCache?.clear();
        s.ff?.cache?.clear?.();
        s.clanApi?.cache?.clear?.();
        const synced = [];
        for (const [name, svc] of Object.entries({ gdc: s.gdc, teams: s.teams, matches: s.matches, games: s.games, tournaments: s.tournaments, scrims: s.scrims })) {
          if (svc && typeof svc.syncAll === 'function') {
            try {
              svc.syncAll();
              synced.push(name);
            } catch (err) {
              s.logger.error(`reload: falló la sincronización de ${name}`, err);
            }
          }
        }
        s.db.flush();
        return `🔄 Recargado: cachés vaciadas, trabajos sincronizados (${synced.join(', ') || 'ninguno'}) y datos guardados. Cambios de código o de .env requieren reiniciar.`;
      },
    },
    {
      name: 'plugins',
      aliases: ['listaplugins'],
      description: 'Lista los plugins cargados y cuántos comandos aporta cada uno.',
      usage: 'plugins',
      example: 'plugins',
      category: 'owner',
      permissions: 'OWNER',
      cooldown: 5,
      async handler(ctx) {
        const { PLUGINS } = require('../index');
        return ['🧩 *Plugins cargados*', ...PLUGINS.map((p) => `• ${p.name} — ${p.build().length} comandos`)].join('\n');
      },
    },
    {
      name: 'plugininfo',
      aliases: ['infoplugin'],
      description: 'Detalle de un plugin: sus comandos y permisos requeridos.',
      usage: 'plugininfo NOMBRE',
      example: 'plugininfo equipos',
      category: 'owner',
      permissions: 'OWNER',
      cooldown: 5,
      async handler(ctx) {
        const { PLUGINS } = require('../index');
        const name = (ctx.args[0] || '').toLowerCase();
        if (!name) throw usage(ctx, 'plugininfo NOMBRE');
        const p = PLUGINS.find((x) => x.name === name);
        if (!p) throw new UserError('NO_PLUGIN', `No existe el plugin "${plain(name)}". Mira la lista con *${ctx.prefix}plugins*.`);
        return [`🧩 *Plugin ${p.name}*`, ...p.build().map((c) => `• ${ctx.prefix}${c.name} [${c.permissions}] — ${c.description}`)].join('\n');
      },
    },
    {
      name: 'mantenimiento',
      aliases: ['maintenance'],
      description: 'Activa o desactiva el modo mantenimiento: mientras está activo, solo el OWNER puede usar comandos.',
      usage: 'mantenimiento on|off [motivo]',
      example: 'mantenimiento on actualizando',
      category: 'owner',
      permissions: 'OWNER',
      cooldown: 3,
      async handler(ctx) {
        const arg = (ctx.args[0] || '').toLowerCase();
        if (!arg) {
          const m = A(ctx).maintenance();
          return m.enabled ? `🛠️ Mantenimiento activado${m.reason ? `: ${plain(m.reason)}` : ''}.` : '🟢 Mantenimiento desactivado.';
        }
        if (!['on', 'off'].includes(arg)) throw usage(ctx, 'mantenimiento on|off [motivo]');
        A(ctx).setMaintenance(arg === 'on', { by: ctx.sender, reason: ctx.args.slice(1).join(' ') });
        return arg === 'on' ? '🛠️ Modo mantenimiento activado: solo tú puedes usar comandos.' : '🟢 Modo mantenimiento desactivado.';
      },
    },
    {
      name: 'banuser',
      aliases: ['banear'],
      description: 'Banea a una persona del bot: no podrá usar comandos y el bot ignorará sus mensajes en todos los grupos.',
      usage: 'banuser @usuario|número [motivo]',
      example: 'banuser @usuario spam',
      category: 'owner',
      permissions: 'OWNER',
      cooldown: 3,
      async handler(ctx) {
        const target = personArg(ctx, 'banuser @usuario|número [motivo]');
        const reason = ctx.args.filter((a) => !a.startsWith('@') && !/^\+?\d{8,15}$/.test(a)).join(' ');
        const perms = ctx.services.permissions;
        if (perms.isOwner([target])) throw new UserError('TARGET_OWNER', 'No se puede banear al OWNER.');
        if (perms.resolve([target]).banned) throw new UserError('ALREADY', 'Esa persona ya está baneada.');
        perms.setBanned(target, true, { by: ctx.sender, reason });
        require('../../services/common').audit(ctx.services.db, { scope: 'admin', ref: target, actor: ctx.sender, action: 'banuser', detail: reason, at: Date.now() });
        return { text: `🚫 ${tag(target)} fue baneado del bot${reason ? `: ${plain(reason)}` : ''}.`, mentions: [target] };
      },
    },
    {
      name: 'unbanuser',
      aliases: ['desbanear'],
      description: 'Quita el baneo del bot a una persona.',
      usage: 'unbanuser @usuario|número',
      example: 'unbanuser @usuario',
      category: 'owner',
      permissions: 'OWNER',
      cooldown: 3,
      async handler(ctx) {
        const target = personArg(ctx, 'unbanuser @usuario|número');
        const perms = ctx.services.permissions;
        if (!perms.resolve([target]).banned) throw new UserError('NOT_BANNED', 'Esa persona no está baneada.');
        perms.setBanned(target, false, { by: ctx.sender });
        require('../../services/common').audit(ctx.services.db, { scope: 'admin', ref: target, actor: ctx.sender, action: 'unbanuser', at: Date.now() });
        return { text: `✅ ${tag(target)} ya no está baneado.`, mentions: [target] };
      },
    },
    setRoleCommand({ name: 'addadmin', role: 'ADMIN' }),
    setRoleCommand({ name: 'deladmin', role: 'ADMIN', remove: true }),
    setRoleCommand({ name: 'addmod', role: 'MOD' }),
    setRoleCommand({ name: 'delmod', role: 'MOD', remove: true }),
    {
      name: 'dbstats',
      aliases: ['estadisticasdb'],
      description: 'Estadísticas de la base de datos: registros por colección, tamaño del archivo y backups.',
      usage: 'dbstats',
      example: 'dbstats',
      category: 'owner',
      permissions: 'OWNER',
      cooldown: 10,
      async handler(ctx) {
        const { db } = ctx.services;
        const counts = db.stats();
        let size = 0;
        try {
          size = require('node:fs').statSync(db.file).size;
        } catch { /* sin archivo todavía */ }
        const rows = Object.entries(counts).filter(([, n]) => n > 0).map(([k, n]) => `${k}: ${formatNumber(n)}`);
        return ['🗄️ *Base de datos*', `Archivo: ${Math.max(1, Math.round(size / 1024))} KB · Backups: ${db.listBackups().length}`, rows.join(' · ') || 'vacía'].join('\n');
      },
    },
    {
      name: 'apistatus',
      aliases: ['estadoapis'],
      description: 'Estado de los servicios externos (Free Fire, clanes y medios). Los usuarios ven un resumen; ADMIN/OWNER ven cada proveedor (nunca claves ni URLs). "apistatus probar" (ADMIN) verifica los proveedores ahora.',
      usage: 'apistatus [probar]',
      example: 'apistatus',
      category: 'tools',
      permissions: 'USER',
      cooldown: 5,
      async handler(ctx) {
        const { apiStatusText, probeAll } = require('../../utils/apistatus');
        const role = (await ctx.getRole()).role;
        const detailed = roleLevel(role) >= roleLevel('ADMIN');
        let note = '';
        if (/^(probar|check|test)$/i.test(ctx.args[0] || '')) {
          if (!detailed) throw new UserError('FORBIDDEN', '🚫 Solo ADMIN u OWNER pueden verificar los proveedores.');
          const n = await probeAll(ctx.services);
          note = n.checked ? `🔎 Verificados ${n.checked} proveedor(es) ahora.` : 'ℹ️ No hay identificador de prueba (FF_HEALTH_UID / CLAN_HEALTH_ID / MEDIA_HEALTH_QUERY): nada que verificar.';
        }
        return [apiStatusText(ctx.services, { detailed }), note].filter(Boolean).join('\n');
      },
    },
    {
      name: 'logs',
      aliases: ['auditoria'],
      description: 'Últimos registros de auditoría (acciones administrativas). Se puede filtrar por ámbito: moderacion, admin, equipo, torneo, elo…',
      usage: 'logs [cantidad] [ámbito]',
      example: 'logs 10 admin',
      category: 'owner',
      permissions: 'OWNER',
      cooldown: 5,
      async handler(ctx) {
        const num = ctx.args.find((a) => /^\d+$/.test(a));
        const scope = ctx.args.find((a) => /^[a-z]+$/i.test(a));
        const n = num ? Number(num) : 15;
        if (n < 1 || n > 40) throw usage(ctx, 'logs [1-40] [ámbito]');
        const logs = ctx.services.db.col('logs').filter((l) => !scope || l.scope === scope.toLowerCase()).slice(-n).reverse();
        if (!logs.length) return 'ℹ️ No hay registros que coincidan.';
        return [`📋 *Auditoría* (últimos ${logs.length})`, ...logs.map((l) => `• ${l.at.slice(0, 16).replace('T', ' ')} [${l.scope}] ${l.action}${l.ref ? ` ${plain(String(l.ref).slice(0, 30))}` : ''}${l.detail ? ` — ${plain(l.detail.slice(0, 80))}` : ''}`)].join('\n');
      },
    },
    {
      name: 'errors',
      aliases: ['errores'],
      description: 'Últimos errores registrados por el bot desde que arrancó (sin trazas ni datos sensibles).',
      usage: 'errors [cantidad]',
      example: 'errors 10',
      category: 'owner',
      permissions: 'OWNER',
      cooldown: 5,
      async handler(ctx) {
        const n = ctx.args[0] ? Math.floor(Number(ctx.args[0])) : 10;
        if (!Number.isFinite(n) || n < 1 || n > 30) throw usage(ctx, 'errors [1-30]');
        const logger = ctx.services.logger;
        const list = typeof logger.recent === 'function' ? logger.recent('ERROR', n) : [];
        if (!list.length) return '✅ No hay errores registrados desde el último arranque.';
        return [`🛑 *Errores recientes* (${list.length})`, ...list.reverse().map((e) => `• ${e.time.slice(11, 19)} [${e.scope}] ${plain(e.msg)}${e.error ? ` — ${plain(e.error)}` : ''}`)].join('\n');
      },
    },
  ];
}

module.exports = { name: 'owner', build, duration };
