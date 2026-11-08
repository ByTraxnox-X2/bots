'use strict';

const { games, tag, UserError, plain } = require('./util');
const { targetUser } = require('../plugins/shared');

const START_HP = 100;
const MAX_HEALS = 3;
const TURN_SEC = 60;
const LOBBY_SEC = 60;

const hpLine = (s) => s.players.map((j) => `${tag(j)} ❤️ ${s.data.hp[j]}`).join('  ·  ');
const other = (s, j) => s.players.find((p) => p !== j);

function statusText(s) {
  const d = s.data;
  return [`⚔️ *DUELO*${d.bet ? ` · apuesta ${d.bet} 🪙 c/u` : ''}`, hpLine(s), `🎯 Turno de ${tag(d.turn)} — *atacar*, *defender* o *curar* (${TURN_SEC} s)`].join('\n');
}

function endWith(svc, s, winner, why) {
  const loser = other(s, winner);
  const pot = svc.pot(s);
  svc.settle(s, [winner]);
  svc.finish(s, { winners: [winner], summary: why });
  const prize = pot ? '' : `\n🎁 ${svc.prize(winner)}`;
  return { text: `🏆 *${tag(winner)} gana el duelo* contra ${tag(loser)} (${why}).${pot ? `\n💰 Se lleva el bote de ${pot} 🪙.` : ''}${prize}`, mentions: [winner, loser] };
}

const mod = {
  type: 'duelo',
  async onTimer(svc, s) {
    if (s.status === 'lobby') {
      svc.cancel(s, 'el desafío no fue aceptado a tiempo');
      return { text: `⌛ El desafío de ${tag(s.data.challenger)} a ${tag(s.data.opponent)} venció sin respuesta. Apuestas devueltas.`, mentions: [s.data.challenger, s.data.opponent] };
    }
    const loserJ = s.data.turn;
    return endWith(svc, s, other(s, loserJ), `${plain('tiempo agotado')}: ${tag(loserJ)} no actuó`);
  },
};

function act(ctx, kind) {
  const svc = games(ctx);
  const s = svc.activeOf(ctx.chatJid, 'duelo');
  if (!s || s.status !== 'active') throw new UserError('NO_GAME', 'No hay un duelo en curso aquí.');
  if (!s.players.includes(ctx.user.jid)) throw new UserError('NOT_PLAYER', 'No participas en este duelo.');
  if (s.data.turn !== ctx.user.jid) throw new UserError('NOT_TURN', 'No es tu turno.');
  const me = ctx.user.jid;
  const foe = other(s, me);
  const d = s.data;
  let line;
  if (kind === 'atacar') {
    let dmg = 15 + svc.randInt(11);
    if (d.shield[foe]) {
      dmg = Math.floor(dmg / 2);
      d.shield[foe] = false;
      line = `💥 ${tag(me)} ataca y ${tag(foe)} bloquea parte del golpe: -${dmg}.`;
    } else {
      line = `💥 ${tag(me)} ataca a ${tag(foe)}: -${dmg}.`;
    }
    d.hp[foe] = Math.max(0, d.hp[foe] - dmg);
  } else if (kind === 'defender') {
    d.shield[me] = true;
    line = `🛡️ ${tag(me)} se prepara: el próximo golpe recibido se reduce a la mitad.`;
  } else {
    if (d.heals[me] >= MAX_HEALS) throw new UserError('NO_HEALS', `Ya usaste tus ${MAX_HEALS} curaciones.`);
    const heal = 10 + svc.randInt(11);
    d.heals[me] += 1;
    const before = d.hp[me];
    d.hp[me] = Math.min(START_HP, d.hp[me] + heal);
    line = `💚 ${tag(me)} se cura +${d.hp[me] - before}.`;
  }
  if (d.hp[foe] <= 0) {
    const end = endWith(svc, s, me, 'dejó a su rival sin vida');
    return { text: `${line}\n${end.text}`, mentions: end.mentions };
  }
  d.turn = foe;
  svc.setTimer(s, TURN_SEC);
  return { text: `${line}\n${statusText(s)}`, mentions: s.players };
}

const sub = (name, aliases, description, usage, handler) => ({ name, aliases, description, usage, permissions: 'USER', handler });

const duelo = {
  name: 'duelo',
  aliases: ['duel'],
  description: 'Duelo por turnos 1 contra 1 (atacar, defender, curar) con apuesta opcional: desafía mencionando a alguien y esa persona acepta.',
  usage: 'duelo @usuario [apuesta]',
  example: 'duelo @usuario 20',
  category: 'juegos',
  permissions: 'USER',
  cooldown: 2,
  scope: 'group',
  requiresRegistration: true,
  subcommands: [
    sub('aceptar', ['accept'], 'Aceptas el desafío de duelo que te hicieron.', 'duelo aceptar', async (ctx) => {
      const svc = games(ctx);
      const s = svc.activeOf(ctx.chatJid, 'duelo');
      if (!s || s.status !== 'lobby') throw new UserError('NO_GAME', 'No hay ningún desafío de duelo pendiente aquí.');
      if (s.data.opponent !== ctx.user.jid) throw new UserError('NOT_CHALLENGED', 'Ese desafío no es para ti.');
      if (s.data.bet) svc.escrow(s, ctx.user, s.data.bet);
      s.players = [s.data.challenger, s.data.opponent];
      s.status = 'active';
      s.data.hp = { [s.data.challenger]: START_HP, [s.data.opponent]: START_HP };
      s.data.shield = {};
      s.data.heals = { [s.data.challenger]: 0, [s.data.opponent]: 0 };
      s.data.turn = s.data.challenger;
      svc.setTimer(s, TURN_SEC);
      return { text: `⚔️ ¡Duelo aceptado!\n${statusText(s)}\nComandos: *${ctx.prefix}duelo atacar*, *defender*, *curar*, *rendirse*.`, mentions: s.players };
    }),
    sub('rechazar', ['reject'], 'Rechazas el desafío de duelo (se devuelve la apuesta al retador).', 'duelo rechazar', async (ctx) => {
      const svc = games(ctx);
      const s = svc.activeOf(ctx.chatJid, 'duelo');
      if (!s || s.status !== 'lobby') throw new UserError('NO_GAME', 'No hay ningún desafío de duelo pendiente aquí.');
      if (s.data.opponent !== ctx.user.jid && s.data.challenger !== ctx.user.jid) throw new UserError('NOT_CHALLENGED', 'Ese desafío no es para ti.');
      svc.cancel(s, 'rechazado', ctx.user.jid);
      return '❌ Desafío de duelo cancelado. Apuestas devueltas.';
    }),
    sub('atacar', ['attack'], 'En tu turno, golpeas a tu rival (15-25 de daño; se reduce a la mitad si se defendía).', 'duelo atacar', async (ctx) => act(ctx, 'atacar')),
    sub('defender', ['defend'], 'En tu turno, reduces a la mitad el próximo golpe que recibas.', 'duelo defender', async (ctx) => act(ctx, 'defender')),
    sub('curar', ['heal'], 'En tu turno, recuperas 10-20 de vida (máximo 3 veces por duelo).', 'duelo curar', async (ctx) => act(ctx, 'curar')),
    sub('rendirse', ['surrender'], 'Abandonas el duelo y tu rival gana.', 'duelo rendirse', async (ctx) => {
      const svc = games(ctx);
      const s = svc.activeOf(ctx.chatJid, 'duelo');
      if (!s || s.status !== 'active' || !s.players.includes(ctx.user.jid)) throw new UserError('NO_GAME', 'No participas en ningún duelo en curso.');
      return endWith(svc, s, other(s, ctx.user.jid), `${tag(ctx.user.jid)} se rindió`);
    }),
    sub('estado', ['status'], 'Muestra el estado del duelo en curso.', 'duelo estado', async (ctx) => {
      const s = games(ctx).activeOf(ctx.chatJid, 'duelo');
      if (!s) throw new UserError('NO_GAME', 'No hay ningún duelo en curso aquí.');
      if (s.status === 'lobby') return { text: `⏳ ${tag(s.data.challenger)} desafió a ${tag(s.data.opponent)}. Debe usar *${ctx.prefix}duelo aceptar*.`, mentions: [s.data.challenger, s.data.opponent] };
      return { text: statusText(s), mentions: s.players };
    }),
  ],
  async handler(ctx) {
    const svc = games(ctx);
    const target = targetUser(ctx, 'duelo @usuario [apuesta]');
    if (target.jid === ctx.user.jid) throw new UserError('SELF', 'No puedes retarte a ti mismo.');
    const amount = svc.parseBet(ctx.args.find((a) => /^\d+$/.test(a)));
    if (amount && ctx.user.coins < amount) throw new UserError('INSUFFICIENT_FUNDS', `No tienes ${amount} monedas para apostar.`);
    if (amount && target.coins < amount) throw new UserError('TARGET_FUNDS', 'Tu rival no tiene monedas suficientes para esa apuesta.');
    const s = svc.create({ type: 'duelo', chatJid: ctx.chatJid, host: ctx.user.jid, status: 'lobby', data: { challenger: ctx.user.jid, opponent: target.jid, bet: amount } });
    svc.escrow(s, ctx.user, amount);
    svc.setTimer(s, LOBBY_SEC);
    return {
      text: `⚔️ *DESAFÍO DE DUELO*\n${tag(ctx.user.jid)} desafía a ${tag(target.jid)}${amount ? ` apostando ${amount} 🪙 cada uno` : ''}.\n✅ *${ctx.prefix}duelo aceptar* · ❌ *${ctx.prefix}duelo rechazar* (${LOBBY_SEC} s)`,
      mentions: [ctx.user.jid, target.jid],
    };
  },
};

module.exports = { modules: [mod], commands: [duelo], START_HP };
