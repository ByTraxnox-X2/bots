'use strict';

const { TRIVIA, QUIZ_FF } = require('./banks');
const { norm, games, needSession, addPlayer, tag, UserError, plain } = require('./util');
const { hasRole } = require('../middleware/permissions');

const LETTERS = ['A', 'B', 'C', 'D'];

/** Banco efectivo: base + preguntas añadidas por un SUPERADMIN (guardadas en la base de datos). */
function bank(svc, kind) {
  const base = kind === 'quizff' ? QUIZ_FF : TRIVIA;
  const custom = kind === 'quizff' ? svc.db.ensure('settings', 'quizff', () => ({ questions: [] })).questions : [];
  return [...base, ...custom.map((q) => [q.q, q.correct, q.wrong])];
}

function questionText(s) {
  const d = s.data;
  return [`${d.kind === 'quizff' ? '🎮 *QUIZ FREE FIRE*' : '🧠 *TRIVIA*'}`, '', d.question, '', ...d.options.map((o) => `${o.letter}) ${o.text}`), '', `⏳ Responde con *.${d.kind} A|B|C|D*. Solo tienes un intento por persona.`].join('\n');
}

/** Módulo de sesión compartido por trivia y quizff. */
function module_(kind) {
  return {
    type: kind,
    async onTimer(svc, s) {
      svc.finish(s, { summary: 'sin ganador' });
      return { text: `⏰ Se acabó el tiempo. La respuesta era *${s.data.correctLetter}) ${s.data.correctText}*. Nadie acertó.` };
    },
  };
}

function command(kind, { title, empty }) {
  const type = kind;
  return {
    name: kind,
    aliases: kind === 'trivia' ? ['pregunta'] : ['ffquiz'],
    description: kind === 'trivia' ? 'Pregunta de cultura general con 4 opciones: gana la primera persona que acierte (un intento por persona).' : 'Pregunta de Free Fire con 4 opciones: gana la primera persona que acierte. El banco es corto y solo tiene hechos comprobables.',
    usage: `${kind} [A|B|C|D]`,
    example: `${kind}`,
    category: 'juegos',
    permissions: 'USER',
    cooldown: 2,
    scope: 'group',
    requiresRegistration: true,
    subcommands: kind === 'quizff' ? [
      {
        name: 'agregar',
        aliases: ['add'],
        description: 'Un SUPERADMIN añade una pregunta al banco: pregunta | correcta | incorrecta1 | incorrecta2 | incorrecta3.',
        usage: 'quizff agregar PREGUNTA | CORRECTA | MALA1 | MALA2 | MALA3',
        permissions: 'SUPERADMIN',
        async handler(ctx) {
          const parts = ctx.argText.split('|').map((p) => p.trim()).filter(Boolean);
          if (parts.length !== 5) throw new UserError('USAGE', `Uso: *${ctx.prefix}quizff agregar PREGUNTA | CORRECTA | MALA1 | MALA2 | MALA3* (5 partes separadas por |).`);
          if (parts.some((p) => p.length > 120)) throw new UserError('TOO_LONG', 'Cada parte puede tener hasta 120 caracteres.');
          if (new Set(parts.slice(1).map(norm)).size !== 4) throw new UserError('DUP', 'Las 4 opciones deben ser distintas.');
          const store = games(ctx).db.ensure('settings', 'quizff', () => ({ questions: [] }));
          if (store.questions.length >= 200) throw new UserError('FULL', 'El banco personalizado ya tiene 200 preguntas.');
          store.questions.push({ q: parts[0], correct: parts[1], wrong: parts.slice(2), by: ctx.user.jid, at: new Date().toISOString() });
          games(ctx).db.touch();
          return `✅ Pregunta añadida al banco de Free Fire (${store.questions.length} personalizadas).`;
        },
      },
    ] : undefined,
    async handler(ctx) {
      const svc = games(ctx);
      const s0 = svc.activeInChat(ctx.chatJid);
      if (ctx.args.length === 0) {
        if (s0 && s0.type === type) return questionText(s0);
        const pool = bank(svc, kind);
        if (!pool.length) throw new UserError('EMPTY', empty);
        const recent = svc.db.ensure('settings', `recent_${kind}`, () => ({ ids: [] }));
        let idx;
        const free = pool.map((_, i) => i).filter((i) => !recent.ids.includes(i));
        idx = svc.pick(free.length ? free : pool.map((_, i) => i));
        recent.ids.push(idx);
        if (recent.ids.length > Math.max(1, Math.floor(pool.length / 2))) recent.ids.shift();
        const [q, correct, wrong] = pool[idx];
        const options = svc.shuffle([correct, ...wrong]).map((text, i) => ({ letter: LETTERS[i], text }));
        const s = svc.create({ type, chatJid: ctx.chatJid, host: ctx.user.jid, data: { kind, question: q, options, correctLetter: options.find((o) => o.text === correct).letter, correctText: correct, tried: [] } });
        svc.setTimer(s, ctx.config.games.questionSec);
        return questionText(s);
      }
      const s = needSession(ctx, type, title);
      const letter = ctx.args[0].toUpperCase();
      if (!LETTERS.includes(letter)) throw new UserError('USAGE', `Responde con una letra: *${ctx.prefix}${kind} A|B|C|D*.`);
      if (s.data.tried.includes(ctx.user.jid)) throw new UserError('ALREADY', 'Ya usaste tu intento en esta pregunta.');
      s.data.tried.push(ctx.user.jid);
      addPlayer(s, ctx.user.jid);
      if (letter !== s.data.correctLetter) {
        svc.db.touch();
        return '❌ Respuesta incorrecta. Ya no puedes responder esta pregunta.';
      }
      svc.finish(s, { winners: [ctx.user.jid], summary: 'acierto' });
      const prize = svc.prize(ctx.user.jid);
      return { text: `✅ ¡Correcto, ${tag(ctx.user.jid)}! Era *${s.data.correctLetter}) ${s.data.correctText}*.\n🎁 ${prize}`, mentions: [ctx.user.jid] };
    },
  };
}

module.exports = {
  modules: [module_('trivia'), module_('quizff')],
  commands: [command('trivia', { title: 'una trivia', empty: 'El banco de preguntas está vacío.' }), command('quizff', { title: 'un quiz de Free Fire', empty: 'No hay preguntas de Free Fire.' })],
  hasRole,
  plain,
};
