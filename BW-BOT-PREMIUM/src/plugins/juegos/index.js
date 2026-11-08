'use strict';

const jid = require('../../whatsapp/jid');
const { UserError } = require('../../services/users');
const { plain } = require('../../utils/text');
const { tag } = require('../shared');
const { formatNumber } = require('../../utils/validators');

const parts = [require('../../games/simple'), require('../../games/questions'), require('../../games/puzzles'), require('../../games/versus'), require('../../games/arena')];

/** Módulos de sesión que el GameService necesita conocer (para sus temporizadores). */
const GAME_MODULES = parts.flatMap((p) => p.modules);

const TYPE_LABEL = { ppt: 'Piedra/Papel/Tijera', dados: 'Dados', coinflip: 'Coinflip', trivia: 'Trivia', quizff: 'Quiz Free Fire', adivina: 'Adivina', anagrama: 'Anagrama', memoria: 'Memoria', reaccion: 'Reacción', duelo: 'Duelo', batalla: 'Batalla', supervivencia: 'Supervivencia', eliminacion: 'Eliminación' };

function statsText(svc, user) {
  const p = svc.playerStats(user.jid);
  const rows = Object.entries(p.byGame).sort((a, b) => b[1].wins - a[1].wins);
  const lines = [`🎮 *Juegos de ${plain(user.name)}*`, `Partidas: ${p.total.played} · Victorias: ${p.total.wins} · Monedas ganadas en premios: ${formatNumber(p.total.coins)}`];
  for (const [t, g] of rows) lines.push(`• ${TYPE_LABEL[t] || t}: ${g.wins}/${g.played}`);
  if (!rows.length) lines.push('Todavía no jugó ningún juego.');
  return lines.join('\n');
}

const juegosSubs = [
  {
    name: 'lista',
    aliases: ['list'],
    description: 'Lista los juegos disponibles y cómo se juegan.',
    usage: 'juegos lista',
    permissions: 'USER',
    async handler(ctx) {
      const p = ctx.prefix;
      return [
        '🎮 *Juegos disponibles*',
        '',
        '*Contra el bot (con apuesta opcional)*',
        `• ${p}ppt piedra|papel|tijera [apuesta]`,
        `• ${p}dados [apuesta]`,
        `• ${p}coinflip cara|cruz [apuesta]`,
        '',
        '*Para todo el grupo*',
        `• ${p}trivia — cultura general`,
        `• ${p}quizff — Free Fire`,
        `• ${p}adivina — número secreto`,
        `• ${p}anagrama — ordena las letras`,
        `• ${p}memoria — secuencia al revés`,
        `• ${p}reaccion — reflejos (.ya)`,
        '',
        '*Con sala y rondas*',
        `• ${p}duelo @usuario [apuesta] — 1 contra 1 por turnos`,
        `• ${p}batalla — todos contra todos`,
        `• ${p}supervivencia — puertas seguras`,
        `• ${p}eliminacion — cuentas rápidas`,
        '',
        `Tus estadísticas: *${p}juegos stats* · Estado del chat: *${p}juegos estado*`,
      ].join('\n');
    },
  },
  {
    name: 'estado',
    aliases: ['status'],
    description: 'Muestra si hay un juego en curso en este chat.',
    usage: 'juegos estado',
    permissions: 'USER',
    scope: 'group',
    async handler(ctx) {
      const s = ctx.services.games.activeInChat(ctx.chatJid);
      if (!s) return 'No hay ningún juego en curso en este chat.';
      const left = s.deadline ? Math.max(0, Math.round((s.deadline - ctx.services.games.now()) / 1000)) : null;
      return `🎮 Juego en curso: *${TYPE_LABEL[s.type] || s.type}* (${s.status})${left !== null ? ` · ${left} s para el siguiente paso` : ''} · jugadores: ${s.players.length}`;
    },
  },
  {
    name: 'stats',
    aliases: ['estadisticas'],
    description: 'Estadísticas de juegos tuyas o de otra persona (mencionándola).',
    usage: 'juegos stats [@usuario]',
    permissions: 'USER',
    async handler(ctx) {
      const t = ctx.mentions[0] || ctx.quotedSender;
      const user = t ? ctx.services.users.find([t]) : ctx.user;
      if (!user) throw new UserError('NOT_REGISTERED', t ? 'Esa persona no está registrada.' : `Primero regístrate con *${ctx.prefix}registro*.`);
      return statsText(ctx.services.games, user);
    },
  },
  {
    name: 'cancelar',
    aliases: ['cancel'],
    description: 'Un administrador cancela el juego en curso del chat y se devuelven todas las apuestas.',
    usage: 'juegos cancelar',
    permissions: 'ADMIN',
    scope: 'group',
    async handler(ctx) {
      const svc = ctx.services.games;
      const s = svc.activeInChat(ctx.chatJid);
      if (!s) throw new UserError('NO_GAME', 'No hay ningún juego en curso en este chat.');
      svc.cancel(s, 'cancelado por un administrador', ctx.user?.jid || ctx.sender);
      return `❌ Juego *${TYPE_LABEL[s.type] || s.type}* cancelado. Apuestas devueltas.`;
    },
  },
];

function build() {
  const commands = parts.flatMap((p) => p.commands);
  commands.push({
    name: 'juegos',
    aliases: ['games'],
    description: 'Catálogo de juegos interactivos, estado del juego del chat, tus estadísticas y cancelación por administradores.',
    usage: 'juegos [subcomando]',
    example: 'juegos lista',
    category: 'juegos',
    permissions: 'USER',
    cooldown: 3,
    subcommands: juegosSubs,
    async handler(ctx) {
      if (ctx.args.length) throw new UserError('UNKNOWN_SUB', `Subcomando desconocido "${plain(ctx.args[0])}". Usa *${ctx.prefix}juegos lista*.`);
      return juegosSubs[0].handler(ctx);
    },
  });
  return commands;
}

module.exports = { name: 'juegos', build, GAME_MODULES, TYPE_LABEL, tag, jid };
