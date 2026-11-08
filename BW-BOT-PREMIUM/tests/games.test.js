'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { harness } = require('./harness');
const { P, GROUP, boot, say, sentTo } = require('./support');

const ENV = { REGISTER_BONUS_COINS: '1000', ACTIVITY_XP: '0' };
const coins = (h, j) => h.users.find([j]).coins;
/** RNG controlado: devuelve los valores en orden (módulo n) y luego 0. */
const rng = (h, ...vals) => { h.games.randInt = (n) => (vals.length ? vals.shift() : 0) % n; };
const session = (h) => h.games.activeInChat(GROUP);
async function tick(h, seconds) { h.clock.t += seconds * 1000; await h.scheduler.runDue(); }

// ---------- contra el bot ----------

test('.ppt: resultados, apuestas (ganar/perder/empatar), validaciones y estadísticas', async () => {
  const h = await boot({ env: ENV });
  try {
    assert.match(await say(h, '.ppt', P[1]), /Uso:/);
    assert.match(await say(h, '.ppt roca', P[1]), /Uso:/);
    assert.match(await say(h, '.ppt piedra abc', P[1]), /número entero/);
    assert.match(await say(h, '.ppt piedra 0', P[1]), /entre 1 y 1000/);
    assert.match(await say(h, '.ppt piedra 5000', P[1]), /entre 1 y 1000/);
    assert.match(await say(h, '.ppt piedra 99999', P[2]), /entre 1 y 1000/);
    rng(h, 2); // el bot saca tijera
    assert.match(await say(h, '.ppt piedra 100', P[1]), /¡Ganaste!.*Ganaste 100/s);
    assert.equal(coins(h, P[1]), 1100);
    rng(h, 1); // papel vence a piedra
    assert.match(await say(h, '.ppt piedra 100', P[1]), /Perdiste.*Perdiste 100/s);
    assert.equal(coins(h, P[1]), 1000);
    rng(h, 0);
    assert.match(await say(h, '.ppt piedra 100', P[1]), /Empate.*devuelve/s);
    assert.equal(coins(h, P[1]), 1000);
    rng(h, 0);
    assert.match(await say(h, '.ppt piedra', P[1]), /Empate/);
    h.users.find([P[3]]).coins = 5;
    assert.match(await say(h, '.ppt papel 50', P[3]), /No tienes suficientes monedas/);
    assert.equal(coins(h, P[3]), 5, 'sin apuesta cobrada si falla');
    const st = h.games.playerStats(P[1]);
    assert.deepEqual([st.total.played, st.total.wins], [4, 1]);
    assert.match(await say(h, '.ppt piedra', '999@s.whatsapp.net'), /registrarte/);
  } finally { h.close(); }
});

test('.dados y .coinflip: apuestas y resultados', async () => {
  const h = await boot({ env: ENV });
  try {
    rng(h, 5, 5, 0, 0); // yo 6+6=12, bot 1+1=2
    assert.match(await say(h, '.dados 50', P[1]), /= \*12\*[\s\S]*= \*2\*[\s\S]*Ganaste 50/);
    assert.equal(coins(h, P[1]), 1050);
    rng(h, 0, 0, 5, 5);
    assert.match(await say(h, '.dados 50', P[1]), /Perdiste 50/);
    rng(h, 2, 2, 2, 2);
    assert.match(await say(h, '.dados', P[1]), /Empate/);
    rng(h, 0); // cara
    assert.match(await say(h, '.coinflip cara 100', P[1]), /salió \*cara\*[\s\S]*Acertaste[\s\S]*Ganaste 100/);
    assert.equal(coins(h, P[1]), 1100);
    rng(h, 1); // cruz
    assert.match(await say(h, '.coinflip cara 100', P[1]), /Fallaste[\s\S]*Perdiste 100/);
    assert.match(await say(h, '.coinflip lado', P[1]), /Uso:/);
    assert.equal(coins(h, P[1]), 1000);
  } finally { h.close(); }
});

// ---------- trivia / quiz ----------

test('.trivia: una pregunta por chat, un intento por persona, premio al acertar y vencimiento', async () => {
  const h = await boot({ env: ENV });
  try {
    assert.match(await say(h, '.trivia A', P[1]), /No hay una trivia en curso/);
    const q = await say(h, '.trivia', P[1]);
    assert.match(q, /TRIVIA[\s\S]*A\)[\s\S]*B\)[\s\S]*C\)[\s\S]*D\)/);
    const s = session(h);
    assert.equal(s.type, 'trivia');
    assert.match(await say(h, '.trivia', P[2]), /TRIVIA/, 'repetir muestra la pregunta actual');
    assert.match(await say(h, '.quizff', P[2]), /Ya hay un juego en curso/);
    assert.match(await say(h, '.trivia Z', P[2]), /Responde con una letra/);
    const wrong = ['A', 'B', 'C', 'D'].find((l) => l !== s.data.correctLetter);
    assert.match(await say(h, `.trivia ${wrong}`, P[2]), /incorrecta/);
    assert.match(await say(h, `.trivia ${s.data.correctLetter}`, P[2]), /Ya usaste tu intento/);
    const xpBefore = h.users.find([P[3]]).xp;
    const ok = await say(h, `.trivia ${s.data.correctLetter.toLowerCase()}`, P[3]);
    assert.match(ok, /Correcto[\s\S]*\+50 🪙 \+10 XP/);
    assert.ok(coins(h, P[3]) >= 1050);
    assert.ok(h.users.find([P[3]]).xp >= xpBefore + 10);
    assert.equal(s.status, 'finished');
    assert.equal(h.scheduler.pending().filter((j) => j.type === 'game.timer').length, 0, 'sin temporizadores pendientes');
    // Nueva pregunta que vence sola
    await say(h, '.trivia', P[1]);
    const s2 = session(h);
    await tick(h, 31);
    assert.equal(s2.status, 'finished');
    assert.match(h.sent[h.sent.length - 1].text, /Se acabó el tiempo.*Nadie acertó/s);
    assert.equal(h.sent[h.sent.length - 1].to, GROUP);
  } finally { h.close(); }
});

test('.quizff: banco de Free Fire, agregar solo SUPERADMIN y validaciones', async () => {
  const h = await boot({ env: ENV });
  try {
    assert.match(await say(h, '.quizff', P[2]), /QUIZ FREE FIRE/);
    await tick(h, 31);
    assert.match(await say(h, '.quizff agregar a | b | c | d | e', P[2]), /No tienes permiso.*SUPERADMIN/);
    h.permissions.setRole(P[2], 'SUPERADMIN');
    assert.match(await say(h, '.quizff agregar solo | dos', P[2]), /5 partes/);
    assert.match(await say(h, '.quizff agregar P | a | a | b | c', P[2]), /distintas/);
    assert.match(await say(h, '.quizff agregar ¿Pregunta nueva? | Sí | No | Tal vez | Nunca', P[2]), /1 personalizadas/);
    assert.equal(h.db.get('settings', 'quizff').questions.length, 1);
    // Con solo preguntas personalizadas en juego, también salen
    const seen = new Set();
    for (let i = 0; i < 80; i++) {
      await say(h, '.quizff', P[2]);
      seen.add(session(h).data.question);
      h.games.cancel(session(h), 'test');
    }
    assert.ok(seen.has('¿Pregunta nueva?'), 'incluye la personalizada tras agotar el resto');
  } finally { h.close(); }
});

// ---------- adivina / anagrama / memoria / reacción ----------

test('.adivina: pistas, intentos máximos, acierto y vencimiento', async () => {
  const h = await boot({ env: ENV });
  try {
    rng(h, 41); // 42
    assert.match(await say(h, '.adivina', P[1]), /ADIVINA EL NÚMERO/);
    assert.match(await say(h, '.adivina 200', P[1]), /entre 1 y 100/);
    assert.match(await say(h, '.adivina 10', P[1]), /mayor/);
    assert.match(await say(h, '.adivina 90', P[1]), /menor/);
    for (const n of [11, 12, 13]) await say(h, `.adivina ${n}`, P[1]);
    assert.match(await say(h, '.adivina 14', P[1]), /5 intentos/);
    assert.match(await say(h, '.adivina 42', P[2]), /Acertaste.*intento 1[\s\S]*\+50/);
    assert.equal(session(h), null);
    rng(h, 6);
    await say(h, '.adivina', P[1]);
    await tick(h, 121);
    assert.match(h.sent[h.sent.length - 1].text, /El número era \*7\*/);
  } finally { h.close(); }
});

test('.anagrama y .memoria: respuestas correctas, incorrectas, intentos y vencimiento', async () => {
  const h = await boot({ env: ENV });
  try {
    rng(h, 0);
    const q = await say(h, '.anagrama', P[1]);
    const word = session(h).data.word;
    const scr = session(h).data.scrambled;
    assert.notEqual(scr, word);
    assert.match(q, new RegExp(scr.toUpperCase()));
    assert.match(await say(h, '.anagrama nada', P[2]), /No es esa palabra/);
    assert.match(await say(h, `.anagrama ${word.toUpperCase()}`, P[2]), /Correcto[\s\S]*\+50/);
    // Memoria
    rng(h, 0, 1, 2, 3, 4, 5, 6, 7);
    const m = await say(h, '.memoria', P[1]);
    const seq = session(h).data.seq;
    assert.match(m, /MEMORIA INVERSA/);
    assert.ok(seq.length >= 5 && seq.length <= 7);
    assert.match(await say(h, '.memoria abc', P[2]), /solo los dígitos/);
    assert.match(await say(h, `.memoria ${seq}`, P[2]), /Incorrecto.*1 intentos/);
    assert.match(await say(h, '.memoria 0', P[2]), /Incorrecto/);
    assert.match(await say(h, '.memoria 0', P[2]), /2 intentos/);
    assert.match(await say(h, `.memoria ${[...seq].reverse().join(' ')}`, P[3]), /Memoria perfecta/);
    // Vencimiento anagrama
    await say(h, '.anagrama', P[1]);
    await tick(h, 61);
    assert.match(h.sent[h.sent.length - 1].text, /La palabra era/);
  } finally { h.close(); }
});

test('.reaccion y .ya: salida en falso, ganador por reflejos y sin ganador', async () => {
  const h = await boot({ env: ENV });
  try {
    assert.match(await say(h, '.ya', P[1]), /No hay una prueba de reacción/);
    rng(h, 2); // espera 5 s
    assert.match(await say(h, '.reaccion', P[1]), /REACCIÓN/);
    assert.match(await say(h, '.reaccion', P[2]), /Ya hay una prueba/);
    assert.match(await say(h, '.ya', P[2]), /Salida en falso/);
    assert.match(await say(h, '.ya', P[2]), /descalificado/);
    await tick(h, 6);
    assert.match(h.sent[h.sent.length - 1].text, /¡YA!/);
    assert.match(await say(h, '.ya', P[2]), /descalificado/);
    h.clock.t += 237;
    assert.match(await say(h, '.ya', P[3]), /reaccionó primero!.*237 ms[\s\S]*\+50/);
    assert.equal(session(h), null);
    // Nadie reacciona
    await say(h, '.reaccion', P[1]);
    await tick(h, 10);
    await tick(h, 11);
    assert.match(h.sent[h.sent.length - 1].text, /Nadie reaccionó/);
  } finally { h.close(); }
});

test('premios: tope diario de monedas (el XP sí se entrega) y reinicio al día siguiente', async () => {
  const h = await boot({ env: { ...ENV, GAME_DAILY_COIN_CAP: '80' } });
  try {
    const win = async () => {
      await say(h, '.trivia', P[1]);
      const s = session(h);
      return say(h, `.trivia ${s.data.correctLetter}`, P[2]);
    };
    assert.match(await win(), /\+50 🪙 \+10 XP/);
    assert.match(await win(), /\+30 🪙 \+10 XP/);
    assert.match(await win(), /tope diario de monedas alcanzado\) \+10 XP/);
    h.clock.t += 24 * 3600000;
    assert.match(await win(), /\+50 🪙/);
  } finally { h.close(); }
});

// ---------- duelo ----------

test('.duelo: desafío, apuesta, turnos, defensa, curación, victoria con bote y validaciones', async () => {
  const h = await boot({ env: ENV });
  try {
    assert.match(await say(h, '.duelo', P[1]), /Menciona/);
    assert.match(await say(h, '.duelo @x', P[1], { mentions: [P[1]] }), /retarte a ti mismo/);
    assert.match(await say(h, '.duelo @x 5000', P[1], { mentions: [P[2]] }), /entre 1 y 1000/);
    assert.match(await say(h, '.duelo aceptar', P[2]), /ningún desafío/);
    const msgs = await (async () => { const n = h.sent.length; await say(h, '.duelo @x 100', P[1], { mentions: [P[2]] }); return h.sent.slice(n); })();
    assert.match(msgs[0].text, /DESAFÍO DE DUELO[\s\S]*100 🪙/);
    assert.deepEqual(msgs[0].mentions.sort(), [P[1], P[2]].sort());
    assert.equal(coins(h, P[1]), 900, 'apuesta retenida');
    assert.match(await say(h, '.duelo aceptar', P[3]), /no es para ti/);
    assert.match(await say(h, '.duelo atacar', P[1]), /No hay un duelo en curso/);
    assert.match(await say(h, '.duelo aceptar', P[2]), /Duelo aceptado/);
    assert.equal(coins(h, P[2]), 900);
    assert.match(await say(h, '.duelo atacar', P[2]), /No es tu turno/);
    assert.match(await say(h, '.duelo atacar', P[3]), /No participas/);
    rng(h, 0); // 15 de daño
    assert.match(await say(h, '.duelo atacar', P[1]), /-15[\s\S]*Turno de/);
    assert.equal(session(h).data.hp[P[2]], 85);
    assert.match(await say(h, '.duelo curar', P[2]), /se cura/);
    assert.match(await say(h, '.duelo defender', P[1]), /mitad/);
    rng(h, 10); // 25 → 12 por escudo
    assert.match(await say(h, '.duelo atacar', P[2]), /bloquea parte del golpe: -12/);
    // Llevarlo a 0
    const s = session(h);
    s.data.hp[P[2]] = 10;
    rng(h, 0);
    assert.match(await say(h, '.duelo atacar', P[1]), /gana el duelo[\s\S]*bote de 200/);
    assert.equal(coins(h, P[1]), 1100);
    assert.equal(coins(h, P[2]), 900);
    assert.equal(s.status, 'finished');
    assert.equal(h.games.playerStats(P[1]).byGame.duelo.wins, 1);
  } finally { h.close(); }
});

test('.duelo: máximo 3 curaciones, rendirse, tiempo de turno agotado, rechazo y desafío vencido (apuestas devueltas)', async () => {
  const h = await boot({ env: ENV });
  try {
    await say(h, '.duelo @x 50', P[1], { mentions: [P[2]] });
    assert.match(await say(h, '.duelo rechazar', P[2]), /cancelado.*devueltas/);
    assert.equal(coins(h, P[1]), 1000);
    await say(h, '.duelo @x 50', P[1], { mentions: [P[2]] });
    await tick(h, 61);
    assert.match(h.sent[h.sent.length - 1].text, /venció sin respuesta/);
    assert.equal(coins(h, P[1]), 1000);
    assert.equal(session(h), null);
    await say(h, '.duelo @x', P[1], { mentions: [P[2]] });
    await say(h, '.duelo aceptar', P[2]);
    {
      const s = session(h);
      s.data.hp[P[1]] = 50;
      for (let i = 0; i < 3; i++) {
        assert.match(await say(h, '.duelo curar', P[1]), /se cura/);
        await say(h, '.duelo defender', P[2]);
      }
      assert.match(await say(h, '.duelo curar', P[1]), /3 curaciones/);
      assert.match(await say(h, '.duelo estado', P[1]), /DUELO/);
      // Tiempo agotado: pierde quien tenía el turno (P1)
      await tick(h, 61);
      assert.match(h.sent[h.sent.length - 1].text, /gana el duelo[\s\S]*tiempo agotado/);
      assert.equal(s.result.winners[0], P[2]);
    }
    await say(h, '.duelo @x', P[1], { mentions: [P[2]] });
    await say(h, '.duelo aceptar', P[2]);
    assert.match(await say(h, '.duelo rendirse', P[1]), /se rindió/);
    assert.equal(session(h), null);
  } finally { h.close(); }
});

// ---------- batalla / supervivencia / eliminación ----------

test('.batalla: sala, unirse, iniciar, acciones, resolución anticipada, fatiga, ganador y premios', async () => {
  const h = await boot({ env: ENV });
  try {
    assert.match(await say(h, '.batalla unirse', P[2]), /No hay una sala/);
    assert.match(await say(h, '.batalla', P[1]), /sala abierta/);
    assert.match(await say(h, '.batalla', P[2]), /Ya hay una sala/);
    assert.match(await say(h, '.batalla iniciar', P[1]), /al menos 2/);
    assert.match(await say(h, '.batalla unirse', P[2]), /se unió.*2\/8/);
    assert.match(await say(h, '.batalla unirse', P[2]), /Ya estás en la sala/);
    assert.match(await say(h, '.batalla iniciar', P[2]), /Solo quien creó la sala/);
    assert.match(await say(h, '.batalla atacar @x', P[1], { mentions: [P[2]] }), /todavía no empezó/);
    assert.match(await say(h, '.batalla iniciar', P[1]), /empieza con 2 jugadores/);
    assert.match(await say(h, '.batalla unirse', P[3]), /ya empezó/);
    assert.match(await say(h, '.batalla atacar @x', P[3], { mentions: [P[1]] }), /en juego/);
    assert.match(await say(h, '.batalla atacar', P[1]), /Menciona/);
    assert.match(await say(h, '.batalla atacar @x', P[1], { mentions: [P[1]] }), /a ti mismo/);
    assert.match(await say(h, '.batalla atacar @x', P[1], { mentions: [P[2]] }), /Atacarás/);
    assert.match(await say(h, '.batalla defender', P[1]), /Ya elegiste/);
    // P2 se defiende → ronda resuelta de inmediato
    const out = await say(h, '.batalla defender', P[2]);
    assert.match(out, /golpea a .*: -10 \(bloqueado/);
    const s = session(h);
    assert.equal(s.data.hp[P[2]], 90);
    assert.equal(s.data.round, 2);
    // Ronda 2: nadie actúa → fatiga a ambos
    await tick(h, 31);
    assert.match(h.sent[h.sent.length - 1].text, /no actuó: -15/);
    assert.equal(s.data.hp[P[1]], 85);
    assert.equal(s.data.hp[P[2]], 75);
    // Llevar a P2 a 20 y atacar sin defensa: cae
    s.data.hp[P[2]] = 20;
    await say(h, '.batalla atacar @x', P[1], { mentions: [P[2]] });
    const end = await say(h, '.batalla defender', P[2]).catch(() => '');
    assert.ok(/Eliminados|terminada/.test(end) || session(h)?.data.alive.length >= 1);
    await tick(h, 31);
    assert.equal(session(h), null);
    assert.equal(s.result.winners[0], P[1]);
    assert.match(h.sent[h.sent.length - 1].text + end, /BATALLA terminada/);
    assert.equal(h.games.playerStats(P[1]).byGame.batalla.wins, 1);
  } finally { h.close(); }
});

test('.batalla: la sala vence (se cancela sin jugadores o inicia sola) y el anfitrión puede salir', async () => {
  const h = await boot({ env: ENV });
  try {
    await say(h, '.batalla', P[1]);
    await tick(h, 61);
    assert.match(h.sent[h.sent.length - 1].text, /venció sin jugadores suficientes/);
    assert.equal(session(h), null);
    await say(h, '.batalla', P[1]);
    await say(h, '.batalla unirse', P[2]);
    await tick(h, 61);
    assert.match(h.sent[h.sent.length - 1].text, /empieza con 2 jugadores/);
    assert.equal(session(h).status, 'active');
    h.games.cancel(session(h), 'test');
    await say(h, '.batalla', P[1]);
    assert.match(await say(h, '.batalla salir', P[3]), /No estás en la sala/);
    assert.match(await say(h, '.batalla salir', P[1]), /se canceló/);
    assert.equal(session(h), null);
    assert.match(await say(h, '.batalla extra', P[1]), /Subcomando desconocido|No hay una sala/);
  } finally { h.close(); }
});

test('.supervivencia: puertas seguras, eliminados, ronda sin aciertos y ganador único', async () => {
  const h = await boot({ env: ENV });
  try {
    await say(h, '.supervivencia', P[1]);
    for (const p of [P[2], P[3]]) await say(h, '.supervivencia unirse', p);
    rng(h, 1); // puerta segura B
    await say(h, '.supervivencia iniciar', P[1]);
    assert.match(await say(h, '.supervivencia X', P[1]), /Elige una puerta/);
    assert.match(await say(h, '.supervivencia B', P[1]), /Elegiste la puerta \*B\*/);
    assert.match(await say(h, '.supervivencia A', P[1]), /Ya elegiste/);
    await say(h, '.supervivencia A', P[2]);
    rng(h, 2);
    const s = session(h);
    const res = await say(h, '.supervivencia C', P[3]); // todos actuaron: se resuelve
    assert.match(res, /puerta segura era la \*B\*[\s\S]*Eliminados/);
    assert.deepEqual(s.data.alive, [P[1]]);
    assert.equal(s.status, 'finished', 'un solo superviviente termina el juego');
    assert.equal(s.result.winners[0], P[1]);
    // Ronda donde todos fallan: nadie cae
    await say(h, '.supervivencia', P[1]);
    await say(h, '.supervivencia unirse', P[2]);
    rng(h, 0); // segura A
    await say(h, '.supervivencia iniciar', P[1]);
    await say(h, '.supervivencia B', P[1]);
    assert.match(await say(h, '.supervivencia C', P[2]), /Nadie acertó: nadie queda eliminado/);
    assert.equal(session(h).data.alive.length, 2);
    assert.equal(session(h).data.round, 2);
  } finally { h.close(); }
});

test('.eliminacion: cuentas, eliminados por error u omisión y fin tras la última ronda', async () => {
  const h = await boot({ env: ENV });
  try {
    await say(h, '.eliminacion', P[1]);
    await say(h, '.eliminacion unirse', P[2]);
    rng(h, 3, 4, 0); // 5 + 6 = 11
    const start = await say(h, '.eliminacion iniciar', P[1]);
    assert.match(start, /5 \+ 6/);
    assert.equal(session(h).data.answer, 11);
    assert.match(await say(h, '.eliminacion abc', P[1]), /número entero/);
    assert.match(await say(h, '.eliminacion 11', P[1]), /Respuesta recibida/);
    assert.match(await say(h, '.eliminacion 12', P[1]), /Ya respondiste/);
    // P2 no responde: al vencer la ronda queda eliminado
    await tick(h, 31);
    assert.match(h.sent[h.sent.length - 1].text, /5 \+ 6 = \*11\*[\s\S]*Eliminados[\s\S]*ELIMINACION terminada/);
    assert.equal(session(h), null);
  } finally { h.close(); }
});

// ---------- sistema: persistencia, reinicio, idempotencia ----------

test('reinicio: la sesión persiste, el temporizador se repone dentro de la gracia y se cancela con devolución si venció mucho', async () => {
  const h = await boot({ env: ENV });
  await say(h, '.duelo @x 100', P[1], { mentions: [P[2]] });
  const id = session(h).id;
  h.db.close();
  // Vuelve dentro de la gracia (30 s después del plazo)
  const h2 = harness({ dir: h.dir, startAt: h.clock.t + 90000, env: ENV });
  try {
    assert.equal(h2.games.get(id).status, 'lobby');
    assert.deepEqual(h2.games.syncAll(), { cancelled: 0, rearmed: 0 }, 'el trabajo ya existía en el scheduler');
    await h2.scheduler.start();
    assert.equal(h2.games.get(id).status, 'cancelled');
    assert.equal(h2.users.find([P[1]]).coins, 1000, 'apuesta devuelta');
    assert.match(h2.sent[h2.sent.length - 1].text, /venció sin respuesta/);
  } finally { h2.close(); }
  // Vuelve mucho después: se cancela en silencio con devolución
  const h3 = await boot({ env: ENV });
  await say(h3, '.duelo @x 100', P[1], { mentions: [P[2]] });
  const id3 = session(h3).id;
  h3.db.close();
  const h4 = harness({ dir: h3.dir, startAt: h3.clock.t + 3600000, env: ENV });
  try {
    assert.deepEqual(h4.games.syncAll(), { cancelled: 1, rearmed: 0 });
    assert.equal(h4.games.get(id3).status, 'cancelled');
    assert.equal(h4.users.find([P[1]]).coins, 1000);
    assert.equal(h4.sent.length, 0);
  } finally { h4.close(); }
  // Un trabajo cancelado a mano se repone (sin duplicar) si la sesión sigue viva
  const h5 = await boot({ env: ENV });
  await say(h5, '.trivia', P[1]);
  const s5 = session(h5);
  h5.scheduler.cancel(`GAME_${s5.id}_${s5.timer}`);
  assert.deepEqual(h5.games.syncAll(), { cancelled: 0, rearmed: 1 });
  assert.deepEqual(h5.games.syncAll(), { cancelled: 0, rearmed: 0 });
  h5.close();
});

test('idempotencia: temporizador viejo ignorado, finish repetido no paga dos veces y el envío fallido se reintenta', async () => {
  const h = await boot({ env: ENV });
  try {
    await say(h, '.duelo @x 100', P[1], { mentions: [P[2]] });
    await say(h, '.duelo aceptar', P[2]);
    const s = session(h);
    const oldToken = s.timer;
    await say(h, '.duelo defender', P[1]); // setTimer: token nuevo
    assert.ok(s.timer > oldToken);
    await h.games.onTimer({ payload: { gameId: s.id, token: oldToken } });
    assert.equal(s.status, 'active', 'un temporizador viejo no hace nada');
    // Pago único
    s.data.hp[P[1]] = 1;
    const potBefore = h.games.pot(s);
    assert.equal(potBefore, 200);
    await say(h, '.duelo atacar', P[2]);
    assert.equal(s.status, 'finished');
    const c = coins(h, P[2]);
    h.games.finish(s, { winners: [P[1]] });
    h.games.settle(s, [P[1]]);
    assert.equal(coins(h, P[2]), c);
    assert.equal(h.games.pot(s), 0);
    // Fallo de envío: el mensaje queda en outbox y se reintenta
    await say(h, '.trivia', P[1]);
    const s2 = session(h);
    let fail = true;
    const realSend = h.wa.sendText;
    h.wa.sendText = async (...a) => { if (fail) throw new Error('sin conexión'); return realSend(...a); };
    h.clock.t += 31000;
    await h.scheduler.runDue();
    assert.ok(s2.outbox, 'mensaje pendiente guardado');
    fail = false;
    h.clock.t += 20000;
    await h.scheduler.runDue();
    assert.equal(s2.outbox, null);
    assert.match(h.sent[h.sent.length - 1].text, /Se acabó el tiempo/);
    assert.equal(sentTo(h, /Se acabó el tiempo/).length, 1);
  } finally { h.close(); }
});

test('.juegos: lista, estado, stats y cancelar (solo ADMIN, devuelve apuestas)', async () => {
  const h = await boot({ env: ENV, admins: [P[13]] });
  try {
    assert.match(await say(h, '.juegos lista', P[2]), /Juegos disponibles[\s\S]*ppt[\s\S]*batalla/);
    assert.match(await say(h, '.juegos', P[2]), /Juegos disponibles/);
    assert.match(await say(h, '.juegos nada', P[2]), /Subcomando desconocido/);
    assert.match(await say(h, '.juegos estado', P[2]), /No hay ningún juego/);
    assert.match(await say(h, '.juegos stats', P[2]), /Todavía no jugó/);
    await say(h, '.duelo @x 100', P[1], { mentions: [P[2]] });
    assert.match(await say(h, '.juegos estado', P[2]), /Duelo.*lobby/);
    assert.match(await say(h, '.juegos cancelar', P[2]), /No tienes permiso.*ADMIN/);
    assert.equal(coins(h, P[1]), 900);
    assert.match(await say(h, '.juegos cancelar', P[13]), /cancelado.*devueltas/);
    assert.equal(coins(h, P[1]), 1000);
    assert.match(await say(h, '.juegos cancelar', P[13]), /No hay ningún juego/);
    rng(h, 0);
    await say(h, '.ppt piedra', P[2]);
    assert.match(await say(h, '.juegos stats', P[2]), /Partidas: 1[\s\S]*Piedra\/Papel\/Tijera: 0\/1/);
    assert.match(await say(h, '.juegos stats @x', P[3], { mentions: [P[2]] }), /Jugador2/);
  } finally { h.close(); }
});

test('juegos: los comandos de grupo no funcionan en privado, requieren registro y respetan el cooldown', async () => {
  const h = await boot({ env: ENV });
  try {
    const priv = await say(h, '.trivia', P[1], { group: null });
    assert.match(priv, /solo funciona en grupos/);
    assert.match(await say(h, '.trivia', '5990000@s.whatsapp.net'), /registrarte/);
  } finally { h.close(); }
  const h2 = harness({ env: ENV, startAt: Date.now() });
  try {
    await h2.say('.registro', { from: P[1], group: GROUP, pushName: 'A' });
    h2.sent.length = 0;
    await h2.say('.dados', { from: P[1], group: GROUP });
    await h2.say('.dados', { from: P[1], group: GROUP });
    assert.match(h2.sent[h2.sent.length - 1].text, /Espera \d+ s/);
  } finally { h2.close(); }
});

test('salas: .estado y .salir funcionan igual en batalla, supervivencia y eliminación', async () => {
  const h = await boot({ env: ENV });
  try {
    await say(h, '.batalla', P[1]);
    await say(h, '.batalla unirse', P[2]);
    assert.match(await say(h, '.batalla estado', P[3]), /Sala de Batalla \(2\/8\)/);
    assert.match(await say(h, '.batalla salir', P[2]), /Saliste de la sala \(1\/8\)/);
    await say(h, '.batalla salir', P[1]);
    await say(h, '.supervivencia', P[1]);
    await say(h, '.supervivencia unirse', P[2]);
    assert.match(await say(h, '.supervivencia estado', P[3]), /Sala de Supervivencia \(2\/20\)/);
    assert.match(await say(h, '.supervivencia salir', P[2]), /Saliste de la sala/);
    await say(h, '.supervivencia unirse', P[2]);
    await say(h, '.supervivencia iniciar', P[1]);
    assert.match(await say(h, '.supervivencia estado', P[3]), /ronda 1\/6/);
    assert.match(await say(h, '.supervivencia salir', P[2]), /ya empezó/);
    h.games.cancel(session(h), 'test');
    await say(h, '.eliminacion', P[1]);
    await say(h, '.eliminacion unirse', P[2]);
    assert.match(await say(h, '.eliminacion estado', P[3]), /Sala de Eliminación \(2\/20\)/);
    assert.match(await say(h, '.eliminacion salir', P[2]), /Saliste de la sala/);
    await say(h, '.eliminacion unirse', P[2]);
    await say(h, '.eliminacion iniciar', P[1]);
    assert.match(await say(h, '.eliminacion estado', P[2]), /ronda 1\/6/);
    h.games.cancel(session(h), 'test');
    assert.match(await say(h, '.batalla estado', P[1]), /No hay una sala/);
  } finally { h.close(); }
});
