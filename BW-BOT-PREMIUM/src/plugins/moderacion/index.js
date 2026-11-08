'use strict';

const jid = require('../../whatsapp/jid');
const { UserError } = require('../../services/users');
const { hasRole, roleLevel } = require('../../middleware/permissions');
const { plain } = require('../../utils/text');
const { targetJid, textArgs, tag } = require('../shared');
const { MUTE_DEFAULT_MIN, MUTE_MAX_MIN } = require('../../services/groups');

const G = (ctx) => ctx.services.groups;
const usage = (ctx, text) => new UserError('USAGE', `Uso: *${ctx.prefix}${text}*`);
const CHUNK = 60;
const onOff = (v) => (v ? '🟢 activado' : '🔴 desactivado');

function needTarget(ctx, text) {
  const t = targetJid(ctx);
  if (!t) throw usage(ctx, `${text} (menciona a la persona o responde a su mensaje)`);
  return t;
}

/** Quién puede ser sancionado: nunca el bot, el OWNER, un admin del grupo ni alguien con un rol igual o superior. */
async function guardTarget(ctx, target) {
  if (G(ctx).isSelf(target)) throw new UserError('TARGET_SELF', 'No puedo aplicarme una sanción a mí mismo.');
  const t = ctx.services.permissions.resolve([target]);
  const me = await ctx.getRole();
  if (t.role === 'OWNER') throw new UserError('TARGET_OWNER', 'No se puede sancionar al OWNER del bot.');
  if (await G(ctx).isAdmin(ctx.chatJid, target)) throw new UserError('TARGET_ADMIN', 'No se puede sancionar a un administrador del grupo.');
  if (roleLevel(t.role) >= roleLevel('MOD') && roleLevel(t.role) >= roleLevel(me.role)) throw new UserError('TARGET_ROLE', 'Esa persona tiene un rol igual o superior al tuyo.');
}

const nameOf = (ctx, j) => plain(ctx.services.users.find([j])?.name || tag(j));

function configText(ctx) {
  const m = G(ctx).mod(ctx.chatJid);
  return [
    '⚙️ *Configuración del grupo*',
    `• Antilinks: ${onOff(m.antilinks)}`,
    `• Antispam: ${onOff(m.antispam)} (${m.spamRepeat} mensajes iguales en ${m.spamWindowSec} s)`,
    `• Antiflood: ${onOff(m.antiflood)} (más de ${m.floodMax} mensajes en ${m.floodWindowSec} s)`,
    `• Advertencias máximas: ${m.maxWarns} → al llegar: ${m.warnAction === 'kick' ? 'expulsar (si el bot es admin)' : 'solo avisar'}`,
    `• Bienvenida: ${onOff(m.welcome.enabled)} · Despedida: ${onOff(m.goodbye.enabled)}`,
    `• Silenciados ahora: ${G(ctx).activeMutes(ctx.chatJid).length}`,
  ].join('\n');
}

/** Interruptor on/off de una protección que necesita que el bot sea admin para borrar mensajes. */
function protection({ name, feature, description, extra }) {
  return {
    name,
    description,
    usage: `${name} on|off${extra ? ` ${extra.usage}` : ''}`,
    example: `${name} on`,
    category: 'moderacion',
    permissions: 'ADMIN',
    scope: 'group',
    cooldown: 3,
    async handler(ctx) {
      const m = G(ctx).mod(ctx.chatJid);
      const arg = (ctx.args[0] || '').toLowerCase();
      if (!arg) return `🛡️ ${name}: ${onOff(m[feature])}${extra ? ` (${extra.show(m)})` : ''}\nUsa *${ctx.prefix}${name} on|off*.`;
      if (!['on', 'off'].includes(arg)) throw usage(ctx, `${name} on|off${extra ? ` ${extra.usage}` : ''}`);
      const by = ctx.sender;
      if (arg === 'off') {
        G(ctx).setFeature(ctx.chatJid, feature, false, by);
        return `🔴 ${name} desactivado.`;
      }
      await G(ctx).requireBotAdmin(ctx.chatJid, `activar ${name}`);
      if (extra && ctx.args.length > 1) extra.apply(ctx, by);
      G(ctx).setFeature(ctx.chatJid, feature, true, by);
      return `🟢 ${name} activado${extra ? ` (${extra.show(G(ctx).mod(ctx.chatJid))})` : ''}. Los administradores y moderadores quedan exentos.`;
    },
  };
}

function messageCommand(kind, label) {
  const name = kind;
  return {
    name,
    description: `Configura el mensaje de ${label} del grupo: actívalo/desactívalo o cambia el texto ({usuario}, {grupo}, {miembros}).`,
    usage: `${name} on|off|texto MENSAJE|ver`,
    example: `${name} texto Bienvenido {usuario} a {grupo}`,
    category: 'moderacion',
    permissions: 'ADMIN',
    scope: 'group',
    cooldown: 3,
    async handler(ctx) {
      const arg = (ctx.args[0] || 'ver').toLowerCase();
      const slot = G(ctx).mod(ctx.chatJid)[kind];
      if (arg === 'ver') return `👋 ${label[0].toUpperCase()}${label.slice(1)}: ${onOff(slot.enabled)}\nTexto: ${plain(slot.text || '(por defecto)')}`;
      if (arg === 'on' || arg === 'off') {
        G(ctx).setMessage(ctx.chatJid, kind, { enabled: arg === 'on' }, ctx.sender);
        return `${arg === 'on' ? '🟢' : '🔴'} ${label[0].toUpperCase()}${label.slice(1)} ${arg === 'on' ? 'activada' : 'desactivada'}.`;
      }
      if (arg === 'texto') {
        const text = ctx.args.slice(1).join(' ');
        if (!text) throw usage(ctx, `${name} texto MENSAJE`);
        G(ctx).setMessage(ctx.chatJid, kind, { text }, ctx.sender);
        return `✅ Texto de ${label} actualizado. Vista previa:\n${G(ctx).render(kind, ctx.chatJid, [ctx.sender], await G(ctx).meta(ctx.chatJid).catch(() => null))}`;
      }
      throw usage(ctx, `${name} on|off|texto MENSAJE|ver`);
    },
  };
}

const configSubs = [
  {
    name: 'maxwarns',
    description: 'Cantidad de advertencias a partir de la cual se aplica la acción configurada (1 a 10).',
    usage: 'grupoconfig maxwarns N',
    permissions: 'ADMIN',
    scope: 'group',
    async handler(ctx) {
      if (!ctx.args[0]) throw usage(ctx, 'grupoconfig maxwarns N');
      const n = G(ctx).setNumber(ctx.chatJid, 'maxWarns', ctx.args[0], { min: 1, max: 10, by: ctx.sender });
      return `✅ Advertencias máximas: ${n}.`;
    },
  },
  {
    name: 'warnaccion',
    description: 'Qué pasa al llegar al máximo de advertencias: nada (solo avisa) o kick (expulsa; requiere que el bot sea admin).',
    usage: 'grupoconfig warnaccion nada|kick',
    permissions: 'ADMIN',
    scope: 'group',
    async handler(ctx) {
      const a = (ctx.args[0] || '').toLowerCase();
      if (!a) throw usage(ctx, 'grupoconfig warnaccion nada|kick');
      if (a === 'kick') await G(ctx).requireBotAdmin(ctx.chatJid, 'expulsar por advertencias');
      G(ctx).setWarnAction(ctx.chatJid, a, ctx.sender);
      return a === 'kick' ? '✅ Al llegar al máximo se expulsará a la persona (si el bot sigue siendo admin).' : '✅ Al llegar al máximo solo se avisará en el grupo.';
    },
  },
  {
    name: 'flood',
    description: 'Límite del antiflood: MENSAJES (2-30) permitidos en SEGUNDOS (2-60).',
    usage: 'grupoconfig flood MENSAJES SEGUNDOS',
    permissions: 'ADMIN',
    scope: 'group',
    async handler(ctx) {
      if (ctx.args.length < 2) throw usage(ctx, 'grupoconfig flood MENSAJES SEGUNDOS');
      const n = G(ctx).setNumber(ctx.chatJid, 'floodMax', ctx.args[0], { min: 2, max: 30, by: ctx.sender });
      const s = G(ctx).setNumber(ctx.chatJid, 'floodWindowSec', ctx.args[1], { min: 2, max: 60, by: ctx.sender });
      return `✅ Antiflood: más de ${n} mensajes en ${s} s se borran.`;
    },
  },
  {
    name: 'spam',
    description: 'Límite del antispam: REPETICIONES (2-10) del mismo mensaje en SEGUNDOS (5-300).',
    usage: 'grupoconfig spam REPETICIONES SEGUNDOS',
    permissions: 'ADMIN',
    scope: 'group',
    async handler(ctx) {
      if (ctx.args.length < 2) throw usage(ctx, 'grupoconfig spam REPETICIONES SEGUNDOS');
      const n = G(ctx).setNumber(ctx.chatJid, 'spamRepeat', ctx.args[0], { min: 2, max: 10, by: ctx.sender });
      const s = G(ctx).setNumber(ctx.chatJid, 'spamWindowSec', ctx.args[1], { min: 5, max: 300, by: ctx.sender });
      return `✅ Antispam: ${n} mensajes iguales en ${s} s se borran.`;
    },
  },
];

function build() {
  return [
    {
      name: 'warn',
      aliases: ['advertir'],
      description: 'Pone una advertencia a una persona del grupo (mención o respuesta). Al llegar al máximo se aplica la acción configurada.',
      usage: 'warn @usuario [motivo]',
      example: 'warn @usuario insultos',
      category: 'moderacion',
      permissions: 'MOD',
      scope: 'group',
      cooldown: 3,
      async handler(ctx) {
        const target = needTarget(ctx, 'warn @usuario [motivo]');
        await guardTarget(ctx, target);
        const reason = textArgs(ctx).slice(0, 100);
        const w = G(ctx).addWarn(ctx.chatJid, target, { by: ctx.sender, reason });
        let extra = '';
        if (w.reached) {
          const r = await G(ctx).applyWarnLimit(ctx.chatJid, target, ctx.sender);
          extra = r.kicked ? '\n🚪 Llegó al máximo y fue expulsado.' : r.error ? `\n⚠️ Llegó al máximo, pero: ${r.error}` : '\n⚠️ Llegó al máximo de advertencias.';
        }
        return { text: `⚠️ ${tag(target)} recibió la advertencia ${w.count}/${w.max}: ${plain(w.warn.reason)} (${w.warn.id}).${extra}`, mentions: [target] };
      },
    },
    {
      name: 'unwarn',
      aliases: ['quitarwarn'],
      description: 'Quita la última advertencia de una persona (o una concreta por su ID, por ejemplo W-0007).',
      usage: 'unwarn @usuario [ID]',
      example: 'unwarn @usuario',
      category: 'moderacion',
      permissions: 'MOD',
      scope: 'group',
      cooldown: 3,
      async handler(ctx) {
        const target = needTarget(ctx, 'unwarn @usuario [ID]');
        const id = ctx.args.find((a) => /^W-\d+$/i.test(a));
        const r = G(ctx).removeWarn(ctx.chatJid, target, { by: ctx.sender, id: id ? id.toUpperCase() : null });
        return { text: `✅ Se quitó la advertencia ${r.removed.id} a ${tag(target)}. Le quedan ${r.left}.`, mentions: [target] };
      },
    },
    {
      name: 'warns',
      aliases: ['advertencias'],
      description: 'Muestra tus advertencias en este grupo o las de otra persona mencionada.',
      usage: 'warns [@usuario]',
      example: 'warns',
      category: 'moderacion',
      permissions: 'USER',
      scope: 'group',
      cooldown: 4,
      async handler(ctx) {
        const target = targetJid(ctx) || ctx.sender;
        const list = G(ctx).warnsOf(ctx.chatJid, target);
        const max = G(ctx).mod(ctx.chatJid).maxWarns;
        if (!list.length) return { text: `✅ ${tag(target)} no tiene advertencias en este grupo.`, mentions: [target] };
        return { text: [`⚠️ Advertencias de ${tag(target)} (${list.length}/${max}):`, ...list.map((w) => `• ${w.id} · ${w.at.slice(0, 10)} · ${plain(w.reason)}`)].join('\n'), mentions: [target] };
      },
    },
    {
      name: 'warnlist',
      aliases: ['listawarns'],
      description: 'Lista las personas con advertencias en este grupo.',
      usage: 'warnlist',
      example: 'warnlist',
      category: 'moderacion',
      permissions: 'MOD',
      scope: 'group',
      cooldown: 5,
      async handler(ctx) {
        const list = G(ctx).warnList(ctx.chatJid).slice(0, 20);
        if (!list.length) return '✅ Nadie tiene advertencias en este grupo.';
        const max = G(ctx).mod(ctx.chatJid).maxWarns;
        return { text: ['⚠️ *Advertencias del grupo*', ...list.map((w) => `• ${tag(w.jid)} — ${w.count}/${max} · último: ${plain(w.last.reason)}`)].join('\n'), mentions: list.map((w) => w.jid) };
      },
    },
    {
      name: 'mute',
      aliases: ['silenciar'],
      description: 'Silencia a una persona: el bot borra sus mensajes durante unos minutos (por defecto 30). Requiere que el bot sea administrador.',
      usage: 'mute @usuario [minutos] [motivo]',
      example: 'mute @usuario 15 spam',
      category: 'moderacion',
      permissions: 'MOD',
      scope: 'group',
      cooldown: 3,
      async handler(ctx) {
        const target = needTarget(ctx, 'mute @usuario [minutos] [motivo]');
        const words = ctx.args.filter((a) => !a.startsWith('@'));
        const minutes = /^\d+$/.test(words[0] || '') ? Number(words[0]) : MUTE_DEFAULT_MIN;
        const reason = (/^\d+$/.test(words[0] || '') ? words.slice(1) : words).join(' ');
        await G(ctx).requireBotAdmin(ctx.chatJid, 'silenciar a alguien (necesito borrar sus mensajes)');
        await guardTarget(ctx, target);
        if (minutes < 1 || minutes > MUTE_MAX_MIN) throw new UserError('BAD_MINUTES', `Los minutos deben estar entre 1 y ${MUTE_MAX_MIN} (7 días).`);
        G(ctx).mute(ctx.chatJid, target, { minutes, by: ctx.sender, reason });
        return { text: `🔇 ${tag(target)} fue silenciado ${minutes} min${reason ? `: ${plain(reason)}` : ''}. Sus mensajes se borrarán.`, mentions: [target] };
      },
    },
    {
      name: 'unmute',
      aliases: ['desilenciar'],
      description: 'Quita el silencio a una persona del grupo.',
      usage: 'unmute @usuario',
      example: 'unmute @usuario',
      category: 'moderacion',
      permissions: 'MOD',
      scope: 'group',
      cooldown: 3,
      async handler(ctx) {
        const target = needTarget(ctx, 'unmute @usuario');
        G(ctx).unmute(ctx.chatJid, target, { by: ctx.sender });
        return { text: `🔊 ${tag(target)} ya puede escribir de nuevo.`, mentions: [target] };
      },
    },
    protection({ name: 'antilinks', feature: 'antilinks', description: 'Borra los mensajes con enlaces de quien no sea administrador y le pone una advertencia. Requiere que el bot sea administrador.' }),
    protection({
      name: 'antispam',
      feature: 'antispam',
      description: 'Borra los mensajes repetidos de quien no sea administrador y le pone una advertencia. Requiere que el bot sea administrador.',
      extra: {
        usage: '[repeticiones [segundos]]',
        show: (m) => `${m.spamRepeat} iguales en ${m.spamWindowSec} s`,
        apply: (ctx, by) => {
          G(ctx).setNumber(ctx.chatJid, 'spamRepeat', ctx.args[1], { min: 2, max: 10, by });
          if (ctx.args[2]) G(ctx).setNumber(ctx.chatJid, 'spamWindowSec', ctx.args[2], { min: 5, max: 300, by });
        },
      },
    }),
    protection({
      name: 'antiflood',
      feature: 'antiflood',
      description: 'Borra los mensajes de quien escribe demasiado rápido (no administradores) y le pone una advertencia. Requiere que el bot sea administrador.',
      extra: {
        usage: '[mensajes [segundos]]',
        show: (m) => `más de ${m.floodMax} en ${m.floodWindowSec} s`,
        apply: (ctx, by) => {
          G(ctx).setNumber(ctx.chatJid, 'floodMax', ctx.args[1], { min: 2, max: 30, by });
          if (ctx.args[2]) G(ctx).setNumber(ctx.chatJid, 'floodWindowSec', ctx.args[2], { min: 2, max: 60, by });
        },
      },
    }),
    messageCommand('welcome', 'bienvenida'),
    messageCommand('goodbye', 'despedida'),
    {
      name: 'tagall',
      aliases: ['todos'],
      description: 'Menciona a todos los miembros reales del grupo (según los datos de WhatsApp), con un mensaje opcional.',
      usage: 'tagall [mensaje]',
      example: 'tagall Hoy hay scrim a las 20:00',
      category: 'moderacion',
      permissions: 'ADMIN',
      scope: 'group',
      cooldown: 30,
      async handler(ctx) {
        const meta = await G(ctx).meta(ctx.chatJid, { fresh: true }).catch(() => null);
        const ids = [...new Set((meta?.participants || []).map((p) => jid.normalize(p.id)).filter(Boolean))].filter((j) => !G(ctx).isSelf(j));
        if (!ids.length) throw new UserError('NO_MEMBERS', 'No pude obtener la lista de miembros del grupo.');
        const note = ctx.args.join(' ').slice(0, 300);
        for (let i = 0; i < ids.length; i += CHUNK) {
          const part = ids.slice(i, i + CHUNK);
          const head = i === 0 ? `📣 *Mención general*${note ? `\n${plain(note)}` : ''}\n` : '📣 *(continuación)*\n';
          await ctx.reply(`${head}${part.map((j) => tag(j)).join(' ')}`, { mentions: part });
        }
        return null;
      },
    },
    {
      name: 'hidetag',
      aliases: ['avisar'],
      description: 'Envía tu mensaje mencionando a todos sin mostrar las etiquetas (todos reciben la notificación).',
      usage: 'hidetag MENSAJE',
      example: 'hidetag Reunión en 10 minutos',
      category: 'moderacion',
      permissions: 'ADMIN',
      scope: 'group',
      cooldown: 30,
      async handler(ctx) {
        const text = ctx.args.join(' ').slice(0, 500);
        if (!text) throw usage(ctx, 'hidetag MENSAJE');
        const meta = await G(ctx).meta(ctx.chatJid, { fresh: true }).catch(() => null);
        const ids = [...new Set((meta?.participants || []).map((p) => jid.normalize(p.id)).filter(Boolean))].filter((j) => !G(ctx).isSelf(j));
        if (!ids.length) throw new UserError('NO_MEMBERS', 'No pude obtener la lista de miembros del grupo.');
        await ctx.reply(text, { mentions: ids });
        return null;
      },
    },
    {
      name: 'admins',
      aliases: ['administradores'],
      description: 'Lista los administradores del grupo según WhatsApp y los menciona.',
      usage: 'admins',
      example: 'admins',
      category: 'moderacion',
      permissions: 'USER',
      scope: 'group',
      cooldown: 10,
      async handler(ctx) {
        const meta = await G(ctx).meta(ctx.chatJid).catch(() => null);
        const admins = (meta?.participants || []).filter((p) => p.admin).map((p) => jid.normalize(p.id)).filter(Boolean);
        if (!meta) throw new UserError('NO_META', 'No pude consultar el grupo ahora mismo. Inténtalo de nuevo.');
        if (!admins.length) return 'ℹ️ No encontré administradores en este grupo.';
        return { text: [`👮 *Administradores (${admins.length})*`, ...admins.map((j) => `• ${tag(j)}`)].join('\n'), mentions: admins };
      },
    },
    {
      name: 'groupinfo',
      aliases: ['infogrupo'],
      description: 'Información real del grupo: nombre, miembros, administradores, si el bot es admin, clan y protecciones activas.',
      usage: 'groupinfo',
      example: 'groupinfo',
      category: 'moderacion',
      permissions: 'USER',
      scope: 'group',
      cooldown: 10,
      async handler(ctx) {
        const meta = await G(ctx).meta(ctx.chatJid).catch(() => null);
        if (!meta) throw new UserError('NO_META', 'No pude consultar el grupo ahora mismo. Inténtalo de nuevo.');
        const parts = meta.participants || [];
        const clan = ctx.services.clans.clanOfGroup(ctx.chatJid);
        const m = G(ctx).mod(ctx.chatJid);
        const created = meta.creation ? new Date(Number(meta.creation) * 1000).toISOString().slice(0, 10) : null;
        return [
          `👥 *${plain(meta.subject || 'Grupo')}*`,
          meta.desc ? `📝 ${plain(String(meta.desc).slice(0, 200))}` : null,
          `Miembros: ${parts.length} · Administradores: ${parts.filter((p) => p.admin).length}`,
          created ? `Creado: ${created}` : null,
          meta.announce ? '🔒 Solo los administradores pueden escribir.' : null,
          `Bot administrador: ${(await G(ctx).botIsAdmin(ctx.chatJid)) ? 'sí' : 'no'}`,
          `Clan: ${clan ? plain(clan.name || clan.id) : 'sin clan verificado'}`,
          `Protecciones: antilinks ${m.antilinks ? 'sí' : 'no'} · antispam ${m.antispam ? 'sí' : 'no'} · antiflood ${m.antiflood ? 'sí' : 'no'}`,
        ].filter(Boolean).join('\n');
      },
    },
    {
      name: 'grupoconfig',
      aliases: ['gconfig', 'configgrupo'],
      description: 'Muestra la configuración de moderación del grupo y permite ajustar límites (maxwarns, warnaccion, flood, spam).',
      usage: 'grupoconfig [ajuste]',
      example: 'grupoconfig',
      category: 'moderacion',
      permissions: 'ADMIN',
      scope: 'group',
      cooldown: 3,
      subcommands: configSubs,
      async handler(ctx) {
        if (ctx.args.length) throw new UserError('UNKNOWN_SUB', `Ajuste desconocido "${plain(ctx.args[0])}". Usa *${ctx.prefix}help grupoconfig*.`);
        return configText(ctx);
      },
    },
    {
      name: 'permisos',
      aliases: ['roles'],
      description: 'Muestra tu rol (o el de otra persona mencionada) y si el bot es administrador de este grupo.',
      usage: 'permisos [@usuario]',
      example: 'permisos',
      category: 'moderacion',
      permissions: 'USER',
      scope: 'group',
      cooldown: 5,
      async handler(ctx) {
        const target = targetJid(ctx);
        let role;
        let isAdmin;
        let banned = false;
        if (target) {
          const base = ctx.services.permissions.resolve([target]);
          isAdmin = await G(ctx).isAdmin(ctx.chatJid, target);
          role = isAdmin && !hasRole(base.role, 'ADMIN') ? 'ADMIN' : base.role;
          banned = base.banned;
        } else {
          const r = await ctx.getRole();
          role = r.role;
          isAdmin = await G(ctx).isAdmin(ctx.chatJid, ctx.sender);
          banned = r.banned;
        }
        const botAdmin = await G(ctx).botIsAdmin(ctx.chatJid);
        return {
          text: [
            `🔐 Rol de ${target ? tag(target) : 'tu cuenta'}: *${role}*${isAdmin ? ' (admin del grupo)' : ''}${banned ? ' · 🚫 baneado' : ''}`,
            `🤖 El bot ${botAdmin ? 'es administrador: puede borrar mensajes y expulsar' : 'NO es administrador: no puede borrar mensajes, silenciar ni expulsar'} en este grupo.`,
          ].join('\n'),
          mentions: target ? [target] : [],
        };
      },
    },
    {
      name: 'modlogs',
      aliases: ['logsmod'],
      description: 'Últimas acciones de moderación registradas en este grupo (advertencias, silencios, cambios de configuración).',
      usage: 'modlogs [cantidad]',
      example: 'modlogs 10',
      category: 'moderacion',
      permissions: 'ADMIN',
      scope: 'group',
      cooldown: 5,
      async handler(ctx) {
        const n = ctx.args[0] ? Math.floor(Number(ctx.args[0])) : 10;
        if (!Number.isFinite(n) || n < 1 || n > 30) throw usage(ctx, 'modlogs [1-30]');
        const logs = G(ctx).modLogs(ctx.chatJid, n);
        if (!logs.length) return 'ℹ️ Todavía no hay acciones de moderación registradas en este grupo.';
        return [`📋 *Registro de moderación* (últimas ${logs.length})`, ...logs.map((l) => `• ${l.at.slice(0, 16).replace('T', ' ')} · ${l.action}${l.actor ? ` por ${nameOf(ctx, l.actor)}` : ' (automático)'} — ${plain(l.detail)}`)].join('\n');
      },
    },
  ];
}

module.exports = { name: 'moderacion', build };
