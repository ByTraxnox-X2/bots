'use strict';

const { UserError } = require('../../services/users');
const { plain } = require('../../utils/text');
const { formatNumber } = require('../../utils/validators');
const { targetJid, tag } = require('../shared');
const { MAX_FRIENDS } = require('../../services/social');

const S = (ctx) => ctx.services.social;
const usage = (ctx, text) => new UserError('USAGE', `Uso: *${ctx.prefix}${text}*`);

/** Jugador objetivo: mención/cita registrado, o el propio. */
function playerArg(ctx) {
  const t = targetJid(ctx);
  const u = t ? ctx.services.users.find([t]) : ctx.user;
  if (t && !u) throw new UserError('TARGET_NOT_REGISTERED', 'Esa persona no está registrada en el bot.');
  if (!u) throw new UserError('NOT_REGISTERED', `Primero regístrate con *${ctx.prefix}registro* o menciona a otra persona.`);
  return u;
}

/** Persona a la que apunta un comando de amistad (obligatoria, registrada y distinta de ti). */
function friendTarget(ctx, text) {
  const t = targetJid(ctx);
  if (!t) throw usage(ctx, `${text} (menciona a la persona o responde a su mensaje)`);
  const u = ctx.services.users.find([t]);
  if (!u) throw new UserError('TARGET_NOT_REGISTERED', 'Esa persona no está registrada en el bot.');
  return u;
}

const uname = (ctx, j) => plain(ctx.services.users.find([j])?.name || tag(j));

const friendSubs = [
  {
    name: 'agregar',
    aliases: ['add', 'solicitar'],
    description: 'Envía una solicitud de amistad. Si esa persona ya te la había enviado, os hacéis amigos al instante.',
    usage: 'amigos agregar @usuario',
    permissions: 'USER',
    requiresRegistration: true,
    async handler(ctx) {
      const target = friendTarget(ctx, 'amigos agregar @usuario');
      const r = S(ctx).addFriend(ctx.user, target);
      return r.status === 'friends'
        ? { text: `🤝 ¡${tag(target.jid)} y tú ahora son amigos!`, mentions: [target.jid] }
        : { text: `📨 Solicitud enviada a ${tag(target.jid)}. Debe aceptarla con *${ctx.prefix}amigos aceptar @${ctx.user.number || 'tú'}*.`, mentions: [target.jid] };
    },
  },
  {
    name: 'aceptar',
    aliases: ['accept'],
    description: 'Acepta la solicitud de amistad de una persona.',
    usage: 'amigos aceptar @usuario',
    permissions: 'USER',
    requiresRegistration: true,
    async handler(ctx) {
      const target = friendTarget(ctx, 'amigos aceptar @usuario');
      S(ctx).acceptFriend(ctx.user, target);
      return { text: `🤝 ¡${tag(target.jid)} y tú ahora son amigos!`, mentions: [target.jid] };
    },
  },
  {
    name: 'rechazar',
    aliases: ['reject'],
    description: 'Rechaza la solicitud de amistad de una persona.',
    usage: 'amigos rechazar @usuario',
    permissions: 'USER',
    requiresRegistration: true,
    async handler(ctx) {
      const target = friendTarget(ctx, 'amigos rechazar @usuario');
      S(ctx).rejectFriend(ctx.user, target);
      return `🗑️ Solicitud de ${uname(ctx, target.jid)} rechazada.`;
    },
  },
  {
    name: 'eliminar',
    aliases: ['quitar', 'remove'],
    description: 'Elimina a una persona de tu lista de amigos (también desaparece de la suya).',
    usage: 'amigos eliminar @usuario',
    permissions: 'USER',
    requiresRegistration: true,
    async handler(ctx) {
      const target = friendTarget(ctx, 'amigos eliminar @usuario');
      S(ctx).removeFriend(ctx.user, target);
      return `✅ ${uname(ctx, target.jid)} ya no está en tu lista de amigos.`;
    },
  },
  {
    name: 'solicitudes',
    aliases: ['pendientes', 'requests'],
    description: 'Muestra las solicitudes de amistad que tienes pendientes.',
    usage: 'amigos solicitudes',
    permissions: 'USER',
    requiresRegistration: true,
    async handler(ctx) {
      const list = S(ctx).requestsOf(ctx.user);
      if (!list.length) return 'ℹ️ No tienes solicitudes de amistad pendientes.';
      return { text: ['📨 *Solicitudes pendientes*', ...list.map((j) => `• ${tag(j)} (${uname(ctx, j)})`), `Acepta con *${ctx.prefix}amigos aceptar @usuario*`].join('\n'), mentions: list };
    },
  },
];

const titleSubs = [
  {
    name: 'equipar',
    aliases: ['usar', 'equip'],
    description: 'Equipa uno de tus títulos desbloqueados (se muestra en tu perfil).',
    usage: 'titulos equipar NOMBRE',
    permissions: 'USER',
    requiresRegistration: true,
    async handler(ctx) {
      const name = ctx.args.join(' ');
      if (!name) throw usage(ctx, 'titulos equipar NOMBRE');
      return `🎖️ Título equipado: *${plain(S(ctx).equipTitle(ctx.user, name))}*.`;
    },
  },
  {
    name: 'quitar',
    aliases: ['unequip'],
    description: 'Quita el título que llevas equipado.',
    usage: 'titulos quitar',
    permissions: 'USER',
    requiresRegistration: true,
    async handler(ctx) {
      S(ctx).unequipTitle(ctx.user);
      return '✅ Ya no llevas ningún título equipado.';
    },
  },
];

function build() {
  return [
    {
      name: 'amigos',
      aliases: ['friends', 'amigo'],
      description: `Tu lista de amigos (o la de otra persona) y gestión de amistades: agregar, aceptar, rechazar, eliminar y ver solicitudes (máximo ${MAX_FRIENDS}).`,
      usage: 'amigos [@usuario]',
      example: 'amigos',
      category: 'social',
      permissions: 'USER',
      cooldown: 3,
      subcommands: friendSubs,
      async handler(ctx) {
        const u = playerArg(ctx);
        const list = S(ctx).friendsOf(u);
        const pending = ctx.user && ctx.user.jid === u.jid ? S(ctx).requestsOf(u).length : 0;
        if (!list.length) return `ℹ️ ${plain(u.name)} todavía no tiene amigos.${pending ? ` Tienes ${pending} solicitudes pendientes (*${ctx.prefix}amigos solicitudes*).` : ''}`;
        return [`🤝 *Amigos de ${plain(u.name)}* (${list.length}/${MAX_FRIENDS})`, ...list.map((j) => `• ${uname(ctx, j)}`), pending ? `📨 ${pending} solicitudes pendientes.` : null].filter(Boolean).join('\n');
      },
    },
    {
      name: 'logros',
      aliases: ['achievements'],
      description: 'Logros desbloqueados y pendientes (con progreso) de ti o de otra persona. Se calculan con tus datos reales.',
      usage: 'logros [@usuario]',
      example: 'logros',
      category: 'social',
      permissions: 'USER',
      cooldown: 5,
      async handler(ctx) {
        const u = playerArg(ctx);
        const list = S(ctx).achievements(u);
        const done = list.filter((a) => a.unlocked);
        const rows = list.map((a) => (a.unlocked ? `✅ ${a.name} — ${a.desc}` : `🔒 ${a.name} — ${a.desc}${a.progress ? ` (${formatNumber(Math.min(a.progress[0], a.progress[1]))}/${formatNumber(a.progress[1])})` : ''}`));
        return [`🏆 *Logros de ${plain(u.name)}* (${done.length}/${list.length})`, ...rows].join('\n');
      },
    },
    {
      name: 'medallas',
      aliases: ['medals'],
      description: 'Medallas competitivas: torneos ganados, subcampeonatos y podios de temporada (de ti o de otra persona).',
      usage: 'medallas [@usuario]',
      example: 'medallas',
      category: 'social',
      permissions: 'USER',
      cooldown: 5,
      async handler(ctx) {
        const u = playerArg(ctx);
        const list = S(ctx).medals(u);
        if (!list.length) return `ℹ️ ${plain(u.name)} todavía no tiene medallas. Se ganan siendo campeón o subcampeón de torneos y en el podio de las temporadas.`;
        return [`🏅 *Medallas de ${plain(u.name)}* (${list.length})`, ...list.map((m) => `${m.icon} ${plain(m.text)}`)].join('\n');
      },
    },
    {
      name: 'titulos',
      aliases: ['titles', 'titulo'],
      description: 'Títulos que has desbloqueado con tus logros y cuál llevas equipado. Equípalos con "titulos equipar NOMBRE".',
      usage: 'titulos [@usuario]',
      example: 'titulos',
      category: 'social',
      permissions: 'USER',
      cooldown: 5,
      subcommands: titleSubs,
      async handler(ctx) {
        const u = playerArg(ctx);
        const list = S(ctx).titlesOf(u);
        const eq = S(ctx).equippedTitle(u);
        return [`🎖️ *Títulos de ${plain(u.name)}* (${list.length})`, ...list.map((t) => `• ${plain(t)}${t === eq ? ' ← equipado' : ''}`)].join('\n');
      },
    },
    {
      name: 'insignias',
      aliases: ['badges'],
      description: 'Insignias actuales según tu estado real: cuenta verificada, capitán, veterano, racha, campeón y amistades.',
      usage: 'insignias [@usuario]',
      example: 'insignias',
      category: 'social',
      permissions: 'USER',
      cooldown: 5,
      async handler(ctx) {
        const u = playerArg(ctx);
        const list = S(ctx).badges(u);
        if (!list.length) return `ℹ️ ${plain(u.name)} todavía no tiene insignias.`;
        return [`🎗️ *Insignias de ${plain(u.name)}*`, ...list.map((b) => `${b.icon} ${plain(b.text)}`)].join('\n');
      },
    },
    {
      name: 'estadisticas',
      aliases: ['stats', 'mystats'],
      description: 'Estadísticas generales de un jugador: nivel, partidas, ELO, juegos, torneos, equipos, amigos y logros.',
      usage: 'estadisticas [@usuario]',
      example: 'estadisticas',
      category: 'social',
      permissions: 'USER',
      cooldown: 5,
      async handler(ctx) {
        const u = playerArg(ctx);
        const s = S(ctx).stats(u);
        const pct = u.stats.matches ? Math.round((u.stats.wins / u.stats.matches) * 100) : 0;
        return [
          `📈 *Estadísticas de ${plain(u.name)}*`,
          `⭐ Nivel ${u.level} · ${formatNumber(u.xp)} XP · 🪙 ${formatNumber(u.coins)}`,
          `⚔️ Partidas: ${u.stats.matches} · ${u.stats.wins}V ${u.stats.losses}D (${pct}% victorias)`,
          `📊 ELO: ${formatNumber(s.elo.elo)}${s.position ? ` (#${s.position})` : ''} · pico ${formatNumber(s.elo.peak)}`,
          `🎮 Juegos: ${s.games.wins} victorias de ${s.games.played}${s.bestGame ? ` · mejor: ${s.bestGame.type} (${s.bestGame.wins})` : ''}`,
          `🏆 Torneos: ${s.champion} ganados · ${s.runnerUp} subcampeonatos`,
          `👥 Equipos: ${s.teams.length ? s.teams.map((t) => `${plain(t.name)} (${t.mode})`).join(', ') : 'ninguno'}`,
          `🤝 Amigos: ${s.friends} · 🏅 Logros: ${s.achievements}/${s.achievementsTotal}`,
        ].join('\n');
      },
    },
  ];
}

module.exports = { name: 'social', build };
