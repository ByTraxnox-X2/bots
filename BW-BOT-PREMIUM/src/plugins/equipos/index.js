'use strict';

const { UserError } = require('../../services/users');
const { hasRole } = require('../../middleware/permissions');
const { plain } = require('../../utils/text');
const { tag, targetUser, textArgs, canModerate } = require('../shared');
const { parseMode } = require('../../services/teams');
const { STATUS } = require('../../services/matches');
const { teamHeader, memberLines, teamInfo, statsLine, matchInfo, winnerName, STATUS_ICON } = require('./format');

const teamsOf = (ctx) => ctx.services.teams;
const matchesOf = (ctx) => ctx.services.matches;
const usage = (ctx, text) => new UserError('USAGE', `Uso: *${ctx.prefix}${text}*`);
const superAdmin = async (ctx) => hasRole((await ctx.getRole()).role, 'SUPERADMIN');

/** Equipo indicado por ID/nombre, o el propio. */
function teamFromArg(ctx, arg) {
  return arg ? teamsOf(ctx).require(arg) : teamsOf(ctx).ownTeam(ctx.user);
}

// ---------- .equipo ----------

const teamSubs = [
  {
    name: 'crear',
    aliases: ['create'],
    description: 'Crea un equipo 2v2, 4v4 o 6v6 del que eres capitán. Un jugador solo puede estar en un equipo por modalidad.',
    usage: 'equipo crear MODO NOMBRE',
    permissions: 'USER',
    requiresRegistration: true,
    async handler(ctx) {
      const mode = ctx.args[0];
      const name = ctx.args.slice(1).join(' ');
      if (!mode || !name) throw usage(ctx, 'equipo crear MODO NOMBRE (por ejemplo: equipo crear 4v4 Los Pro)');
      const clan = ctx.isGroup ? ctx.services.clans.clanOfGroup(ctx.chatJid) : null;
      const team = teamsOf(ctx).create({ user: ctx.user, mode, name, groupJid: ctx.isGroup ? ctx.chatJid : null, clanId: clan?.id || null });
      return `✅ Equipo *${plain(team.name)}* (${team.id}) creado en modalidad ${team.mode}. Eres el capitán.\nInvita con *${ctx.prefix}equipo invitar @usuario* (1/${team.size}).`;
    },
  },
  {
    name: 'info',
    aliases: ['ver'],
    description: 'Información de un equipo (por ID o nombre). Sin argumentos muestra tus equipos.',
    usage: 'equipo info [ID|nombre]',
    permissions: 'USER',
    async handler(ctx) {
      const { users } = ctx.services;
      if (ctx.args.length) return teamInfo(teamsOf(ctx).require(ctx.argText), { users, teams: teamsOf(ctx) });
      if (!ctx.user) throw usage(ctx, 'equipo info ID|nombre');
      const mine = teamsOf(ctx).teamsOf(ctx.user.jid);
      if (!mine.length) return `No perteneces a ningún equipo. Crea uno con *${ctx.prefix}equipo crear MODO NOMBRE*.`;
      return mine.map((t) => teamInfo(t, { users, teams: teamsOf(ctx) })).join('\n\n');
    },
  },
  {
    name: 'miembros',
    aliases: ['members'],
    description: 'Lista los miembros de un equipo con su cargo (capitán, subcapitán, jugador).',
    usage: 'equipo miembros [ID|nombre]',
    permissions: 'USER',
    async handler(ctx) {
      const t = ctx.args.length ? teamsOf(ctx).require(ctx.argText) : ctx.user ? teamsOf(ctx).ownTeam(ctx.user) : null;
      if (!t) throw usage(ctx, 'equipo miembros ID|nombre');
      return [teamHeader(t), `👥 ${t.members.length}/${t.size}${teamsOf(ctx).isFull(t) ? ' · completo' : ''}`, ...memberLines(t, ctx.services.users)].join('\n');
    },
  },
  {
    name: 'invitar',
    aliases: ['invite'],
    description: 'El capitán o subcapitán invita a una persona registrada (mencionándola) a su equipo.',
    usage: 'equipo invitar @usuario [modo]',
    permissions: 'USER',
    requiresRegistration: true,
    async handler(ctx) {
      const target = targetUser(ctx, 'equipo invitar @usuario');
      const modeArg = ctx.args.find((a) => parseMode(a));
      const team = teamsOf(ctx).ownTeam(ctx.user, modeArg);
      teamsOf(ctx).invite(team, ctx.user, target);
      return {
        text: `🛡️ *INVITACIÓN DE EQUIPO*\n\n${tag(ctx.user.jid)} invita a ${tag(target.jid)} a *${plain(team.name)}* (${team.id}, ${team.mode}).\n\n✅ Aceptar: *${ctx.prefix}equipo aceptar ${team.id}*\n❌ Rechazar: *${ctx.prefix}equipo rechazar ${team.id}*\n⏳ Vigente ${ctx.config.teams.inviteTtlMin} minutos.`,
        mentions: [ctx.user.jid, target.jid],
      };
    },
  },
  {
    name: 'aceptar',
    aliases: ['accept'],
    description: 'Acepta una invitación vigente a un equipo (indica el ID si tienes varias).',
    usage: 'equipo aceptar [ID]',
    permissions: 'USER',
    requiresRegistration: true,
    async handler(ctx) {
      const team = teamsOf(ctx).accept(ctx.user, ctx.args[0]);
      return `✅ Ahora eres parte de *${plain(team.name)}* (${team.members.length}/${team.size}).`;
    },
  },
  {
    name: 'rechazar',
    aliases: ['reject'],
    description: 'Rechaza una invitación vigente a un equipo.',
    usage: 'equipo rechazar [ID]',
    permissions: 'USER',
    requiresRegistration: true,
    async handler(ctx) {
      const team = teamsOf(ctx).reject(ctx.user, ctx.args[0]);
      return `❌ Rechazaste la invitación de *${plain(team.name)}*.`;
    },
  },
  {
    name: 'invitaciones',
    aliases: ['invites'],
    description: 'Muestra las invitaciones de equipo que tienes pendientes.',
    usage: 'equipo invitaciones',
    permissions: 'USER',
    requiresRegistration: true,
    async handler(ctx) {
      const list = teamsOf(ctx).invitesFor(ctx.user);
      if (!list.length) return 'No tienes invitaciones de equipo pendientes.';
      return ['📨 *Invitaciones pendientes*', ...list.map((t) => `• ${plain(t.name)} (${t.id}, ${t.mode}) → *${ctx.prefix}equipo aceptar ${t.id}*`)].join('\n');
    },
  },
  {
    name: 'salir',
    aliases: ['leave'],
    description: 'Sales de tu equipo. Si eras el capitán, el cargo pasa al subcapitán o al siguiente miembro.',
    usage: 'equipo salir [modo]',
    permissions: 'USER',
    requiresRegistration: true,
    async handler(ctx) {
      const team = teamsOf(ctx).ownTeam(ctx.user, ctx.args[0]);
      const r = teamsOf(ctx).leave(team, ctx.user);
      if (r.outcome === 'disbanded') return `👋 Saliste de *${plain(team.name)}*. Como quedó vacío, el equipo se disolvió.`;
      if (r.outcome === 'newCaptain') return { text: `👋 Saliste de *${plain(team.name)}*. El nuevo capitán es ${tag(team.captain)}.`, mentions: [team.captain] };
      return `👋 Saliste de *${plain(team.name)}*.`;
    },
  },
  {
    name: 'expulsar',
    aliases: ['kick'],
    description: 'El capitán o subcapitán expulsa a un miembro (mencionándolo). No se puede expulsar al capitán.',
    usage: 'equipo expulsar @usuario [ID]',
    permissions: 'USER',
    requiresRegistration: true,
    async handler(ctx) {
      const target = targetUser(ctx, 'equipo expulsar @usuario');
      const idArg = ctx.args.find((a) => /^eq-?\d+$/i.test(a));
      const team = idArg ? teamsOf(ctx).require(idArg) : teamsOf(ctx).ownTeam(ctx.user, ctx.args.find((a) => parseMode(a)));
      teamsOf(ctx).kick(team, ctx.user, target.jid, { isAdmin: idArg ? await superAdmin(ctx) : false });
      return { text: `🚪 ${tag(target.jid)} fue expulsado de *${plain(team.name)}*.`, mentions: [target.jid] };
    },
  },
  {
    name: 'capitan',
    aliases: ['captain'],
    description: 'El capitán traspasa el cargo a otro miembro del equipo (mencionándolo).',
    usage: 'equipo capitan @usuario [modo]',
    permissions: 'USER',
    requiresRegistration: true,
    async handler(ctx) {
      const target = targetUser(ctx, 'equipo capitan @usuario');
      const team = teamsOf(ctx).ownTeam(ctx.user, ctx.args.find((a) => parseMode(a)));
      teamsOf(ctx).transferCaptain(team, ctx.user, target.jid);
      return { text: `👑 ${tag(target.jid)} es el nuevo capitán de *${plain(team.name)}*.`, mentions: [target.jid] };
    },
  },
  {
    name: 'subcapitan',
    aliases: ['vice'],
    description: 'El capitán nombra subcapitán a un miembro (mencionándolo) o quita el cargo con "quitar".',
    usage: 'equipo subcapitan @usuario|quitar [modo]',
    permissions: 'USER',
    requiresRegistration: true,
    async handler(ctx) {
      const modeArg = ctx.args.find((a) => parseMode(a));
      const team = teamsOf(ctx).ownTeam(ctx.user, modeArg);
      if (ctx.args[0]?.toLowerCase() === 'quitar') {
        teamsOf(ctx).setVice(team, ctx.user, null);
        return `⭐ Quitaste el cargo de subcapitán en *${plain(team.name)}*.`;
      }
      const target = targetUser(ctx, 'equipo subcapitan @usuario');
      teamsOf(ctx).setVice(team, ctx.user, target.jid);
      return { text: `⭐ ${tag(target.jid)} es subcapitán de *${plain(team.name)}*.`, mentions: [target.jid] };
    },
  },
  {
    name: 'renombrar',
    aliases: ['rename'],
    description: 'El capitán cambia el nombre de su equipo (indicando su ID).',
    usage: 'equipo renombrar ID NUEVO_NOMBRE',
    permissions: 'USER',
    requiresRegistration: true,
    async handler(ctx) {
      if (ctx.args.length < 2) throw usage(ctx, 'equipo renombrar ID NUEVO_NOMBRE');
      const team = teamsOf(ctx).require(ctx.args[0]);
      teamsOf(ctx).rename(team, ctx.user, ctx.args.slice(1).join(' '), { isAdmin: await superAdmin(ctx) });
      return `✏️ El equipo ${team.id} ahora se llama *${plain(team.name)}*.`;
    },
  },
  {
    name: 'disolver',
    aliases: ['disband'],
    description: 'El capitán disuelve su equipo (indicando su ID). No se puede mientras esté en una partida llena o iniciada.',
    usage: 'equipo disolver ID',
    permissions: 'USER',
    requiresRegistration: true,
    async handler(ctx) {
      if (!ctx.args[0]) throw usage(ctx, 'equipo disolver ID');
      const team = teamsOf(ctx).require(ctx.args[0]);
      teamsOf(ctx).disband(team, ctx.user, { isAdmin: await superAdmin(ctx) });
      return `🗑️ El equipo *${plain(team.name)}* (${team.id}) se disolvió.`;
    },
  },
  {
    name: 'stats',
    aliases: ['estadisticas'],
    description: 'Estadísticas de un equipo: partidas, victorias, derrotas, empates, % y racha. Solo cuenta partidas finalizadas.',
    usage: 'equipo stats [ID|nombre]',
    permissions: 'USER',
    async handler(ctx) {
      const team = ctx.args.length ? teamsOf(ctx).require(ctx.argText) : ctx.user ? teamsOf(ctx).ownTeam(ctx.user) : null;
      if (!team) throw usage(ctx, 'equipo stats ID|nombre');
      return [teamHeader(team), statsLine(team, teamsOf(ctx)), `🔥 Mejor racha: ${team.stats.bestStreak}V`].join('\n');
    },
  },
  {
    name: 'historial',
    aliases: ['history'],
    description: 'Últimas partidas finalizadas de un equipo.',
    usage: 'equipo historial [ID|nombre]',
    permissions: 'USER',
    async handler(ctx) {
      const team = ctx.args.length ? teamsOf(ctx).require(ctx.argText) : ctx.user ? teamsOf(ctx).ownTeam(ctx.user) : null;
      if (!team) throw usage(ctx, 'equipo historial ID|nombre');
      const list = matchesOf(ctx).finishedOf(team.id, 10);
      if (!list.length) return `${plain(team.name)} todavía no tiene partidas finalizadas.`;
      const lines = list.map((m) => {
        const rival = ctx.services.teams.db.get('teams', m.host === team.id ? m.guest : m.host);
        const side = m.host === team.id ? 'host' : 'guest';
        const res = m.result.winner === 'draw' ? 'E' : m.result.winner === side ? 'V' : 'D';
        return `• ${m.finishedAt.slice(0, 10)} ${m.id} ${res} vs ${plain(rival?.name || '?')}`;
      });
      return [`📜 *Historial de ${plain(team.name)}*`, ...lines].join('\n');
    },
  },
  {
    name: 'ranking',
    aliases: ['top'],
    description: 'Ranking de equipos por victorias (opcionalmente de una modalidad). Solo cuenta partidas finalizadas.',
    usage: 'equipo ranking [modo]',
    permissions: 'USER',
    async handler(ctx) {
      const mode = ctx.args[0] ? parseMode(ctx.args[0]) : null;
      if (ctx.args[0] && !mode) throw new UserError('BAD_MODE', 'La modalidad debe ser 2v2, 4v4 o 6v6.');
      const list = teamsOf(ctx).ranking({ mode, limit: 10 });
      if (!list.length) return 'Todavía no hay equipos con partidas finalizadas.';
      return [`🏆 *Ranking de equipos${mode ? ` ${mode}` : ''}*`, ...list.map((t, i) => `${i + 1}. ${plain(t.name)} (${t.mode}) — ${t.stats.wins}V ${t.stats.losses}D ${t.stats.draws}E · ${teamsOf(ctx).winRate(t)}%`)].join('\n');
    },
  },
  {
    name: 'vs',
    aliases: ['enfrentamientos'],
    description: 'Enfrentamientos directos entre dos equipos (el tuyo y otro, o dos indicados).',
    usage: 'equipo vs ID_A [ID_B]',
    permissions: 'USER',
    async handler(ctx) {
      if (!ctx.args[0]) throw usage(ctx, 'equipo vs ID_A [ID_B]');
      let a;
      let b;
      if (ctx.args[1]) {
        a = teamsOf(ctx).require(ctx.args[0]);
        b = teamsOf(ctx).require(ctx.args[1]);
      } else {
        if (!ctx.user) throw usage(ctx, 'equipo vs ID_A ID_B');
        b = teamsOf(ctx).require(ctx.args[0]);
        a = teamsOf(ctx).ownTeam(ctx.user, b.mode);
      }
      if (a.id === b.id) throw new UserError('SAME_TEAM', 'Indica dos equipos distintos.');
      const h = matchesOf(ctx).headToHead(a.id, b.id);
      if (!h.played) return `${plain(a.name)} y ${plain(b.name)} todavía no se enfrentaron.`;
      return [`⚔️ *${plain(a.name)} vs ${plain(b.name)}*`, `Partidas: ${h.played}`, `${plain(a.name)}: ${h[a.id]} · ${plain(b.name)}: ${h[b.id]} · Empates: ${h.draws}`].join('\n');
    },
  },
];

// ---------- .partida ----------

const myLeaderTeam = (ctx, modeArg) => teamsOf(ctx).ownTeam(ctx.user, modeArg);

const matchSubs = [
  {
    name: 'crear',
    aliases: ['create'],
    description: 'El capitán o subcapitán crea una partida con su equipo completo (estado pendiente). Con un ID de rival es un desafío directo.',
    usage: 'partida crear [ID_RIVAL]',
    permissions: 'USER',
    requiresRegistration: true,
    async handler(ctx) {
      const rival = ctx.args[0] ? teamsOf(ctx).require(ctx.args[0]) : null;
      const team = rival ? teamsOf(ctx).ownTeam(ctx.user, rival.mode) : myLeaderTeam(ctx);
      const m = matchesOf(ctx).create({ user: ctx.user, team, rival, groupJid: ctx.isGroup ? ctx.chatJid : null });
      return `✅ Partida *${m.id}* creada (${m.mode}, pendiente).\nÁbrela para recibir rival con *${ctx.prefix}partida abrir ${m.id}*${rival ? `. Desafiaste a ${plain(rival.name)}.` : '.'}`;
    },
  },
  {
    name: 'abrir',
    aliases: ['open'],
    description: 'El anfitrión abre la partida para que un equipo rival se una (pendiente → abierta).',
    usage: 'partida abrir ID',
    permissions: 'USER',
    requiresRegistration: true,
    async handler(ctx) {
      const m = matchesOf(ctx).open_(matchesOf(ctx).require(ctx.args[0]), ctx.user);
      return `🟢 Partida *${m.id}* abierta (${m.mode}). Un capitán rival puede unirse con *${ctx.prefix}partida unirse ${m.id}*.`;
    },
  },
  {
    name: 'unirse',
    aliases: ['join'],
    description: 'El capitán o subcapitán de un equipo completo se une como rival a una partida abierta (abierta → llena).',
    usage: 'partida unirse ID',
    permissions: 'USER',
    requiresRegistration: true,
    async handler(ctx) {
      const m = matchesOf(ctx).require(ctx.args[0]);
      const team = teamsOf(ctx).ownTeam(ctx.user, m.mode);
      matchesOf(ctx).join(m, ctx.user, team);
      return `🔒 Partida *${m.id}* llena: ${plain(teamsOf(ctx).db.get('teams', m.host).name)} vs ${plain(team.name)}.\nCualquier capitán puede iniciarla con *${ctx.prefix}partida iniciar ${m.id}*.`;
    },
  },
  {
    name: 'retirar',
    aliases: ['withdraw'],
    description: 'El equipo rival se retira de una partida llena que aún no empezó (vuelve a abierta).',
    usage: 'partida retirar ID',
    permissions: 'USER',
    requiresRegistration: true,
    async handler(ctx) {
      const m = matchesOf(ctx).withdraw(matchesOf(ctx).require(ctx.args[0]), ctx.user);
      return `↩️ Tu equipo se retiró de la partida ${m.id}. Vuelve a estar abierta.`;
    },
  },
  {
    name: 'iniciar',
    aliases: ['start'],
    description: 'Un capitán o un administrador inicia una partida llena (llena → iniciada). Se vuelve a comprobar que los equipos estén completos.',
    usage: 'partida iniciar ID',
    permissions: 'USER',
    requiresRegistration: true,
    async handler(ctx) {
      const m0 = matchesOf(ctx).require(ctx.args[0]);
      const m = matchesOf(ctx).start(m0, ctx.user, { isAdmin: await canModerate(ctx, m0.groupJid) });
      return `▶️ Partida *${m.id}* iniciada. Cuando termine, cada capitán reporta con *${ctx.prefix}partida resultado ${m.id} victoria|derrota|empate* (desde su equipo).`;
    },
  },
  {
    name: 'resultado',
    aliases: ['result'],
    description: 'Un capitán reporta el resultado desde SU equipo. Si los dos capitanes coinciden se finaliza; si no, queda en disputa para un administrador.',
    usage: 'partida resultado ID victoria|derrota|empate',
    permissions: 'USER',
    requiresRegistration: true,
    async handler(ctx) {
      const m0 = matchesOf(ctx).require(ctx.args[0]);
      const word = (ctx.args[1] || '').toLowerCase();
      const outcome = { victoria: 'win', gane: 'win', ganamos: 'win', derrota: 'loss', perdimos: 'loss', perdi: 'loss', empate: 'draw' }[word];
      if (!outcome) throw usage(ctx, 'partida resultado ID victoria|derrota|empate');
      const r = matchesOf(ctx).report(m0, ctx.user, outcome);
      if (r.state === 'finished') return `🏁 Partida ${m0.id} finalizada de común acuerdo: ${winnerName(m0, teamsOf(ctx))}.`;
      if (r.state === 'disputed') return `⚠️ Los reportes de la partida ${m0.id} no coinciden. Un administrador debe resolver con *${ctx.prefix}partida resolver ${m0.id} A|B|empate*.`;
      return `🧾 Tu reporte quedó registrado. Falta que el otro capitán reporte el resultado de ${m0.id}.`;
    },
  },
  {
    name: 'resolver',
    aliases: ['resolve'],
    description: 'Un administrador fija el resultado de una partida iniciada (A = anfitrión, B = rival, o empate). Resuelve disputas.',
    usage: 'partida resolver ID A|B|empate',
    permissions: 'ADMIN',
    requiresRegistration: true,
    async handler(ctx) {
      const m = matchesOf(ctx).require(ctx.args[0]);
      if (!(await canModerate(ctx, m.groupJid))) throw new UserError('NO_SCOPE', 'Solo puedes resolver partidas creadas en este grupo (o ser SUPERADMIN).');
      const w = { a: 'host', anfitrion: 'host', b: 'guest', rival: 'guest', empate: 'draw' }[(ctx.args[1] || '').toLowerCase()];
      if (!w) throw usage(ctx, 'partida resolver ID A|B|empate');
      matchesOf(ctx).resolve(m, ctx.user, w);
      return `🏁 Partida ${m.id} finalizada por un administrador: ${winnerName(m, teamsOf(ctx))}.`;
    },
  },
  {
    name: 'cancelar',
    aliases: ['cancel'],
    description: 'El anfitrión (o un administrador) cancela una partida que no terminó. Una iniciada solo la cancela un administrador.',
    usage: 'partida cancelar ID [motivo]',
    permissions: 'USER',
    requiresRegistration: true,
    async handler(ctx) {
      const m = matchesOf(ctx).require(ctx.args[0]);
      matchesOf(ctx).cancel(m, ctx.user, { isAdmin: await canModerate(ctx, m.groupJid), reason: ctx.args.slice(1).join(' ') });
      return `❌ Partida ${m.id} cancelada.`;
    },
  },
  {
    name: 'info',
    aliases: ['ver'],
    description: 'Estado y detalles de una partida.',
    usage: 'partida info ID',
    permissions: 'USER',
    async handler(ctx) {
      return matchInfo(matchesOf(ctx).require(ctx.args[0]), { teams: teamsOf(ctx) });
    },
  },
  {
    name: 'lista',
    aliases: ['abiertas'],
    description: 'Partidas abiertas esperando rival.',
    usage: 'partida lista',
    permissions: 'USER',
    async handler(ctx) {
      const list = matchesOf(ctx).open().slice(0, 10);
      if (!list.length) return 'No hay partidas abiertas ahora mismo.';
      return ['🟢 *Partidas abiertas*', ...list.map((m) => `• ${m.id} ${m.mode} — ${plain(teamsOf(ctx).db.get('teams', m.host)?.name || m.host)}${m.challenged ? ` (desafío a ${m.challenged})` : ''}`)].join('\n');
    },
  },
  {
    name: 'mias',
    aliases: ['mine'],
    description: 'Tus partidas sin terminar (de los equipos a los que perteneces).',
    usage: 'partida mias',
    permissions: 'USER',
    requiresRegistration: true,
    async handler(ctx) {
      const out = [];
      for (const t of teamsOf(ctx).teamsOf(ctx.user.jid)) for (const m of matchesOf(ctx).liveFor(t.id)) out.push(m);
      if (!out.length) return 'Tus equipos no tienen partidas sin terminar.';
      return ['📋 *Tus partidas*', ...out.map((m) => `${STATUS_ICON[m.status]} ${m.id} ${m.mode} — ${m.status}`)].join('\n');
    },
  },
];

function build() {
  const unknown = (name) => (ctx) => {
    throw new UserError('UNKNOWN_SUB', `Subcomando desconocido "${plain(ctx.args[0])}". Usa *${ctx.prefix}help ${name}* para ver la lista.`);
  };
  const intro = (cmd, subs) => (ctx) => {
    if (ctx.args.length) return unknown(cmd)(ctx);
    return [`📌 *${ctx.prefix}${cmd}* — subcomandos:`, ...subs.map((s) => `• ${ctx.prefix}${s.usage}`)].join('\n');
  };
  return [
    {
      name: 'equipo',
      aliases: ['team', 'equipos'],
      description: 'Equipos 2v2, 4v4 y 6v6: crear, invitar, capitán/subcapitán, miembros, estadísticas, historial, ranking y enfrentamientos.',
      usage: 'equipo [subcomando]',
      example: 'equipo crear 4v4 Los Pro',
      category: 'equipos',
      permissions: 'USER',
      cooldown: 2,
      subcommands: teamSubs,
      handler: intro('equipo', teamSubs),
    },
    {
      name: 'partida',
      aliases: ['match', 'partidas'],
      description: 'Partidas entre equipos: crear, abrir, unirse, iniciar, reportar resultado, resolver disputas y cancelar. Estados reales, sin resultados inventados.',
      usage: 'partida [subcomando]',
      example: 'partida lista',
      category: 'equipos',
      permissions: 'USER',
      cooldown: 2,
      subcommands: matchSubs,
      handler: intro('partida', matchSubs),
    },
  ];
}

module.exports = { name: 'equipos', build };
