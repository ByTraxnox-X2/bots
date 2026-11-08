'use strict';

const { games, tag, UserError } = require('./util');

const base = (name, description, usage, example, extra = {}) => ({ name, description, usage, example, category: 'juegos', permissions: 'USER', cooldown: 3, requiresRegistration: true, ...extra });

/**
 * Juego instantáneo contra el bot con apuesta opcional. La apuesta se descuenta primero;
 * victoria paga el doble, empate devuelve la apuesta, derrota la pierde. Sin apuesta no hay premio de monedas.
 */
function settleInstant(ctx, type, amount, outcome) {
  const svc = games(ctx);
  const jidValue = ctx.user.jid;
  if (outcome === 'win' && amount) svc.users.addCoins([jidValue], amount * 2, `premio ${type}`);
  if (outcome === 'draw' && amount) svc.users.addCoins([jidValue], amount, `devolución ${type}`);
  svc.recordStat(jidValue, type, outcome === 'win');
  svc.db.touch();
  if (!amount) return '';
  const coins = svc.users.find([jidValue]).coins;
  return outcome === 'win' ? `\n💰 Ganaste ${amount} 🪙 (saldo: ${coins}).` : outcome === 'draw' ? `\n↩️ Se devuelve tu apuesta (saldo: ${coins}).` : `\n💸 Perdiste ${amount} 🪙 (saldo: ${coins}).`;
}

const MOVES = ['piedra', 'papel', 'tijera'];
const ICON = { piedra: '🪨', papel: '📄', tijera: '✂️' };

const ppt = base('ppt', 'Piedra, papel o tijera contra el bot, con apuesta opcional en monedas virtuales.', 'ppt piedra|papel|tijera [apuesta]', 'ppt piedra 10', {
  aliases: ['piedrapapeltijera'],
  async handler(ctx) {
    const svc = games(ctx);
    const move = (ctx.args[0] || '').toLowerCase();
    if (!MOVES.includes(move)) throw new UserError('USAGE', `Uso: *${ctx.prefix}ppt piedra|papel|tijera [apuesta]*`);
    const amount = svc.parseBet(ctx.args[1]);
    svc.users.require([ctx.user.jid]);
    if (amount) svc.users.spendCoins([ctx.user.jid], amount, 'apuesta ppt');
    const bot = svc.pick(MOVES);
    const outcome = move === bot ? 'draw' : (MOVES.indexOf(move) + 1) % 3 === MOVES.indexOf(bot) ? 'loss' : 'win';
    // piedra(0) pierde con papel(1); papel(1) con tijera(2); tijera(2) con piedra(0)
    const title = outcome === 'win' ? '🏆 ¡Ganaste!' : outcome === 'loss' ? '😵 Perdiste' : '🤝 Empate';
    return `${ICON[move]} Tú: *${move}*  vs  ${ICON[bot]} Bot: *${bot}*\n${title}${settleInstant(ctx, 'ppt', amount, outcome)}`;
  },
});

const FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
const dados = base('dados', 'Lanzas dos dados contra el bot: gana la suma más alta. Apuesta opcional en monedas virtuales.', 'dados [apuesta]', 'dados 10', {
  aliases: ['dice'],
  async handler(ctx) {
    const svc = games(ctx);
    const amount = svc.parseBet(ctx.args[0]);
    svc.users.require([ctx.user.jid]);
    if (amount) svc.users.spendCoins([ctx.user.jid], amount, 'apuesta dados');
    const roll = () => [1 + svc.randInt(6), 1 + svc.randInt(6)];
    const a = roll();
    const b = roll();
    const sa = a[0] + a[1];
    const sb = b[0] + b[1];
    const outcome = sa > sb ? 'win' : sa < sb ? 'loss' : 'draw';
    const title = outcome === 'win' ? '🏆 ¡Ganaste!' : outcome === 'loss' ? '😵 Perdiste' : '🤝 Empate';
    return `🎲 Tú: ${FACES[a[0] - 1]} ${FACES[a[1] - 1]} = *${sa}*\n🤖 Bot: ${FACES[b[0] - 1]} ${FACES[b[1] - 1]} = *${sb}*\n${title}${settleInstant(ctx, 'dados', amount, outcome)}`;
  },
});

const coinflip = base('coinflip', 'Lanza una moneda: elige cara o cruz. Apuesta opcional en monedas virtuales (gana el doble si aciertas).', 'coinflip cara|cruz [apuesta]', 'coinflip cara 10', {
  aliases: ['moneda', 'cf'],
  async handler(ctx) {
    const svc = games(ctx);
    const pickSide = (ctx.args[0] || '').toLowerCase();
    if (!['cara', 'cruz'].includes(pickSide)) throw new UserError('USAGE', `Uso: *${ctx.prefix}coinflip cara|cruz [apuesta]*`);
    const amount = svc.parseBet(ctx.args[1]);
    svc.users.require([ctx.user.jid]);
    if (amount) svc.users.spendCoins([ctx.user.jid], amount, 'apuesta coinflip');
    const result = svc.randInt(2) === 0 ? 'cara' : 'cruz';
    const outcome = result === pickSide ? 'win' : 'loss';
    return `🪙 Elegiste *${pickSide}* y salió *${result}*.\n${outcome === 'win' ? '🏆 ¡Acertaste!' : '😵 Fallaste'}${settleInstant(ctx, 'coinflip', amount, outcome)}`;
  },
});

module.exports = { modules: [], commands: [ppt, dados, coinflip], tag };
