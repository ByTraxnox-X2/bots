'use strict';

const jid = require('../../whatsapp/jid');
const { UserError } = require('../../services/users');
const { parseMode } = require('../../services/teams');
const { plain } = require('../../utils/text');
const { parseWhen, formatWhen } = require('../../utils/when');
const { formatNumber } = require('../../utils/validators');
const { canModerate, tag } = require('../shared');
const { ST } = require('../../services/tournaments');
const { ST: SCRIM_ST, POINTS: SCRIM_POINTS } = require('../../services/scrims');

const T = (ctx) => ctx.services.tournaments;
const S = (ctx) => ctx.services.scrims;
const usage = (ctx, text) => new UserError('USAGE', `Uso: *${ctx.prefix}${text}*`);
const tn = (ctx, id) => (id ? plain(ctx.services.teams.db.get('teams', id)?.name || id) : '—');
const when = (ctx, ms) => (ms ? `${formatWhen(ms, ctx.config.timezone)} (${ctx.config.timezone})` : 'sin definir');
const STATE_ICON = { borrador: '📝', inscripcion: '🟢', cerrado: '🔒', en_curso: '▶️', finalizado: '🏁', cancelado: '❌' };

async function manage(ctx, t) {
  if (!(await canModerate(ctx, t.groupJid))) throw new UserError('NO_SCOPE', 'Solo puedes gestionar torneos creados en este grupo (o ser SUPERADMIN).');
}

function myTeamFor(ctx, t, argTeam) {
  return argTeam ? ctx.services.teams.require(argTeam) : ctx.services.teams.ownTeam(ctx.user, t.mode);
}

function tournamentInfo(ctx, t) {
  const lines = [
    `${STATE_ICON[t.status]} *${plain(t.name)}* (${t.id}) · ${t.mode} · ${t.status.replace('_', ' ').toUpperCase()}`,
    `👥 Equipos: ${t.teams.length}/${t.maxTeams}${t.status === ST.OPEN || t.status === ST.CLOSED ? ` · con check-in: ${T(ctx).checkedIn(t).length}` : ''}`,
    `🕒 Inicio: ${when(ctx, t.startAt)}`,
  ];
  if (t.registerUntil && t.status === ST.OPEN) lines.push(`📝 Inscripción hasta: ${when(ctx, t.registerUntil)}`);
  lines.push(`🎁 Premio: ${t.prizeCoins ? `${formatNumber(t.prizeCoins)} 🪙 por jugador del campeón` : 'sin premio en monedas'} · ⭐ ${t.pointsPerWin} pts por victoria`);
  if (t.champion) lines.push(`🥇 Campeón: ${tn(ctx, t.champion)}${t.runnerUp ? ` · 🥈 ${tn(ctx, t.runnerUp)}` : ''}`);
  if (t.cancelReason) lines.push(`Motivo: ${plain(t.cancelReason)}`);
  return lines.join('\n');
}

function matchLine(ctx, m) {
  const a = tn(ctx, m.a);
  const b = m.b ? tn(ctx, m.b) : m.state === 'descanso' ? '(descanso)' : '—';
  const tail = m.winner ? ` → ✅ ${tn(ctx, m.winner)}${m.how === 'walkover' ? ' (walkover)' : ''}` : m.state === 'jugando' ? ` → ▶️ ${m.matchId}` : '';
  return `• ${a} vs ${b}${tail}`;
}

function bracketText(ctx, t) {
  if (!t.bracket) return `El torneo ${t.id} todavía no tiene cuadro (se genera al iniciar).`;
  const matches = T(ctx).bracketMatches(t);
  const lines = [`🏆 *${plain(t.name)}* — cuadro`];
  for (const round of t.bracket.rounds) {
    lines.push('', `*${round.name}*`, ...matches.filter((m) => m.round === round.round).map((m) => matchLine(ctx, m)));
  }
  return lines.join('\n');
}

const sub = (name, aliases, description, usageText, permissions, handler, extra = {}) => ({ name, aliases, description, usage: usageText, permissions, handler, ...extra });

const tournamentSubs = [
  sub('crear', ['create'], 'Un administrador crea un torneo de eliminación en el grupo (queda en borrador hasta abrirlo).', 'torneo crear MODO MAX_EQUIPOS NOMBRE', 'ADMIN', async (ctx) => {
    if (ctx.args.length < 3) throw usage(ctx, 'torneo crear MODO MAX_EQUIPOS NOMBRE (por ejemplo: torneo crear 4v4 8 Copa Verano)');
    const t = T(ctx).create({ user: ctx.user, mode: ctx.args[0], maxTeams: ctx.args[1], name: ctx.args.slice(2).join(' '), groupJid: ctx.chatJid });
    return `🏆 Torneo *${plain(t.name)}* (${t.id}) creado en borrador: ${t.mode}, hasta ${t.maxTeams} equipos.\nConfigúralo con *${ctx.prefix}torneo editar ${t.id} premio|puntos|inicio|cierre ...* y ábrelo con *${ctx.prefix}torneo abrir ${t.id}*.`;
  }, { scope: 'group', requiresRegistration: true }),
  sub('editar', ['edit'], 'Edita un torneo en borrador o con inscripción abierta: nombre, max, premio (monedas por jugador campeón), puntos, inicio, cierre.', 'torneo editar ID campo valor', 'ADMIN', async (ctx) => {
    if (ctx.args.length < 3) throw usage(ctx, 'torneo editar ID nombre|max|premio|puntos|inicio|cierre VALOR');
    const t = T(ctx).require(ctx.args[0]);
    await manage(ctx, t);
    const field = ctx.args[1].toLowerCase();
    let value = ctx.args.slice(2).join(' ');
    if (field === 'inicio' || field === 'cierre') {
      if (value.toLowerCase() === 'borrar') value = 'borrar';
      else {
        const w = parseWhen(ctx.args.slice(2), { tz: ctx.config.timezone, now: T(ctx).now() });
        if (!w.ok) throw new UserError('BAD_TIME', w.error);
        value = w.ms;
      }
    }
    T(ctx).edit(t, ctx.user, field, value);
    return `✏️ Torneo ${t.id} actualizado.\n${tournamentInfo(ctx, t)}`;
  }, { requiresRegistration: true }),
  sub('abrir', ['open'], 'Abre la inscripción de un torneo en borrador.', 'torneo abrir ID', 'ADMIN', async (ctx) => {
    const t = T(ctx).require(ctx.args[0]);
    await manage(ctx, t);
    T(ctx).open(t, ctx.user);
    return `🟢 Inscripción abierta en *${plain(t.name)}* (${t.id}, ${t.mode}, ${t.maxTeams} equipos).\nLos capitanes se inscriben con *${ctx.prefix}torneo inscribir ${t.id}*.`;
  }, { requiresRegistration: true }),
  sub('cerrar', ['close'], 'Cierra la inscripción: empieza la fase de check-in.', 'torneo cerrar ID', 'ADMIN', async (ctx) => {
    const t = T(ctx).require(ctx.args[0]);
    await manage(ctx, t);
    T(ctx).close(t, ctx.user);
    return `🔒 Inscripción cerrada en ${t.id} con ${t.teams.length} equipos. Los capitanes deben hacer *${ctx.prefix}torneo checkin ${t.id}*.`;
  }, { requiresRegistration: true }),
  sub('cancelar', ['cancel'], 'Cancela un torneo (y sus partidas pendientes).', 'torneo cancelar ID [motivo]', 'ADMIN', async (ctx) => {
    const t = T(ctx).require(ctx.args[0]);
    await manage(ctx, t);
    T(ctx).cancel(t, ctx.user, ctx.args.slice(1).join(' '));
    return `❌ Torneo ${t.id} cancelado.`;
  }, { requiresRegistration: true }),
  sub('eliminar', ['delete'], 'Elimina un torneo en borrador o cancelado.', 'torneo eliminar ID', 'ADMIN', async (ctx) => {
    const t = T(ctx).require(ctx.args[0]);
    await manage(ctx, t);
    T(ctx).remove(t, ctx.user);
    return `🗑️ Torneo ${t.id} eliminado.`;
  }, { requiresRegistration: true }),
  sub('inscribir', ['unirse', 'join'], 'El capitán o subcapitán inscribe a su equipo completo en un torneo con inscripción abierta.', 'torneo inscribir ID [equipo]', 'USER', async (ctx) => {
    const t = T(ctx).require(ctx.args[0]);
    const team = myTeamFor(ctx, t, ctx.args[1]);
    T(ctx).join(t, ctx.user, team);
    return `✅ *${plain(team.name)}* quedó inscrito en *${plain(t.name)}* (${t.teams.length}/${t.maxTeams}).`;
  }, { requiresRegistration: true }),
  sub('salir', ['leave'], 'Retiras a tu equipo de un torneo (solo antes de que empiece).', 'torneo salir ID [equipo]', 'USER', async (ctx) => {
    const t = T(ctx).require(ctx.args[0]);
    const team = myTeamFor(ctx, t, ctx.args[1]);
    T(ctx).leave(t, ctx.user, team);
    return `👋 *${plain(team.name)}* salió de *${plain(t.name)}*.`;
  }, { requiresRegistration: true }),
  sub('participantes', ['equipos', 'teams'], 'Equipos inscritos en un torneo, con su capitán y check-in.', 'torneo participantes ID', 'USER', async (ctx) => {
    const t = T(ctx).require(ctx.args[0]);
    if (!t.teams.length) return `${t.id} todavía no tiene equipos inscritos.`;
    const lines = t.teams.map((e, i) => {
      const team = ctx.services.teams.db.get('teams', e.teamId);
      const cap = ctx.services.users.find([team?.captain])?.name || '?';
      const dq = t.disqualified.includes(e.teamId) ? ' 🚫 descalificado' : '';
      return `${i + 1}. ${plain(team?.name || e.teamId)} (${e.teamId}) — cap. ${plain(cap)} — ${e.checkedIn ? '✅ check-in' : '⏳ sin check-in'}${dq}`;
    });
    const players = t.teams.reduce((n, e) => n + (ctx.services.teams.db.get('teams', e.teamId)?.members.length || 0), 0);
    return [`👥 *Participantes de ${plain(t.name)}* (${t.teams.length}/${t.maxTeams} equipos · ${players} jugadores)`, ...lines].join('\n');
  }),
  sub('checkin', [], 'El capitán confirma la presencia de su equipo (necesario para jugar).', 'torneo checkin ID [equipo]', 'USER', async (ctx) => {
    const t = T(ctx).require(ctx.args[0]);
    const team = myTeamFor(ctx, t, ctx.args[1]);
    T(ctx).checkin(t, ctx.user, team, true);
    return `✅ Check-in hecho: *${plain(team.name)}* (${T(ctx).checkedIn(t).length}/${t.teams.length} equipos listos).`;
  }, { requiresRegistration: true }),
  sub('checkout', [], 'El capitán retira la confirmación de presencia de su equipo.', 'torneo checkout ID [equipo]', 'USER', async (ctx) => {
    const t = T(ctx).require(ctx.args[0]);
    const team = myTeamFor(ctx, t, ctx.args[1]);
    T(ctx).checkin(t, ctx.user, team, false);
    return `↩️ Check-out hecho: *${plain(team.name)}* ya no está confirmado.`;
  }, { requiresRegistration: true }),
  sub('iniciar', ['start'], 'Inicia el torneo con los equipos que hicieron check-in y genera el cuadro (usa "sorteo" para mezclar el orden).', 'torneo iniciar ID [sorteo]', 'ADMIN', async (ctx) => {
    const t = T(ctx).require(ctx.args[0]);
    await manage(ctx, t);
    T(ctx).start(t, ctx.user, { shuffle: (ctx.args[1] || '').toLowerCase() === 'sorteo' });
    const caps = T(ctx).captainsOf(t);
    return { text: `🏆 *¡${plain(t.name)} comienza!* (${t.seeding})\n\n${bracketText(ctx, t)}\n\nCada capitán reporta con *${ctx.prefix}partida resultado P-xxxx victoria|derrota*.`, mentions: caps };
  }, { requiresRegistration: true }),
  sub('bracket', ['llaves', 'cuadro'], 'Muestra el cuadro del torneo con los ganadores de cada partida.', 'torneo bracket ID', 'USER', async (ctx) => bracketText(ctx, T(ctx).require(ctx.args[0]))),
  sub('ronda', ['round'], 'Partidas de una ronda del torneo (por defecto la actual).', 'torneo ronda ID [N]', 'USER', async (ctx) => {
    const t = T(ctx).require(ctx.args[0]);
    if (!t.bracket) return `El torneo ${t.id} todavía no tiene cuadro.`;
    let n = ctx.args[1] ? Number(ctx.args[1]) : t.bracket.rounds.findIndex((r) => r.matches.some((m) => !m.winner)) + 1;
    if (!ctx.args[1] && n === 0) n = t.bracket.totalRounds;
    if (!Number.isInteger(n) || n < 1 || n > t.bracket.totalRounds) throw new UserError('BAD_ROUND', `La ronda debe estar entre 1 y ${t.bracket.totalRounds}.`);
    const round = t.bracket.rounds[n - 1];
    return [`🏆 *${plain(t.name)}* — ${round.name}`, ...T(ctx).bracketMatches(t).filter((m) => m.round === n).map((m) => matchLine(ctx, m))].join('\n');
  }),
  sub('partidas', ['matches'], 'Partidas en juego del torneo (con su ID de partida para reportar resultados).', 'torneo partidas ID', 'USER', async (ctx) => {
    const t = T(ctx).require(ctx.args[0]);
    const list = T(ctx).pendingMatches(t);
    if (!list.length) return t.bracket ? `No hay partidas en juego en ${t.id}.` : `El torneo ${t.id} todavía no empezó.`;
    return [`▶️ *Partidas en juego — ${plain(t.name)}*`, ...list.map((m) => `• ${m.matchId} (${m.name}): ${tn(ctx, m.a)} vs ${tn(ctx, m.b)}`)].join('\n');
  }),
  sub('proximos', ['upcoming'], 'Torneos con fecha de inicio futura.', 'torneo proximos', 'USER', async (ctx) => {
    const list = T(ctx).upcoming();
    if (!list.length) return 'No hay torneos programados.';
    return ['📅 *Próximos torneos*', ...list.map((t) => `• ${plain(t.name)} (${t.id}, ${t.mode}) — ${when(ctx, t.startAt)} — ${t.status}`)].join('\n');
  }),
  sub('historial', ['history'], 'Últimos torneos finalizados con su campeón.', 'torneo historial', 'USER', async (ctx) => {
    const list = T(ctx).finished(10);
    if (!list.length) return 'Todavía no hay torneos finalizados.';
    return ['📜 *Historial de torneos*', ...list.map((t) => `• ${t.finishedAt.slice(0, 10)} ${plain(t.name)} (${t.id}) — 🥇 ${tn(ctx, t.champion)}`)].join('\n');
  }),
  sub('ganadores', ['winners'], 'Campeones y subcampeones de los torneos finalizados.', 'torneo ganadores', 'USER', async (ctx) => {
    const list = T(ctx).finished(10);
    if (!list.length) return 'Todavía no hay campeones.';
    return ['🥇 *Ganadores*', ...list.map((t) => `• ${plain(t.name)}: 🥇 ${tn(ctx, t.champion)} · 🥈 ${tn(ctx, t.runnerUp)}`)].join('\n');
  }),
  sub('premios', ['prizes'], 'Premio configurado de un torneo y, si terminó, a quién se pagó.', 'torneo premios ID', 'USER', async (ctx) => {
    const t = T(ctx).require(ctx.args[0]);
    const lines = [`🎁 *Premios de ${plain(t.name)}*`, t.prizeCoins ? `🥇 Campeón: ${formatNumber(t.prizeCoins)} 🪙 por jugador · 🥈 Subcampeón: ${formatNumber(Math.floor(t.prizeCoins / 2))} 🪙 por jugador` : 'Este torneo no tiene premio en monedas.', `⭐ Puntos: ${t.pointsPerWin} por victoria · +10 campeón · +5 subcampeón`];
    if (t.status === ST.FINISHED && t.prizes) lines.push(`Pagados: ${t.prizes.champion.length + t.prizes.runnerUp.length} jugadores.`);
    return lines.join('\n');
  }),
  sub('puntos', ['points'], 'Tabla de puntos de un torneo.', 'torneo puntos ID', 'USER', async (ctx) => {
    const t = T(ctx).require(ctx.args[0]);
    const table = T(ctx).pointsTable(t);
    if (!table.length) return `Nadie tiene puntos todavía en ${t.id}.`;
    return [`⭐ *Puntos de ${plain(t.name)}*`, ...table.map((r, i) => `${i + 1}. ${tn(ctx, r.teamId)} — ${r.pts} pts`)].join('\n');
  }),
  sub('ranking', ['top'], 'Ranking global de equipos por puntos de torneos.', 'torneo ranking', 'USER', async (ctx) => {
    const list = T(ctx).globalRanking(10);
    if (!list.length) return 'Todavía no hay ranking de torneos.';
    return ['🏆 *Ranking de torneos*', ...list.map((r, i) => `${i + 1}. ${plain(r.name)} — ${r.points} pts · ${r.titles} títulos · ${r.wins} victorias`)].join('\n');
  }),
  sub('stats', ['estadisticas'], 'Estadísticas de torneos de un equipo (el tuyo si no indicas otro).', 'torneo stats [equipo]', 'USER', async (ctx) => {
    const team = ctx.args[0] ? ctx.services.teams.require(ctx.args[0]) : ctx.user ? ctx.services.teams.ownTeam(ctx.user) : null;
    if (!team) throw usage(ctx, 'torneo stats ID_EQUIPO');
    const r = T(ctx).teamStats(team.id);
    if (!r) return `${plain(team.name)} todavía no terminó ningún torneo.`;
    return `📊 *${plain(team.name)}* en torneos: ${r.played} jugados · ${r.titles} títulos · ${r.runnerUps} subcampeonatos · ${r.wins} victorias · ${r.points} pts`;
  }),
  sub('descalificar', ['dq'], 'Un administrador descalifica a un equipo de un torneo en curso (pierde por walkover).', 'torneo descalificar ID equipo', 'ADMIN', async (ctx) => {
    if (ctx.args.length < 2) throw usage(ctx, 'torneo descalificar ID EQUIPO');
    const t = T(ctx).require(ctx.args[0]);
    await manage(ctx, t);
    const team = ctx.services.teams.require(ctx.args[1]);
    T(ctx).disqualify(t, ctx.user, team);
    return `🚫 *${plain(team.name)}* fue descalificado de ${t.id}.${t.status === ST.FINISHED ? ` Torneo finalizado: 🥇 ${tn(ctx, t.champion)}.` : ''}`;
  }, { requiresRegistration: true }),
  sub('finalizar', ['finish'], 'Un administrador finaliza un torneo cuya final ya tiene ganador (normalmente ocurre solo).', 'torneo finalizar ID', 'ADMIN', async (ctx) => {
    const t = T(ctx).require(ctx.args[0]);
    await manage(ctx, t);
    T(ctx).finish(t, ctx.user);
    return `🏁 Torneo ${t.id} finalizado. 🥇 ${tn(ctx, t.champion)}`;
  }, { requiresRegistration: true }),
  sub('info', ['ver'], 'Detalles de un torneo.', 'torneo info ID', 'USER', async (ctx) => tournamentInfo(ctx, T(ctx).require(ctx.args[0]))),
  sub('lista', ['list'], 'Torneos activos (borrador no se muestra) y recientes.', 'torneo lista', 'USER', async (ctx) => {
    const list = T(ctx).all().filter((t) => t.status !== ST.DRAFT && t.status !== ST.CANCELLED).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 10);
    if (!list.length) return 'No hay torneos activos ahora mismo.';
    return ['🏆 *Torneos*', ...list.map((t) => `${STATE_ICON[t.status]} ${plain(t.name)} (${t.id}) · ${t.mode} · ${t.teams.length}/${t.maxTeams} · ${t.status.replace('_', ' ')}`)].join('\n');
  }),
];

// ---------- scrims ----------

const SCRIM_ICON = { abierto: '🟢', lleno: '🔒', en_curso: '▶️', finalizado: '🏁', cancelado: '❌' };

function scrimInfo(ctx, s) {
  const lines = [`${SCRIM_ICON[s.status]} *Scrim ${s.id}* · ${s.mode} · ${s.status.replace('_', ' ').toUpperCase()}`, `🕒 ${when(ctx, s.scheduledAt)}`, `🛡️ ${tn(ctx, s.host)} (${s.host})`, s.guest ? `⚔️ ${tn(ctx, s.guest)} (${s.guest})` : '⚔️ Rival: pendiente'];
  if (s.status === SCRIM_ST.FULL || s.status === SCRIM_ST.RUNNING) lines.push(`✅ Check-in: anfitrión ${s.checkins.host ? 'sí' : 'no'} · rival ${s.checkins.guest ? 'sí' : 'no'}`);
  if (s.matchId) lines.push(`🎮 Partida: ${s.matchId}`);
  if (s.result) lines.push(`🏁 ${s.result.winner === 'draw' ? 'Empate' : `Ganó ${tn(ctx, s.result.winner === 'host' ? s.host : s.guest)}`}`);
  if (s.cancelReason) lines.push(`Motivo: ${plain(s.cancelReason)}`);
  return lines.join('\n');
}

async function scrimAdmin(ctx, s) {
  return canModerate(ctx, s.groupJid);
}

const scrimSubs = [
  sub('crear', ['create'], 'El capitán o subcapitán programa un scrim con su equipo completo: indica la hora (HH:MM) o fecha y hora (AAAA-MM-DD HH:MM).', 'scrim crear HORA [modo]', 'USER', async (ctx) => {
    const modeArg = ctx.args.find((a) => parseMode(a));
    const parts = ctx.args.filter((a) => a !== modeArg);
    if (!parts.length) throw usage(ctx, 'scrim crear HH:MM [modo]  o  scrim crear AAAA-MM-DD HH:MM [modo]');
    const w = parseWhen(parts, { tz: ctx.config.timezone, now: S(ctx).now(), maxDays: 30 });
    if (!w.ok) throw new UserError('BAD_TIME', w.error);
    const team = ctx.services.teams.ownTeam(ctx.user, modeArg);
    const s = S(ctx).create({ user: ctx.user, team, whenMs: w.ms, groupJid: ctx.isGroup ? ctx.chatJid : null });
    return `🎯 Scrim *${s.id}* creado (${s.mode}) para ${when(ctx, s.scheduledAt)}.\nUn equipo rival se une con *${ctx.prefix}scrim unirse ${s.id}*.`;
  }, { requiresRegistration: true }),
  sub('info', ['ver'], 'Detalles de un scrim.', 'scrim info ID', 'USER', async (ctx) => scrimInfo(ctx, S(ctx).require(ctx.args[0]))),
  sub('unirse', ['join'], 'El capitán o subcapitán de un equipo completo se une como rival a un scrim abierto.', 'scrim unirse ID', 'USER', async (ctx) => {
    const s = S(ctx).require(ctx.args[0]);
    const team = ctx.services.teams.ownTeam(ctx.user, s.mode);
    S(ctx).join(s, ctx.user, team);
    return `🔒 Scrim ${s.id} completo: ${tn(ctx, s.host)} vs ${tn(ctx, s.guest)} — ${when(ctx, s.scheduledAt)}.\nCheck-in desde ${ctx.config.scrims.checkinMinutes} min antes con *${ctx.prefix}scrim checkin ${s.id}*.`;
  }, { requiresRegistration: true }),
  sub('salir', ['leave'], 'El equipo rival se retira de un scrim lleno (vuelve a abierto).', 'scrim salir ID', 'USER', async (ctx) => {
    const s = S(ctx).leave(S(ctx).require(ctx.args[0]), ctx.user);
    return `↩️ Tu equipo se retiró del scrim ${s.id}. Vuelve a estar abierto.`;
  }, { requiresRegistration: true }),
  sub('equipos', ['teams'], 'Equipos de un scrim con sus jugadores.', 'scrim equipos ID', 'USER', async (ctx) => {
    const s = S(ctx).require(ctx.args[0]);
    const out = [`👥 *Equipos del scrim ${s.id}*`];
    for (const side of ['host', 'guest']) {
      const team = s[side] ? ctx.services.teams.db.get('teams', s[side]) : null;
      out.push(team ? `*${plain(team.name)}* (${team.id}): ${team.members.map((m) => plain(ctx.services.users.find([m])?.name || m)).join(', ')}` : '*Rival*: pendiente');
    }
    return out.join('\n');
  }),
  sub('lista', ['list'], 'Scrims abiertos o programados, por orden de hora.', 'scrim lista', 'USER', async (ctx) => {
    const list = S(ctx).upcoming().slice(0, 10);
    if (!list.length) return 'No hay scrims programados.';
    return ['🎯 *Scrims*', ...list.map((s) => `${SCRIM_ICON[s.status]} ${s.id} ${s.mode} — ${when(ctx, s.scheduledAt)} — ${tn(ctx, s.host)}${s.guest ? ` vs ${tn(ctx, s.guest)}` : ' (busca rival)'}`)].join('\n');
  }),
  sub('horario', ['hora', 'when'], 'Fecha y hora de un scrim y el tiempo que falta.', 'scrim horario ID', 'USER', async (ctx) => {
    const s = S(ctx).require(ctx.args[0]);
    const diff = s.scheduledAt - S(ctx).now();
    const mins = Math.round(Math.abs(diff) / 60000);
    const rel = diff >= 0 ? `faltan ${mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`}` : `empezó hace ${mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`}`;
    return `🕒 Scrim ${s.id}: ${when(ctx, s.scheduledAt)} — ${rel}.`;
  }),
  sub('checkin', [], 'Cada capitán confirma su presencia (desde unos minutos antes). Cuando ambos lo hacen se crea la partida.', 'scrim checkin ID', 'USER', async (ctx) => {
    const r = S(ctx).checkin(S(ctx).require(ctx.args[0]), ctx.user);
    return r.started
      ? `▶️ ¡Check-in completo! Scrim ${r.scrim.id} en curso (partida ${r.scrim.matchId}). Al terminar: *${ctx.prefix}scrim resultado ${r.scrim.id} victoria|derrota|empate*.`
      : `✅ Check-in hecho. Falta el otro equipo.`;
  }, { requiresRegistration: true }),
  sub('resultado', ['result'], 'Cada capitán reporta el resultado desde SU equipo; si coinciden se finaliza, si no queda en disputa.', 'scrim resultado ID victoria|derrota|empate', 'USER', async (ctx) => {
    const s = S(ctx).require(ctx.args[0]);
    const o = { victoria: 'win', derrota: 'loss', empate: 'draw' }[(ctx.args[1] || '').toLowerCase()];
    if (!o) throw usage(ctx, 'scrim resultado ID victoria|derrota|empate');
    const r = S(ctx).report(s, ctx.user, o);
    if (r.state === 'finished') return `🏁 Scrim ${s.id} finalizado: ${s.result.winner === 'draw' ? 'empate' : `ganó ${tn(ctx, s.result.winner === 'host' ? s.host : s.guest)}`} (+${s.result.winner === 'draw' ? SCRIM_POINTS.draw : SCRIM_POINTS.win} pts al ganador/empate).`;
    if (r.state === 'disputed') return `⚠️ Los reportes no coinciden. Un administrador debe resolver con *${ctx.prefix}scrim resolver ${s.id} A|B|empate*.`;
    return '🧾 Reporte registrado. Falta el del otro capitán.';
  }, { requiresRegistration: true }),
  sub('resolver', ['resolve'], 'Un administrador fija el resultado de un scrim en curso (A = anfitrión, B = rival, o empate).', 'scrim resolver ID A|B|empate', 'ADMIN', async (ctx) => {
    const s = S(ctx).require(ctx.args[0]);
    if (!(await scrimAdmin(ctx, s))) throw new UserError('NO_SCOPE', 'Solo puedes resolver scrims creados en este grupo (o ser SUPERADMIN).');
    const w = { a: 'host', b: 'guest', empate: 'draw' }[(ctx.args[1] || '').toLowerCase()];
    if (!w) throw usage(ctx, 'scrim resolver ID A|B|empate');
    S(ctx).resolve(s, ctx.user, w);
    return `🏁 Scrim ${s.id} finalizado por un administrador.`;
  }, { requiresRegistration: true }),
  sub('ranking', ['top'], 'Ranking de equipos por puntos de scrims (victoria 3, empate 1).', 'scrim ranking', 'USER', async (ctx) => {
    const list = S(ctx).ranking(10);
    if (!list.length) return 'Todavía no hay ranking de scrims.';
    return ['🏆 *Ranking de scrims*', ...list.map((r, i) => `${i + 1}. ${plain(r.name)} — ${r.points} pts · ${r.wins}V ${r.draws}E ${r.losses}D`)].join('\n');
  }),
  sub('estadisticas', ['stats'], 'Estadísticas de scrims de un equipo (el tuyo si no indicas otro).', 'scrim estadisticas [equipo]', 'USER', async (ctx) => {
    const team = ctx.args[0] ? ctx.services.teams.require(ctx.args[0]) : ctx.user ? ctx.services.teams.ownTeam(ctx.user) : null;
    if (!team) throw usage(ctx, 'scrim estadisticas ID_EQUIPO');
    const r = S(ctx).teamStats(team.id);
    if (!r) return `${plain(team.name)} todavía no jugó scrims.`;
    return `📊 *${plain(team.name)}* en scrims: ${r.played} jugados · ${r.wins}V ${r.draws}E ${r.losses}D · ${r.points} pts`;
  }),
  sub('cancelar', ['cancel'], 'El anfitrión (o un administrador) cancela un scrim. En curso solo un administrador.', 'scrim cancelar ID [motivo]', 'USER', async (ctx) => {
    const s = S(ctx).require(ctx.args[0]);
    S(ctx).cancel(s, ctx.user, { isAdmin: await scrimAdmin(ctx, s), reason: ctx.args.slice(1).join(' ') });
    return `❌ Scrim ${s.id} cancelado.`;
  }, { requiresRegistration: true }),
  sub('historial', ['history'], 'Últimos scrims finalizados o cancelados (de un equipo si lo indicas).', 'scrim historial [equipo]', 'USER', async (ctx) => {
    const team = ctx.args[0] ? ctx.services.teams.require(ctx.args[0]) : null;
    const list = S(ctx).history(team?.id || null, 10);
    if (!list.length) return 'No hay scrims en el historial.';
    return ['📜 *Historial de scrims*', ...list.map((s) => `• ${String(s.finishedAt).slice(0, 10)} ${s.id} ${tn(ctx, s.host)} vs ${tn(ctx, s.guest)} — ${s.status === 'cancelado' ? 'cancelado' : s.result.winner === 'draw' ? 'empate' : `ganó ${tn(ctx, s.result.winner === 'host' ? s.host : s.guest)}`}`)].join('\n');
  }),
];

function build() {
  const intro = (cmd, subs) => (ctx) => {
    if (ctx.args.length) throw new UserError('UNKNOWN_SUB', `Subcomando desconocido "${plain(ctx.args[0])}". Usa *${ctx.prefix}help ${cmd}*.`);
    return [`📌 *${ctx.prefix}${cmd}* — subcomandos:`, ...subs.filter((s) => s.permissions === 'USER').map((s) => `• ${ctx.prefix}${s.usage}`)].join('\n');
  };
  return [
    {
      name: 'torneo',
      aliases: ['tournament', 'torneos'],
      description: 'Torneos de eliminación entre equipos: crear, inscribir, check-in, cuadro, rondas, partidas, ganadores, premios, puntos y ranking.',
      usage: 'torneo [subcomando]',
      example: 'torneo lista',
      category: 'torneos',
      permissions: 'USER',
      cooldown: 2,
      subcommands: tournamentSubs,
      handler: intro('torneo', tournamentSubs),
    },
    {
      name: 'scrim',
      aliases: ['scrims'],
      description: 'Scrims programados entre dos equipos: crear, unirse, check-in, resultado, ranking, estadísticas e historial.',
      usage: 'scrim [subcomando]',
      example: 'scrim lista',
      category: 'scrims',
      permissions: 'USER',
      cooldown: 2,
      subcommands: scrimSubs,
      handler: intro('scrim', scrimSubs),
    },
  ];
}

module.exports = { name: 'torneos', build, jid, tag };
