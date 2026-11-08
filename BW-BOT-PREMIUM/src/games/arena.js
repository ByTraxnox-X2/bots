'use strict';

const { games, tag, UserError, plain } = require('./util');
const { targetUser } = require('../plugins/shared');

/**
 * Juegos multijugador por rondas con sala previa (lobby): batalla, supervivencia y eliminación.
 * Flujo común: el comando crea la sala → la gente se une → el anfitrión inicia (o se inicia sola al vencer la sala si hay
 * jugadores suficientes) → rondas que se resuelven cuando todos actuaron o vence el temporizador → ganadores con premio.
 * Todo el estado vive en la sesión (persistente); la aleatoriedad la pone solo el servicio (randInt).
 */

const mentionsOf = (list) => [...new Set(list)];
const tags = (list) => list.map(tag).join(', ');

function startRound(svc, s, hooks) {
  s.data.round += 1;
  s.data.actions = {};
  hooks.prepare?.(svc, s);
  svc.setTimer(s, svc.config.games.roundSec);
}

function conclude(svc, s, winners, why) {
  svc.finish(s, { winners, summary: why });
  const prizes = winners.map((w) => `${tag(w)}: ${svc.prize(w)}`).join('\n');
  return `🏆 *${s.type.toUpperCase()} terminada* — ${why}\n${winners.length ? `Ganador(es): ${tags(winners)}\n🎁 Premios:\n${prizes}` : 'Nadie ganó esta vez.'}`;
}

/** Cierra la ronda actual y arranca la siguiente o termina. Devuelve el texto a enviar. */
function advance(svc, s, hooks) {
  const res = hooks.resolve(svc, s); // { text, alive, winners?, ended? }
  const alive = s.data.alive;
  let tail;
  if (res.ended || res.winners || alive.length <= 1 || s.data.round >= hooks.maxRounds) {
    const winners = res.winners || alive;
    tail = conclude(svc, s, winners, alive.length <= 1 ? 'último en pie' : 'se completaron todas las rondas');
  } else {
    startRound(svc, s, hooks);
    tail = hooks.roundIntro(s, svc);
  }
  return { text: `${res.text}\n\n${tail}`, mentions: mentionsOf(s.players) };
}

function makeGame({ type, title, icon, min, max, maxRounds, description, hooks, extraSubs = [], answerUsage, answer }) {
  const mod = {
    type,
    async onTimer(svc, s) {
      if (s.status === 'lobby') {
        if (s.players.length >= min) return beginGame(svc, s);
        svc.cancel(s, 'sala vencida sin jugadores suficientes');
        return { text: `⌛ La sala de ${title} venció sin jugadores suficientes (mínimo ${min}).` };
      }
      return advance(svc, s, hooks);
    },
  };

  function beginGame(svc, s) {
    s.status = 'active';
    s.data.round = 0;
    s.data.alive = [...s.players];
    hooks.setup?.(svc, s);
    startRound(svc, s, hooks);
    return { text: `${icon} *${title.toUpperCase()}* — ¡empieza con ${s.players.length} jugadores!\n${tags(s.players)}\n\n${hooks.roundIntro(s, svc)}`, mentions: mentionsOf(s.players) };
  }

  const need = (ctx, status) => {
    const s = games(ctx).activeOf(ctx.chatJid, type);
    if (!s) throw new UserError('NO_GAME', `No hay una sala de ${title} aquí. Crea una con *${ctx.prefix}${type}*.`);
    if (status && s.status !== status) throw new UserError('BAD_STATE', status === 'lobby' ? 'La partida ya empezó.' : 'La partida todavía no empezó.');
    return s;
  };
  const sub = (name, aliases, desc, usage, handler) => ({ name, aliases, description: desc, usage, permissions: 'USER', handler });

  const subcommands = [
    sub('unirse', ['join'], `Te unes a la sala de ${title} (máx. ${max} jugadores).`, `${type} unirse`, async (ctx) => {
      const s = need(ctx, 'lobby');
      if (s.players.includes(ctx.user.jid)) throw new UserError('ALREADY', 'Ya estás en la sala.');
      if (s.players.length >= max) throw new UserError('FULL', `La sala está llena (${max}).`);
      s.players.push(ctx.user.jid);
      games(ctx).db.touch();
      return { text: `✅ ${tag(ctx.user.jid)} se unió a ${title} (${s.players.length}/${max}).`, mentions: [ctx.user.jid] };
    }),
    sub('salir', ['leave'], `Sales de la sala de ${title} antes de que empiece (si eres el anfitrión se cancela).`, `${type} salir`, async (ctx) => {
      const svc = games(ctx);
      const s = need(ctx, 'lobby');
      if (!s.players.includes(ctx.user.jid)) throw new UserError('NOT_PLAYER', 'No estás en la sala.');
      if (s.host === ctx.user.jid) {
        svc.cancel(s, 'el anfitrión canceló', ctx.user.jid);
        return `❌ El anfitrión salió: la sala de ${title} se canceló.`;
      }
      s.players = s.players.filter((p) => p !== ctx.user.jid);
      svc.db.touch();
      return `👋 Saliste de la sala (${s.players.length}/${max}).`;
    }),
    sub('iniciar', ['start'], `El anfitrión inicia ${title} (mínimo ${min} jugadores).`, `${type} iniciar`, async (ctx) => {
      const s = need(ctx, 'lobby');
      if (s.host !== ctx.user.jid) throw new UserError('NOT_HOST', 'Solo quien creó la sala puede iniciarla.');
      if (s.players.length < min) throw new UserError('FEW', `Se necesitan al menos ${min} jugadores (hay ${s.players.length}).`);
      return beginGame(games(ctx), s);
    }),
    sub('estado', ['status'], `Muestra el estado actual de ${title}.`, `${type} estado`, async (ctx) => {
      const s = need(ctx);
      if (s.status === 'lobby') return { text: `${icon} Sala de ${title} (${s.players.length}/${max}): ${tags(s.players)}\nIniciar: *${ctx.prefix}${type} iniciar*`, mentions: s.players };
      return { text: `${icon} ${title} · ronda ${s.data.round}/${maxRounds} · en pie: ${tags(s.data.alive)}\n${hooks.roundIntro(s, games(ctx))}`, mentions: s.data.alive };
    }),
    ...extraSubs.map((x) => ({ ...x, handler: (ctx) => x.run(ctx, need(ctx, 'active'), () => afterAction(ctx)) })),
  ];

  /** Si ya actuaron todos los vivos, la ronda se resuelve sin esperar al temporizador. */
  function afterAction(ctx) {
    const svc = games(ctx);
    const s = svc.activeOf(ctx.chatJid, type);
    if (s && s.status === 'active' && s.data.alive.every((p) => s.data.actions[p] !== undefined)) return advance(svc, s, hooks);
    return null;
  }

  const command = {
    name: type,
    aliases: [],
    description,
    usage: `${type} [${answerUsage}]`,
    example: type,
    category: 'juegos',
    permissions: 'USER',
    cooldown: 2,
    scope: 'group',
    requiresRegistration: true,
    subcommands,
    async handler(ctx) {
      const svc = games(ctx);
      const s = svc.activeOf(ctx.chatJid, type);
      if (!ctx.args.length) {
        if (s) return { text: `${icon} Ya hay una sala de ${title} (${s.status === 'lobby' ? 'esperando jugadores' : `ronda ${s.data.round}`}). Usa *${ctx.prefix}${type} unirse* o *${ctx.prefix}${type} estado*.`, mentions: [] };
        const created = svc.create({ type, chatJid: ctx.chatJid, host: ctx.user.jid, status: 'lobby', data: { round: 0, alive: [], actions: {} } });
        svc.setTimer(created, svc.config.games.lobbySec);
        return `${icon} *${title.toUpperCase()}* — sala abierta (${svc.config.games.lobbySec} s).\n${description}\nÚnete con *${ctx.prefix}${type} unirse* (${min}-${max} jugadores). El anfitrión inicia con *${ctx.prefix}${type} iniciar*.`;
      }
      if (!answer) throw new UserError('UNKNOWN_SUB', `Subcomando desconocido "${plain(ctx.args[0])}". Usa *${ctx.prefix}help ${type}*.`);
      const cur = need(ctx, 'active');
      if (!cur.data.alive.includes(ctx.user.jid)) throw new UserError('NOT_ALIVE', 'No estás en juego (no participas o ya fuiste eliminado).');
      const reply = answer(ctx, cur);
      const adv = afterAction(ctx);
      return adv ? { text: `${reply}\n\n${adv.text}`, mentions: adv.mentions } : reply;
    },
  };
  return { mod, command };
}

// ---------- batalla ----------

const BATTLE = {
  hp: 100,
  hit: 25,
  blocked: 10,
  fatigue: 15,
};

const battle = makeGame({
  type: 'batalla',
  title: 'Batalla',
  icon: '⚔️',
  min: 2,
  max: 8,
  maxRounds: 8,
  description: 'Todos contra todos por rondas: elige atacar a alguien o defender. Gana el último en pie (o quien tenga más vida tras 8 rondas).',
  answerUsage: 'subcomando',
  hooks: {
    maxRounds: 8,
    setup(svc, s) {
      s.data.hp = Object.fromEntries(s.players.map((p) => [p, BATTLE.hp]));
    },
    roundIntro(s, svc) {
      const hp = s.data.alive.map((p) => `${tag(p)} ❤️${s.data.hp[p]}`).join('  ');
      return `🔔 *Ronda ${s.data.round}/8*\n${hp}\nElige: *.batalla atacar @alguien* o *.batalla defender* (tienes ${svc.config.games.roundSec} s; quien no actúa pierde ${BATTLE.fatigue} de vida por fatiga).`;
    },
    resolve(svc, s) {
      const d = s.data;
      const dmg = {};
      const lines = [];
      for (const p of d.alive) {
        const a = d.actions[p];
        if (!a) {
          dmg[p] = (dmg[p] || 0) + BATTLE.fatigue;
          lines.push(`😴 ${tag(p)} no actuó: -${BATTLE.fatigue} por fatiga.`);
        } else if (a.type === 'attack') {
          const t = d.actions[a.target];
          const blocked = t && t.type === 'defend';
          const amount = blocked ? BATTLE.blocked : BATTLE.hit;
          dmg[a.target] = (dmg[a.target] || 0) + amount;
          lines.push(`💥 ${tag(p)} golpea a ${tag(a.target)}: -${amount}${blocked ? ' (bloqueado en parte)' : ''}.`);
        } else {
          lines.push(`🛡️ ${tag(p)} se defiende.`);
        }
      }
      for (const [p, v] of Object.entries(dmg)) d.hp[p] = Math.max(0, d.hp[p] - v);
      const fallen = d.alive.filter((p) => d.hp[p] <= 0);
      d.alive = d.alive.filter((p) => d.hp[p] > 0);
      if (fallen.length) lines.push(`☠️ Eliminados: ${tags(fallen)}`);
      let winners = null;
      if (d.alive.length === 0) {
        // Todos cayeron a la vez: ganan los que tenían más vida antes de la ronda no existe; se declara empate entre los caídos.
        winners = fallen;
        d.alive = fallen;
      } else if (d.round >= 8 && d.alive.length > 1) {
        const best = Math.max(...d.alive.map((p) => d.hp[p]));
        winners = d.alive.filter((p) => d.hp[p] === best);
      }
      return { text: lines.join('\n'), alive: d.alive, winners };
    },
  },
  extraSubs: [
    {
      name: 'atacar',
      aliases: ['attack'],
      description: 'En tu ronda, atacas a otro jugador en pie (mencionándolo): 25 de daño, 10 si se defiende.',
      usage: 'batalla atacar @usuario',
      permissions: 'USER',
      run(ctx, s, after) {
        if (!s.data.alive.includes(ctx.user.jid)) throw new UserError('NOT_ALIVE', 'Ya no estás en juego.');
        if (s.data.actions[ctx.user.jid]) throw new UserError('ALREADY', 'Ya elegiste tu acción en esta ronda.');
        const t = targetUser(ctx, 'batalla atacar @usuario');
        if (t.jid === ctx.user.jid) throw new UserError('SELF', 'No puedes atacarte a ti mismo.');
        if (!s.data.alive.includes(t.jid)) throw new UserError('BAD_TARGET', 'Ese jugador no está en pie.');
        s.data.actions[ctx.user.jid] = { type: 'attack', target: t.jid };
        games(ctx).db.touch();
        const adv = after();
        return adv || `⚔️ Atacarás a ${plain(t.name)} esta ronda.`;
      },
    },
    {
      name: 'defender',
      aliases: ['defend'],
      description: 'En tu ronda, te defiendes: los golpes que recibas hacen solo 10 de daño.',
      usage: 'batalla defender',
      permissions: 'USER',
      run(ctx, s, after) {
        if (!s.data.alive.includes(ctx.user.jid)) throw new UserError('NOT_ALIVE', 'Ya no estás en juego.');
        if (s.data.actions[ctx.user.jid]) throw new UserError('ALREADY', 'Ya elegiste tu acción en esta ronda.');
        s.data.actions[ctx.user.jid] = { type: 'defend' };
        games(ctx).db.touch();
        const adv = after();
        return adv || '🛡️ Te defenderás esta ronda.';
      },
    },
  ],
});

// ---------- supervivencia ----------

const DOORS = ['A', 'B', 'C'];

const survival = makeGame({
  type: 'supervivencia',
  title: 'Supervivencia',
  icon: '🏝️',
  min: 2,
  max: 20,
  maxRounds: 6,
  description: 'Cada ronda hay 3 puertas y solo una es segura: elige con A, B o C. Quien elige mal queda eliminado. Si todos fallan, nadie cae.',
  answerUsage: 'A|B|C',
  hooks: {
    maxRounds: 6,
    prepare(svc, s) {
      s.data.safe = svc.pick(DOORS);
    },
    roundIntro(s) {
      return `🚪 *Ronda ${s.data.round}/6* — en pie: ${tags(s.data.alive)}\nElige una puerta con *.supervivencia A|B|C* (una es segura; quien no elige cae).`;
    },
    resolve(svc, s) {
      const d = s.data;
      const survivors = d.alive.filter((p) => d.actions[p] === d.safe);
      let text = `🔑 La puerta segura era la *${d.safe}*.`;
      if (survivors.length === 0) {
        text += '\n🤝 Nadie acertó: nadie queda eliminado esta ronda.';
      } else {
        const fallen = d.alive.filter((p) => !survivors.includes(p));
        if (fallen.length) text += `\n☠️ Eliminados: ${tags(fallen)}`;
        d.alive = survivors;
      }
      return { text, alive: d.alive };
    },
  },
  answer(ctx, s) {
    const door = ctx.args[0].toUpperCase();
    if (!DOORS.includes(door)) throw new UserError('USAGE', `Elige una puerta: *${ctx.prefix}supervivencia A|B|C*.`);
    if (s.data.actions[ctx.user.jid]) throw new UserError('ALREADY', 'Ya elegiste puerta en esta ronda.');
    s.data.actions[ctx.user.jid] = door;
    games(ctx).db.touch();
    return `🚪 Elegiste la puerta *${door}*.`;
  },
});

// ---------- eliminación ----------

const elimination = makeGame({
  type: 'eliminacion',
  title: 'Eliminación',
  icon: '🧮',
  min: 2,
  max: 20,
  maxRounds: 6,
  description: 'Cada ronda hay una cuenta rápida: quien responde mal o no responde queda eliminado. Si todos fallan, nadie cae.',
  answerUsage: 'RESPUESTA',
  hooks: {
    maxRounds: 6,
    prepare(svc, s) {
      const a = 2 + svc.randInt(18);
      const b = 2 + svc.randInt(18);
      const op = svc.pick(['+', '-', '×']);
      s.data.question = `${a} ${op} ${b}`;
      s.data.answer = op === '+' ? a + b : op === '-' ? a - b : a * b;
    },
    roundIntro(s) {
      return `🧮 *Ronda ${s.data.round}/6* — en pie: ${tags(s.data.alive)}\n¿Cuánto es *${s.data.question}*? Responde con *.eliminacion NUMERO*.`;
    },
    resolve(svc, s) {
      const d = s.data;
      const ok = d.alive.filter((p) => d.actions[p] === d.answer);
      let text = `✔️ ${d.question} = *${d.answer}*.`;
      if (ok.length === 0) {
        text += '\n🤝 Nadie acertó: nadie queda eliminado esta ronda.';
      } else {
        const fallen = d.alive.filter((p) => !ok.includes(p));
        if (fallen.length) text += `\n☠️ Eliminados: ${tags(fallen)}`;
        d.alive = ok;
      }
      return { text, alive: d.alive };
    },
  },
  answer(ctx, s) {
    if (!/^-?\d{1,6}$/.test(ctx.args[0])) throw new UserError('USAGE', `Responde con un número entero: *${ctx.prefix}eliminacion NUMERO*.`);
    if (s.data.actions[ctx.user.jid] !== undefined) throw new UserError('ALREADY', 'Ya respondiste en esta ronda.');
    s.data.actions[ctx.user.jid] = Number(ctx.args[0]);
    games(ctx).db.touch();
    return '📨 Respuesta recibida.';
  },
});

module.exports = { modules: [battle.mod, survival.mod, elimination.mod], commands: [battle.command, survival.command, elimination.command] };
