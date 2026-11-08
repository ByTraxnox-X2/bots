'use strict';

const { norm, games, needSession, addPlayer, tag, UserError } = require('./util');

const WORDS = ['escuadra', 'victoria', 'jugador', 'partida', 'torneo', 'equipo', 'estrategia', 'mochila', 'granada', 'chaleco', 'refugio', 'aterrizaje', 'paracaidas', 'mensaje', 'capitan', 'campeon', 'ranking', 'puntaje', 'desafio', 'aliado'];

function win(svc, ctx, s, extra) {
  svc.finish(s, { winners: [ctx.user.jid], summary: 'acierto' });
  const prize = svc.prize(ctx.user.jid);
  return { text: `${extra}\n🎁 ${prize}`, mentions: [ctx.user.jid] };
}

const base = (name, description, usage, example, extra = {}) => ({ name, description, usage, example, category: 'juegos', permissions: 'USER', cooldown: 2, scope: 'group', requiresRegistration: true, ...extra });

// ---------- adivina ----------

const adivina = {
  type: 'adivina',
  async onTimer(svc, s) {
    svc.finish(s, { summary: 'sin ganador' });
    return { text: `⏰ Se acabó el tiempo. El número era *${s.data.target}*. Nadie lo adivinó.` };
  },
};

const adivinaCmd = base('adivina', 'Adivina el número secreto del 1 al 100: el bot dice "mayor" o "menor". Gana quien lo acierte (máx. 5 intentos por persona).', 'adivina [NUMERO]', 'adivina 50', {
  aliases: ['numero'],
  async handler(ctx) {
    const svc = games(ctx);
    const cur = svc.activeOf(ctx.chatJid, 'adivina');
    if (!ctx.args.length) {
      if (cur) return `🔢 Ya hay un juego de adivinar el número (1-100). Usa *${ctx.prefix}adivina NUMERO*.`;
      const s = svc.create({ type: 'adivina', chatJid: ctx.chatJid, host: ctx.user.jid, data: { target: 1 + svc.randInt(100), tries: {} } });
      svc.setTimer(s, ctx.config.games.questionSec * 4);
      return `🔢 *ADIVINA EL NÚMERO*\nPensé un número del 1 al 100. Usa *${ctx.prefix}adivina NUMERO* (5 intentos por persona, ${ctx.config.games.questionSec * 4} s).`;
    }
    const s = needSession(ctx, 'adivina', 'un juego de adivinar');
    if (!/^\d{1,3}$/.test(ctx.args[0]) || Number(ctx.args[0]) < 1 || Number(ctx.args[0]) > 100) throw new UserError('USAGE', 'Escribe un número entero entre 1 y 100.');
    const n = Number(ctx.args[0]);
    const used = s.data.tries[ctx.user.jid] || 0;
    if (used >= 5) throw new UserError('NO_TRIES', 'Ya usaste tus 5 intentos.');
    s.data.tries[ctx.user.jid] = used + 1;
    addPlayer(s, ctx.user.jid);
    if (n === s.data.target) return win(svc, ctx, s, `🎯 ¡Acertaste, ${tag(ctx.user.jid)}! Era *${n}* (intento ${used + 1}).`);
    svc.db.touch();
    return `${n < s.data.target ? '⬆️ Es *mayor*' : '⬇️ Es *menor*'} que ${n}. Te quedan ${4 - used} intentos.`;
  },
});

// ---------- anagrama ----------

function scramble(svc, word) {
  for (let i = 0; i < 20; i++) {
    const w = svc.shuffle(word.split('')).join('');
    if (w !== word) return w;
  }
  return word.split('').reverse().join('');
}

const anagrama = {
  type: 'anagrama',
  async onTimer(svc, s) {
    svc.finish(s, { summary: 'sin ganador' });
    return { text: `⏰ Se acabó el tiempo. La palabra era *${s.data.word}*.` };
  },
};

const anagramaCmd = base('anagrama', 'Ordena las letras para formar la palabra. Gana la primera persona que la escriba bien.', 'anagrama [PALABRA]', 'anagrama', {
  async handler(ctx) {
    const svc = games(ctx);
    if (!ctx.args.length) {
      const cur = svc.activeOf(ctx.chatJid, 'anagrama');
      if (cur) return `🔤 Anagrama en curso: *${cur.data.scrambled.toUpperCase()}*. Responde con *${ctx.prefix}anagrama PALABRA*.`;
      const word = svc.pick(WORDS);
      const s = svc.create({ type: 'anagrama', chatJid: ctx.chatJid, host: ctx.user.jid, data: { word, scrambled: scramble(svc, word) } });
      svc.setTimer(s, ctx.config.games.questionSec * 2);
      return `🔤 *ANAGRAMA*\nOrdena estas letras: *${s.data.scrambled.toUpperCase()}* (${word.length} letras)\nResponde con *${ctx.prefix}anagrama PALABRA* (${ctx.config.games.questionSec * 2} s).`;
    }
    const s = needSession(ctx, 'anagrama', 'un anagrama');
    addPlayer(s, ctx.user.jid);
    if (norm(ctx.args.join(' ')) !== norm(s.data.word)) {
      svc.db.touch();
      return '❌ No es esa palabra. Sigue intentando.';
    }
    return win(svc, ctx, s, `✅ ¡Correcto, ${tag(ctx.user.jid)}! La palabra era *${s.data.word}*.`);
  },
});

// ---------- memoria (inversa) ----------

const memoria = {
  type: 'memoria',
  async onTimer(svc, s) {
    svc.finish(s, { summary: 'sin ganador' });
    return { text: `⏰ Se acabó el tiempo. La secuencia al revés era *${[...s.data.seq].reverse().join('')}*.` };
  },
};

const memoriaCmd = base('memoria', 'Memoria inversa: el bot muestra una secuencia de dígitos y gana quien la escriba AL REVÉS (2 intentos por persona).', 'memoria [SECUENCIA_AL_REVES]', 'memoria', {
  async handler(ctx) {
    const svc = games(ctx);
    if (!ctx.args.length) {
      const cur = svc.activeOf(ctx.chatJid, 'memoria');
      if (cur) return `🧩 Memoria en curso: *${cur.data.seq.split('').join(' ')}*. Escríbela al revés: *${ctx.prefix}memoria ...*`;
      const len = 5 + svc.randInt(3);
      let seq = '';
      for (let i = 0; i < len; i++) seq += String(svc.randInt(10));
      const s = svc.create({ type: 'memoria', chatJid: ctx.chatJid, host: ctx.user.jid, data: { seq, tries: {} } });
      svc.setTimer(s, ctx.config.games.questionSec);
      return `🧩 *MEMORIA INVERSA*\nSecuencia: *${seq.split('').join(' ')}*\nEscríbela AL REVÉS con *${ctx.prefix}memoria DIGITOS* (${ctx.config.games.questionSec} s, 2 intentos).`;
    }
    const s = needSession(ctx, 'memoria', 'un juego de memoria');
    const answer = ctx.args.join('').replace(/\s/g, '');
    if (!/^\d+$/.test(answer)) throw new UserError('USAGE', 'Escribe solo los dígitos, por ejemplo: 52419.');
    const used = s.data.tries[ctx.user.jid] || 0;
    if (used >= 2) throw new UserError('NO_TRIES', 'Ya usaste tus 2 intentos.');
    s.data.tries[ctx.user.jid] = used + 1;
    addPlayer(s, ctx.user.jid);
    if (answer !== [...s.data.seq].reverse().join('')) {
      svc.db.touch();
      return `❌ Incorrecto. Te quedan ${1 - used} intentos.`;
    }
    return win(svc, ctx, s, `🧠 ¡Memoria perfecta, ${tag(ctx.user.jid)}! La secuencia al revés era *${answer}*.`);
  },
});

// ---------- reacción ----------

const reaccion = {
  type: 'reaccion',
  async onTimer(svc, s) {
    if (s.data.phase === 'wait') {
      s.data.phase = 'go';
      s.data.goAt = svc.now();
      svc.setTimer(s, 10);
      return { text: '🟢 *¡YA!* Escribe *.ya* lo más rápido que puedas.' };
    }
    svc.finish(s, { summary: 'sin ganador' });
    return { text: '⏰ Nadie reaccionó a tiempo.' };
  },
};

const reaccionCmd = base('reaccion', 'Prueba de reflejos: espera la señal "YA" y escribe .ya primero. Escribir antes de la señal te descalifica.', 'reaccion', 'reaccion', {
  aliases: ['reflejos'],
  async handler(ctx) {
    const svc = games(ctx);
    const cur = svc.activeOf(ctx.chatJid, 'reaccion');
    if (cur) return '⚡ Ya hay una prueba de reacción en curso. Espera la señal y escribe *.ya*.';
    const s = svc.create({ type: 'reaccion', chatJid: ctx.chatJid, host: ctx.user.jid, data: { phase: 'wait', goAt: null, early: [] } });
    svc.setTimer(s, 3 + svc.randInt(6));
    return '⚡ *REACCIÓN*\nPrepárense… cuando yo diga *¡YA!* escriban *.ya*. ¡Si lo escriben antes, quedan descalificados!';
  },
});

const yaCmd = base('ya', 'Responde a la señal de la prueba de reacción (reaccion). El primero después de la señal gana.', 'ya (tras la señal)', 'ya !', {
  async handler(ctx) {
    const svc = games(ctx);
    const s = needSession(ctx, 'reaccion', 'una prueba de reacción');
    addPlayer(s, ctx.user.jid);
    if (s.data.early.includes(ctx.user.jid)) throw new UserError('DQ', '🚫 Estás descalificado en esta ronda por salir antes de tiempo.');
    if (s.data.phase === 'wait') {
      s.data.early.push(ctx.user.jid);
      svc.db.touch();
      return `🚫 ¡Salida en falso, ${tag(ctx.user.jid)}! Quedas descalificado en esta ronda.`;
    }
    const ms = svc.now() - s.data.goAt;
    return win(svc, ctx, s, `⚡ ¡${tag(ctx.user.jid)} reaccionó primero! (${ms} ms desde que el bot lo registró).`);
  },
});

module.exports = {
  modules: [adivina, anagrama, memoria, reaccion],
  commands: [adivinaCmd, anagramaCmd, memoriaCmd, reaccionCmd, yaCmd],
  WORDS,
};
