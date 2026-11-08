'use strict';

const jid = require('../../whatsapp/jid');
const time = require('../../utils/time');
const { UserError } = require('../../services/users');
const { hasRole } = require('../../middleware/permissions');
const { plain } = require('../../utils/text');
const { parseInteger } = require('../../utils/validators');
const { OUTCOMES } = require('../../services/gdc');
const { SQUAD_SIZE, NO_CLAN_GDC_TEXT, squadText, platesLine, honorLine, squadCounts, plural, memberLabel } = require('../../services/gdc-messages');

const SQUADS_PER_PAGE = 6;
const HONOR_NOTE = 'ℹ️ El bot NO comprueba el honor de los jugadores: esa validación automática requiere una API compatible y no hay ninguna configurada. Los líderes deben verificarlo manualmente.';

// ---------- utilidades ----------

const svc = (ctx) => ctx.services.gdc;
const needClan = (ctx) => svc(ctx).requireClan(ctx.chatJid);
const isAdmin = async (ctx) => hasRole((await ctx.getRole()).role, 'ADMIN');
const resolveUser = (ctx) => (j) => ctx.services.users.find([j]);
const tag = (j) => jid.mentionTag(j);

function squadNumber(text) {
  const p = parseInteger(text, { min: 1, max: 9999, label: 'El número de escuadra' });
  if (!p.ok) throw new UserError('BAD_NUMBER', p.error);
  return p.value;
}

/** Persona objetivo de un comando: mención o mensaje citado (solo JIDs reales que WhatsApp entregó). */
function targetJid(ctx) {
  return ctx.mentions[0] || ctx.quotedSender || null;
}

function reminderTime(clan) {
  const cfg = clan.config;
  const r = time.nextDailyOccurrence({ hhmm: cfg.gdcTime, tz: 'UTC', afterMs: 0, offsetMinutes: -cfg.reminderMinutes });
  return r.localTime;
}

function mySquadHere(ctx, doc) {
  return ctx.user ? Object.values(doc.squads).find((s) => s.members.includes(ctx.user.jid)) || null : null;
}

function configLines(ctx, clan, doc) {
  const cfg = clan.config;
  const lines = [
    `⚙️ GDC: ${cfg.gdcEnabled ? '*activada*' : '*desactivada*'}`,
    `🕖 Hora de inicio: *${cfg.gdcTime}* (${ctx.config.timezone})`,
    `⏰ Recordatorio: *${cfg.reminderMinutes} min antes* (${reminderTime(clan)})`,
    platesLine(doc.platesRequired),
    `👥 Escuadras de exactamente ${SQUAD_SIZE} jugadores`,
  ];
  lines.push(cfg.honorEnabled ? `⭐ Honor: *activado*${cfg.honorRequired > 0 ? ` (requerido ${cfg.honorRequired})` : ' (sin valor requerido)'}` : '⭐ Honor: *desactivado*');
  return lines;
}

function panelText(ctx) {
  const { clan, doc } = needClan(ctx);
  const g = svc(ctx);
  const c = squadCounts(doc.squads);
  const p = ctx.prefix;
  const lines = [`⚔️ *GDC — ${plain(clan.name || clan.id)}*`, '', `📅 Próxima GDC: ${g.describeNext(clan)}`, platesLine(doc.platesRequired)];
  const honor = clan.config.gdcEnabled ? honorLine(clan.config) : null;
  if (honor) lines.push(honor);
  lines.push(`👥 Escuadras: ${c.total}${c.total ? ` (${plural(c.complete, 'completa', 'completas')})` : ''}`);
  const mine = mySquadHere(ctx, doc);
  if (mine) lines.push(`📋 Tu escuadra: #${mine.number} (${mine.members.length}/${SQUAD_SIZE})`);
  lines.push('', `${p}gdc crear · ${p}gdc equipos · ${p}gdc unirse N · ${p}gdc equipo · ${p}gdc reglas · ${p}gdc estado · ${p}gdc ayuda`);
  return lines.join('\n');
}

// ---------- subcomandos ----------

const subs = [
  {
    name: 'ayuda',
    aliases: ['help'],
    description: 'Lista los subcomandos de la GDC disponibles para tu rol.',
    usage: 'gdc ayuda',
    permissions: 'USER',
    async handler(ctx) {
      const role = (await ctx.getRole()).role;
      const rows = ctx.command.subcommands
        .filter((s) => hasRole(role, s.permissions))
        .map((s) => `• *${ctx.prefix}${s.usage}* — ${s.description.split('. ')[0].replace(/\.$/, '')}`);
      return ['⚔️ *Subcomandos de la GDC*', '', ...rows].join('\n');
    },
  },
  {
    name: 'estado',
    aliases: ['status'],
    description: 'Estado de la GDC: próxima hora, avisos enviados, placas, honor y escuadras.',
    usage: 'gdc estado',
    permissions: 'USER',
    async handler(ctx) {
      const { clan, doc } = needClan(ctx);
      const g = svc(ctx);
      const today = g.today();
      const c = squadCounts(doc.squads);
      const lines = [`📊 *Estado de la GDC — ${plain(clan.name || clan.id)}*`, '', `📅 Próxima GDC: ${g.describeNext(clan)}`];
      if (doc.sent.reminder === today) lines.push('⏰ Recordatorio de hoy: enviado');
      if (doc.sent.start === today) lines.push('🔥 GDC de hoy: iniciada');
      lines.push(...configLines(ctx, clan, doc));
      lines.push(`📋 Escuadras: ${c.total}${c.total ? ` (${plural(c.complete, 'completa', 'completas')}, ${c.total - c.complete} incompletas)` : ''}`);
      if (doc.result) lines.push(`🏁 Resultado registrado: ${OUTCOMES[doc.result.outcome]}${doc.result.note ? ` — ${plain(doc.result.note)}` : ''}`);
      return lines.join('\n');
    },
  },
  {
    name: 'config',
    aliases: ['configuracion'],
    description: 'Configuración de la GDC de este grupo (hora, recordatorio, placas, honor).',
    usage: 'gdc config',
    permissions: 'USER',
    async handler(ctx) {
      const { clan, doc } = needClan(ctx);
      return [`⚙️ *Configuración de la GDC — ${plain(clan.name || clan.id)}*`, '', ...configLines(ctx, clan, doc), '', 'Cada grupo/clan tiene su propia configuración; no existen valores globales.'].join('\n');
    },
  },
  {
    name: 'equipos',
    aliases: ['escuadras'],
    description: 'Lista todas las escuadras de la GDC con sus miembros y cupos.',
    usage: 'gdc equipos [pagina]',
    permissions: 'USER',
    async handler(ctx) {
      const { doc } = needClan(ctx);
      const list = svc(ctx).squads(ctx.chatJid);
      if (list.length === 0) return `📋 Todavía no hay escuadras.\nCrea la primera con *${ctx.prefix}gdc crear*.`;
      const pages = Math.ceil(list.length / SQUADS_PER_PAGE);
      let page = 1;
      if (ctx.args[0]) {
        const p = parseInteger(ctx.args[0], { min: 1, max: pages, label: 'La página' });
        if (!p.ok) throw new UserError('BAD_PAGE', p.error);
        page = p.value;
      }
      const slice = list.slice((page - 1) * SQUADS_PER_PAGE, page * SQUADS_PER_PAGE);
      const c = squadCounts(doc.squads);
      const lines = [`📋 *Escuadras de la GDC* — ${c.total} (${plural(c.complete, 'completa', 'completas')})`, ''];
      for (const s of slice) lines.push(squadText(s, resolveUser(ctx)), '');
      if (pages > 1) lines.push(`Página ${page}/${pages} · *${ctx.prefix}gdc equipos ${Math.min(page + 1, pages)}*`);
      return lines.join('\n').trim();
    },
  },
  {
    name: 'equipo',
    aliases: ['mi', 'miescuadra'],
    description: 'Muestra tu escuadra, o la escuadra con el número indicado.',
    usage: 'gdc equipo [N]',
    permissions: 'USER',
    async handler(ctx) {
      const { doc } = needClan(ctx);
      let squad;
      if (ctx.args[0]) squad = svc(ctx).squadOrThrow(doc, squadNumber(ctx.args[0]));
      else {
        if (!ctx.user) throw new UserError('NOT_REGISTERED', `Primero debes registrarte con *${ctx.prefix}registro*.`);
        squad = mySquadHere(ctx, doc);
        if (!squad) {
          const other = svc(ctx).membership(ctx.user.jid);
          throw new UserError('NOT_IN_SQUAD', other ? 'Tu escuadra está en otro grupo.' : `No perteneces a ninguna escuadra. Crea una con *${ctx.prefix}gdc crear* o únete con *${ctx.prefix}gdc unirse N*.`);
        }
      }
      return squadText(squad, resolveUser(ctx));
    },
  },
  {
    name: 'miembros',
    aliases: [],
    description: 'Miembros de una escuadra (la tuya o la indicada) con su UID de Free Fire si lo vincularon.',
    usage: 'gdc miembros [N]',
    permissions: 'USER',
    async handler(ctx) {
      const { doc } = needClan(ctx);
      let squad;
      if (ctx.args[0]) squad = svc(ctx).squadOrThrow(doc, squadNumber(ctx.args[0]));
      else {
        squad = mySquadHere(ctx, doc);
        if (!squad) throw new UserError('NOT_IN_SQUAD', `No perteneces a una escuadra de este grupo. Indica un número: *${ctx.prefix}gdc miembros N*.`);
      }
      const rows = squad.members.map((m, i) => {
        const u = ctx.services.users.find([m]);
        const uid = u?.ffUid ? ` — UID ${u.ffUid}${u.ffVerified ? ' ✅' : ''}` : '';
        return `${i + 1}. ${m === squad.captain ? '👑' : '👤'} ${memberLabel(u, m)}${uid}`;
      });
      return [`👥 *Miembros de la escuadra #${squad.number}* (${squad.members.length}/${SQUAD_SIZE})`, '', ...rows].join('\n');
    },
  },
  {
    name: 'crear',
    aliases: ['nueva'],
    description: 'Crea una escuadra nueva y te hace su capitán.',
    usage: 'gdc crear',
    permissions: 'USER',
    requiresRegistration: true,
    async handler(ctx) {
      const squad = svc(ctx).create(ctx.chatJid, ctx.user);
      return `✅ *Escuadra #${squad.number} creada* (1/${SQUAD_SIZE}). Eres el capitán.\n\nInvita con *${ctx.prefix}gdc invitar @usuario* o deja que se unan con *${ctx.prefix}gdc unirse ${squad.number}*.`;
    },
  },
  {
    name: 'unirse',
    aliases: ['join'],
    description: 'Te une a una escuadra abierta que no esté completa.',
    usage: 'gdc unirse N',
    permissions: 'USER',
    requiresRegistration: true,
    async handler(ctx) {
      if (!ctx.args[0]) throw new UserError('USAGE', `Uso: *${ctx.prefix}gdc unirse N*\nMira las escuadras con *${ctx.prefix}gdc equipos*.`);
      const squad = svc(ctx).join(ctx.chatJid, ctx.user, squadNumber(ctx.args[0]));
      const lines = [`✅ Te uniste a la escuadra #${squad.number} (${squad.members.length}/${SQUAD_SIZE}).`];
      if (squad.members.length === SQUAD_SIZE) {
        lines.push('', `🔒 *ESCUADRA COMPLETA* ${squad.members.map(tag).join(' ')}`);
        return { text: lines.join('\n'), mentions: [...squad.members] };
      }
      return lines.join('\n');
    },
  },
  {
    name: 'salir',
    aliases: ['leave'],
    description: 'Sales de tu escuadra. Si eras el capitán, el cargo pasa al siguiente miembro.',
    usage: 'gdc salir',
    permissions: 'USER',
    requiresRegistration: true,
    async handler(ctx) {
      const { squad, outcome } = svc(ctx).leave(ctx.chatJid, ctx.user);
      if (outcome === 'deleted') return `👋 Saliste de la escuadra #${squad.number}. Como quedó vacía, se eliminó.`;
      if (outcome === 'newCaptain') return { text: `👋 Saliste de la escuadra #${squad.number}. El nuevo capitán es ${tag(squad.captain)}.`, mentions: [squad.captain] };
      return `👋 Saliste de la escuadra #${squad.number}.`;
    },
  },
  {
    name: 'expulsar',
    aliases: ['kick'],
    description: 'El capitán expulsa a un miembro de su escuadra (mencionándolo). Un administrador puede expulsar de cualquier escuadra.',
    usage: 'gdc expulsar @usuario',
    permissions: 'USER',
    requiresRegistration: true,
    async handler(ctx) {
      const target = targetJid(ctx);
      if (!target) throw new UserError('USAGE', `Menciona a la persona o responde a su mensaje: *${ctx.prefix}gdc expulsar @usuario*`);
      const targetUser = ctx.services.users.find([target]);
      const targetKey = targetUser ? targetUser.jid : jid.normalize(target);
      const { squad } = svc(ctx).kick(ctx.chatJid, ctx.user, targetKey, { isAdmin: await isAdmin(ctx) });
      return { text: `🚪 ${tag(targetKey)} fue expulsado de la escuadra #${squad.number}.`, mentions: [targetKey] };
    },
  },
  {
    name: 'cerrar',
    aliases: [],
    description: 'Cierra tu escuadra: solo se entra por invitación. Un administrador indica el número.',
    usage: 'gdc cerrar [N]',
    permissions: 'USER',
    requiresRegistration: true,
    async handler(ctx) {
      const squad = svc(ctx).setOpen(ctx.chatJid, ctx.user, false, { number: ctx.args[0] ? squadNumber(ctx.args[0]) : null, isAdmin: await isAdmin(ctx) });
      return `🔒 La escuadra #${squad.number} ahora está cerrada: solo se entra por invitación.`;
    },
  },
  {
    name: 'abrir',
    aliases: [],
    description: 'Abre tu escuadra para que cualquiera se una con unirse. Un administrador indica el número.',
    usage: 'gdc abrir [N]',
    permissions: 'USER',
    requiresRegistration: true,
    async handler(ctx) {
      const squad = svc(ctx).setOpen(ctx.chatJid, ctx.user, true, { number: ctx.args[0] ? squadNumber(ctx.args[0]) : null, isAdmin: await isAdmin(ctx) });
      return `🔓 La escuadra #${squad.number} ahora está abierta.`;
    },
  },
  {
    name: 'invitar',
    aliases: ['invite'],
    description: 'El capitán invita a una persona registrada (mencionándola) a su escuadra.',
    usage: 'gdc invitar @usuario',
    permissions: 'USER',
    requiresRegistration: true,
    async handler(ctx) {
      const target = targetJid(ctx);
      if (!target) throw new UserError('USAGE', `Menciona a la persona o responde a su mensaje: *${ctx.prefix}gdc invitar @usuario*`);
      const targetUser = ctx.services.users.find([target]);
      const { squad } = svc(ctx).invite(ctx.chatJid, ctx.user, targetUser);
      const ttl = ctx.config.gdc.inviteTtlMin;
      const text = [
        '⚔️ *INVITACIÓN GDC*',
        '',
        `${tag(ctx.user.jid)} te invitó a su escuadra #${squad.number} (${squad.members.length}/${SQUAD_SIZE}), ${tag(targetUser.jid)}.`,
        '',
        `✅ Aceptar: *${ctx.prefix}gdc aceptar ${squad.number}*`,
        `❌ Rechazar: *${ctx.prefix}gdc rechazar ${squad.number}*`,
        `⏳ Vigente ${ttl} minutos.`,
      ].join('\n');
      return { text, mentions: [targetUser.jid, ctx.user.jid] };
    },
  },
  {
    name: 'aceptar',
    aliases: ['accept'],
    description: 'Acepta una invitación vigente a una escuadra (la más reciente, o la del número indicado).',
    usage: 'gdc aceptar [N]',
    permissions: 'USER',
    requiresRegistration: true,
    async handler(ctx) {
      const squad = svc(ctx).acceptInvite(ctx.chatJid, ctx.user, ctx.args[0] ? squadNumber(ctx.args[0]) : null);
      const lines = [`✅ ${tag(ctx.user.jid)} se unió a la escuadra #${squad.number} (${squad.members.length}/${SQUAD_SIZE}).`];
      if (squad.members.length === SQUAD_SIZE) lines.push('', '🔒 *ESCUADRA COMPLETA*');
      return { text: lines.join('\n'), mentions: [ctx.user.jid, ...(squad.members.length === SQUAD_SIZE ? squad.members : [squad.captain])] };
    },
  },
  {
    name: 'rechazar',
    aliases: ['reject'],
    description: 'Rechaza una invitación vigente a una escuadra.',
    usage: 'gdc rechazar [N]',
    permissions: 'USER',
    requiresRegistration: true,
    async handler(ctx) {
      const { squad } = svc(ctx).rejectInvite(ctx.chatJid, ctx.user, ctx.args[0] ? squadNumber(ctx.args[0]) : null);
      return { text: `❌ ${tag(ctx.user.jid)} rechazó la invitación a la escuadra #${squad.number}.`, mentions: [ctx.user.jid] };
    },
  },
  {
    name: 'historial',
    aliases: ['history'],
    description: 'Historial de GDC finalizadas: fecha, escuadras y resultado registrado por los administradores.',
    usage: 'gdc historial [cantidad]',
    permissions: 'USER',
    async handler(ctx) {
      needClan(ctx);
      let n = 5;
      if (ctx.args[0]) {
        const p = parseInteger(ctx.args[0], { min: 1, max: 15, label: 'La cantidad' });
        if (!p.ok) throw new UserError('BAD_NUMBER', p.error);
        n = p.value;
      }
      const list = svc(ctx).history(ctx.chatJid, n);
      if (list.length === 0) return '📜 Aún no hay GDC finalizadas en el historial.';
      const rows = list.map((h) => {
        const res = h.result ? `${OUTCOMES[h.result.outcome]}${h.result.note ? ` (${plain(h.result.note)})` : ''}` : 'sin resultado';
        const players = h.squads.reduce((a, s) => a + s.members.length, 0);
        return `• ${h.date} — ${h.squads.length} escuadras, ${players} jugadores — ${res}${h.reason !== 'finalizada' ? ` [${h.reason}]` : ''}`;
      });
      return ['📜 *Historial de GDC*', '', ...rows].join('\n');
    },
  },
  {
    name: 'resultado',
    aliases: ['result'],
    description: 'Muestra el resultado de la GDC en curso. Un administrador lo registra a mano: resultado victoria|derrota|empate|cancelada [nota].',
    usage: 'gdc resultado [victoria|derrota|empate|cancelada] [nota]',
    permissions: 'USER',
    permissionsWithArgs: 'ADMIN',
    async handler(ctx) {
      const { doc } = needClan(ctx);
      if (ctx.args.length === 0) {
        if (!doc.result) return `🏁 Todavía no hay un resultado registrado.\nUn administrador puede registrarlo con *${ctx.prefix}gdc resultado victoria|derrota|empate|cancelada [nota]*.`;
        return `🏁 Resultado: *${OUTCOMES[doc.result.outcome]}*${doc.result.note ? `\n📝 ${plain(doc.result.note)}` : ''}`;
      }
      const r = svc(ctx).setResult(ctx.chatJid, ctx.sender, { outcome: ctx.args[0], note: ctx.args.slice(1).join(' ') });
      return `🏁 Resultado registrado: *${OUTCOMES[r.outcome]}*${r.note ? `\n📝 ${plain(r.note)}` : ''}\nUsa *${ctx.prefix}gdc finalizar* para cerrar esta GDC y guardarla en el historial.`;
    },
  },
  {
    name: 'finalizar',
    aliases: ['finish'],
    description: 'Cierra la GDC en curso: guarda escuadras y resultado en el historial y limpia las escuadras. Opcional: resultado y nota.',
    usage: 'gdc finalizar [victoria|derrota|empate|cancelada] [nota]',
    permissions: 'ADMIN',
    async handler(ctx) {
      const outcome = ctx.args[0] || null;
      const entry = svc(ctx).finalize(ctx.chatJid, ctx.sender, { outcome, note: ctx.args.slice(1).join(' ') });
      const res = entry.result ? `${OUTCOMES[entry.result.outcome]}` : 'sin resultado registrado';
      return `🏁 *GDC finalizada* — ${entry.squads.length} escuadras archivadas, ${res}.\nLas escuadras quedaron libres para la próxima GDC.`;
    },
  },
  {
    name: 'activar',
    aliases: [],
    description: 'Activa la GDC de este clan (se programan el recordatorio y el inicio).',
    usage: 'gdc activar',
    permissions: 'ADMIN',
    async handler(ctx) {
      const { clan } = needClan(ctx);
      ctx.services.clans.setConfig(clan, 'gdc', 'activar', ctx.sender);
      return `✅ GDC activada. Próxima GDC: ${svc(ctx).describeNext(clan)} (aviso ${clan.config.reminderMinutes} min antes).`;
    },
  },
  {
    name: 'desactivar',
    aliases: [],
    description: 'Desactiva la GDC de este clan (se cancelan los avisos programados).',
    usage: 'gdc desactivar',
    permissions: 'ADMIN',
    async handler(ctx) {
      const { clan } = needClan(ctx);
      ctx.services.clans.setConfig(clan, 'gdc', 'desactivar', ctx.sender);
      return '⏸️ GDC desactivada. No se enviarán avisos y no se podrán crear escuadras hasta activarla de nuevo.';
    },
  },
  {
    name: 'hora',
    aliases: ['time'],
    description: 'Muestra la hora de la GDC; con HH:MM un administrador la cambia (por defecto 19:00).',
    usage: 'gdc hora [HH:MM]',
    permissions: 'USER',
    permissionsWithArgs: 'ADMIN',
    async handler(ctx) {
      const { clan } = needClan(ctx);
      if (ctx.args.length) ctx.services.clans.setConfig(clan, 'hora', ctx.args[0], ctx.sender);
      return `🕖 Hora de la GDC: *${clan.config.gdcTime}* (${ctx.config.timezone})\n⏰ Recordatorio a las ${reminderTime(clan)}\n📅 Próxima GDC: ${svc(ctx).describeNext(clan)}`;
    },
  },
  {
    name: 'recordatorio',
    aliases: ['aviso'],
    description: 'Muestra los minutos de aviso previo; con un número (1-120) un administrador los cambia (por defecto 10).',
    usage: 'gdc recordatorio [MINUTOS]',
    permissions: 'USER',
    permissionsWithArgs: 'ADMIN',
    async handler(ctx) {
      const { clan } = needClan(ctx);
      if (ctx.args.length) ctx.services.clans.setConfig(clan, 'recordatorio', ctx.args[0], ctx.sender);
      return `⏰ Recordatorio: *${clan.config.reminderMinutes} min antes* (a las ${reminderTime(clan)}), aunque todavía no existan escuadras.`;
    },
  },
  {
    name: 'placas',
    aliases: [],
    description: 'Muestra las placas obligatorias; con un número un administrador las define, y con "borrar" las quita. No hay mínimos ni máximos de placas.',
    usage: 'gdc placas [NUMERO|borrar]',
    permissions: 'USER',
    permissionsWithArgs: 'ADMIN',
    async handler(ctx) {
      const { doc } = needClan(ctx);
      if (ctx.args.length) {
        const raw = ctx.args[0].toLowerCase();
        let value = null;
        if (raw !== 'borrar') {
          const p = parseInteger(raw, { min: 1, max: 999, label: 'Las placas obligatorias' });
          if (!p.ok) throw new UserError('BAD_NUMBER', p.error);
          value = p.value;
        }
        svc(ctx).setPlates(ctx.chatJid, value, ctx.sender);
      }
      return platesLine(doc.platesRequired);
    },
  },
  {
    name: 'honor',
    aliases: [],
    description: 'Muestra la configuración de honor del clan; un administrador usa activar, desactivar o un NUMERO requerido.',
    usage: 'gdc honor [activar|desactivar|NUMERO]',
    permissions: 'USER',
    permissionsWithArgs: 'ADMIN',
    async handler(ctx) {
      const { clan } = needClan(ctx);
      const cfg = () => clan.config;
      let extra = null;
      if (ctx.args.length) {
        const arg = ctx.args[0].toLowerCase();
        if (/^\d+$/.test(arg)) {
          ctx.services.clans.setConfig(clan, 'honorrequerido', arg, ctx.sender);
          if (!cfg().honorEnabled) extra = `Guardé el valor, pero el honor sigue desactivado: usa *${ctx.prefix}gdc honor activar*.`;
        } else {
          ctx.services.clans.setConfig(clan, 'honor', arg, ctx.sender);
        }
      }
      const lines = [`⭐ *Honor del clan*: ${cfg().honorEnabled ? 'activado' : 'desactivado'}`];
      if (cfg().honorEnabled) lines.push(cfg().honorRequired > 0 ? `Honor requerido: ${cfg().honorRequired}` : 'Honor requerido: sin valor definido');
      else lines.push('El honor no se exige en este clan.');
      if (extra) lines.push(extra);
      lines.push('', HONOR_NOTE);
      return lines.join('\n');
    },
  },
  {
    name: 'reglas',
    aliases: ['rules'],
    description: 'Reglas de la GDC según la configuración del clan, más las reglas escritas por los administradores.',
    usage: 'gdc reglas',
    permissions: 'USER',
    async handler(ctx) {
      const { clan, doc } = needClan(ctx);
      const lines = [`📖 *Reglas de la GDC — ${plain(clan.name || clan.id)}*`, '', `• Las escuadras tienen exactamente ${SQUAD_SIZE} jugadores.`, '• Una persona solo puede estar en una escuadra a la vez.', `• ${platesLine(doc.platesRequired)}`];
      const honor = honorLine(clan.config);
      if (honor) lines.push(`• ${honor}`);
      lines.push(`• Inicio: ${clan.config.gdcTime} (${ctx.config.timezone}), aviso ${clan.config.reminderMinutes} min antes.`);
      if (clan.rules) lines.push('', '📌 *Reglas del clan*', clan.rules);
      return lines.join('\n');
    },
  },
  {
    name: 'admin',
    aliases: [],
    description: 'Panel de administración de la GDC: subcomandos de admin y últimas acciones auditadas.',
    usage: 'gdc admin',
    permissions: 'ADMIN',
    async handler(ctx) {
      const { clan, doc } = needClan(ctx);
      const adminSubs = ctx.command.subcommands.filter((s) => s.permissions === 'ADMIN' || s.permissionsWithArgs === 'ADMIN');
      const lines = [`🛠️ *Admin GDC — ${plain(clan.name || clan.id)}*`, '', ...adminSubs.map((s) => `• ${ctx.prefix}${s.usage}`), '', '🗂️ *Últimas acciones*'];
      const recent = doc.audit.slice(-8).reverse();
      if (recent.length === 0) lines.push('Sin acciones registradas.');
      for (const a of recent) lines.push(`• ${a.at.slice(5, 16).replace('T', ' ')} UTC — ${a.action}${a.detail ? `: ${plain(a.detail)}` : ''}${a.by ? ` (${tag(a.by)})` : ''}`);
      return lines.join('\n');
    },
  },
];

function build() {
  return [
    {
      name: 'gdc',
      aliases: ['guerradeclanes'],
      description: 'Guerra de Clanes: panel, escuadras de 4, invitaciones, recordatorios automáticos, honor, placas, resultados e historial. Usa "gdc ayuda" para ver los subcomandos.',
      usage: 'gdc [subcomando]',
      example: 'gdc crear',
      category: 'gdc',
      permissions: 'USER',
      cooldown: 2,
      scope: 'group',
      subcommands: subs,
      async handler(ctx) {
        if (ctx.args.length) {
          throw new UserError('UNKNOWN_SUB', `No conozco el subcomando "${plain(ctx.args[0])}". Usa *${ctx.prefix}gdc ayuda* para ver la lista.`);
        }
        if (!ctx.services.clans.clanOfGroup(ctx.chatJid)) return NO_CLAN_GDC_TEXT;
        return panelText(ctx);
      },
    },
  ];
}

module.exports = { name: 'gdc', build, panelText };
