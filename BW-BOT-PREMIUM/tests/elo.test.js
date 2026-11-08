'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./harness');
const { boot, say, makeTeam, P, OWNER } = require('./support');
const { EVENTS } = require('../src/events/bus');
const { expected } = require('../src/services/elo');

const ENV = { REGISTER_BONUS_COINS: '0', ACTIVITY_XP: '0' };
const ADMIN = { jid: P[1] };

async function twoTeams(h) {
  const a = await makeTeam(h, '2v2', 'Alfa', [P[2], P[3]]);
  const b = await makeTeam(h, '2v2', 'Beta', [P[4], P[5]]);
  return [a, b];
}

/** Partida real finalizada por un administrador (la vía normal de torneos/scrims/partidas). */
function finish(h, a, b, winner, i = 0) {
  const m = h.matches.createForContext({ host: a, guest: b, context: { type: 'scrim', id: `X${i}` } });
  h.matches.resolve(m, ADMIN, winner);
  return m;
}

test('ELO: fórmula, K provisional, jugadores y equipos; empate; piso', async () => {
  const h = await boot({ env: ENV });
  try {
    assert.equal(expected(1000, 1000), 0.5);
    const [a, b] = await twoTeams(h);
    const m = finish(h, a, b, 'host');
    // Equipos nuevos (1000 vs 1000), K provisional 48 → ±24
    assert.equal(h.elo.team(a.id).elo, 1024);
    assert.equal(h.elo.team(b.id).elo, 976);
    for (const j of [P[2], P[3]]) assert.equal(h.elo.player(j).elo, 1024);
    for (const j of [P[4], P[5]]) assert.equal(h.elo.player(j).elo, 976);
    assert.equal(h.elo.player(P[2]).wins, 1);
    assert.equal(h.elo.player(P[4]).losses, 1);
    assert.equal(h.elo.player(P[2]).history[0].match, m.id);
    // Segunda partida: gana otra vez el favorito → gana menos que 24
    finish(h, a, b, 'host', 1);
    const gain = h.elo.team(a.id).elo - 1024;
    assert.ok(gain > 0 && gain < 24, `ganancia ${gain}`);
    assert.ok(h.elo.team(b.id).elo < 976);
    // Empate entre iguales no cambia nada
    const h2 = await boot({ env: ENV });
    try {
      const [c, d] = await twoTeams(h2);
      finish(h2, c, d, 'draw');
      assert.equal(h2.elo.team(c.id).elo, 1000);
      assert.equal(h2.elo.team(c.id).draws, 1);
      assert.equal(h2.elo.player(P[2]).draws, 1);
    } finally { h2.close(); }
  } finally { h.close(); }
});

test('ELO: idempotencia (mismo id de partida no se aplica dos veces), también tras reiniciar', async () => {
  const h = await boot({ env: ENV });
  try {
    const [a, b] = await twoTeams(h);
    const m = finish(h, a, b, 'host');
    const before = h.elo.team(a.id).elo;
    assert.equal(h.elo.applyMatch(m), null);
    h.bus.emit(EVENTS.matchFinished, { match: m });
    h.bus.emit(EVENTS.matchFinished, { match: m });
    assert.equal(h.elo.team(a.id).elo, before);
    assert.equal(h.elo.team(a.id).matches, 1);
    assert.equal(h.elo.player(P[2]).matches, 1);
    // Reinicio: el ELO y el registro de partidas aplicadas persisten
    h.db.close();
    const h2 = harness({ dir: h.dir, startAt: h.clock.t, env: ENV });
    try {
      assert.equal(h2.elo.team(a.id).elo, before);
      assert.equal(h2.elo.applyMatch(h2.matches.get(m.id)), null);
      assert.equal(h2.elo.team(a.id).matches, 1);
    } finally { h2.close(); }
  } finally { h.close(); }
});

test('ELO: partidas canceladas o sin resultado no puntúan; límite diario contra el mismo rival', async () => {
  const h = await boot({ env: { ...ENV, ELO_MAX_PAIR_PER_DAY: '2' } });
  try {
    const [a, b] = await twoTeams(h);
    const pending = h.matches.createForContext({ host: a, guest: b, context: { type: 'scrim', id: 'P' } });
    assert.equal(h.elo.applyMatch(pending), null); // aún no finalizada
    h.matches.cancelContext(pending, 'prueba');
    assert.equal(h.elo.applyMatch(pending), null);
    assert.equal(h.elo.team(a.id).matches, 0);
    finish(h, a, b, 'host', 1);
    finish(h, a, b, 'host', 2);
    const elo2 = h.elo.team(a.id).elo;
    finish(h, a, b, 'host', 3); // tercera en 24 h: se registra pero no puntúa
    assert.equal(h.elo.team(a.id).elo, elo2);
    assert.equal(h.elo.team(a.id).wins, 3);
    assert.equal(h.elo.team(a.id).history.at(-1).rated, false);
    h.clock.t += 25 * 3600 * 1000;
    finish(h, a, b, 'host', 4);
    assert.ok(h.elo.team(a.id).elo > elo2);
  } finally { h.close(); }
});

test('.elo y .elo historial: perfil, historial, objetivos y errores', async () => {
  const h = await boot({ env: ENV });
  try {
    const [a, b] = await twoTeams(h);
    assert.match(await say(h, '.elo', P[2]), /ELO de Jugador2.*1[.,]?000.*sin clasificar[\s\S]*Aún no tiene partidas/);
    assert.match(await say(h, '.elo historial', P[2]), /todavía no tiene partidas/);
    finish(h, a, b, 'host');
    const out = await say(h, '.elo', P[2]);
    assert.match(out, /ELO de Jugador2.*1[.,]?024.*#1[\s\S]*1V 0D 0E[\s\S]*Temporada 1.*\+24 ELO/);
    assert.match(await say(h, '.elo @x', P[3], { mentions: [P[4]] }), /ELO de Jugador4.*976/);
    assert.match(await say(h, '.elo @x', P[3], { mentions: ['59399999999999@s.whatsapp.net'] }), /no está registrada/);
    assert.match(await say(h, '.elo historial', P[2]), /✅.*vs Beta.*\+24.*1[.,]?024/);
    assert.match(await say(h, '.elo historial @x', P[2], { mentions: [P[4]] }), /❌.*vs Alfa.*-24/);
  } finally { h.close(); }
});

test('.ranking: elo, victorias, xp, niveles, monedas, juegos, equipos y clanes', async () => {
  const h = await boot({ env: ENV });
  try {
    assert.match(await say(h, '.ranking', P[2]), /Clasificaciones disponibles[\s\S]*ranking elo/);
    assert.match(await say(h, '.ranking zzz', P[2]), /desconocida/);
    assert.match(await say(h, '.top elo', P[2]), /Todavía no hay datos/);
    const [a, b] = await twoTeams(h);
    finish(h, a, b, 'host');
    finish(h, a, b, 'host', 1);
    const elo = await say(h, '.ranking elo', P[2]);
    assert.match(elo, /Top ELO — temporada 1[\s\S]*🥇 Jugador[23] — [\d.,]+ ELO · 2V 0D/);
    assert.match(elo, /Jugador[45] — [\d.,]+ ELO · 0V 2D/);
    assert.match(await say(h, '.ranking victorias', P[2]), /Top victorias[\s\S]*Jugador[23] — 2 victorias de 2 partidas/);
    h.users.addXp([P[7]], 500, 'prueba');
    h.users.addCoins([P[8]], 777, 'prueba');
    assert.match(await say(h, '.ranking xp', P[2]), /🥇 Jugador7 — 550 XP/);
    assert.match(await say(h, '.ranking niveles', P[2]), /🥇 Jugador7 — nivel \d+/);
    assert.match(await say(h, '.ranking monedas', P[2]), /🥇 Jugador8 — 777 🪙/);
    assert.match(await say(h, '.ranking equipos', P[2]), /🥇 Alfa \(2v2\) — [\d.,]+ ELO · 2V 0D 0E[\s\S]*Beta/);
    assert.match(await say(h, '.ranking equipos 2v2', P[2]), /Top equipos 2v2/);
    assert.match(await say(h, '.ranking equipos 4v4', P[2]), /Todavía no hay datos/);
    assert.match(await say(h, '.ranking equipos 9v9', P[2]), /2v2, 4v4 o 6v6/);
    // Clanes: media del ELO de sus equipos
    h.teams.db.get('teams', a.id).clanId = 'CLN-1';
    h.teams.db.get('teams', b.id).clanId = 'CLN-1';
    assert.match(await say(h, '.ranking clanes', P[2]), /Top clanes[\s\S]*CLN-1 — 1[.,]?000 ELO · 2 equipos · 2V 2D/);
    // Juegos: victorias reales registradas por el servicio de juegos
    assert.match(await say(h, '.ranking juegos', P[2]), /Todavía no hay datos/);
    h.games.recordStat(P[9], 'dados', true);
    h.games.recordStat(P[9], 'dados', true);
    h.games.recordStat(P[10], 'dados', false);
    h.games.recordStat(P[10], 'ppt', true);
    assert.match(await say(h, '.ranking juegos', P[2]), /🥇 Jugador9 — 2 victorias de 2 partidas/);
    assert.match(await say(h, '.ranking juegos ppt', P[2]), /Top ppt[\s\S]*Jugador10 — 1 victorias de 1 partidas/);
    assert.match(await say(h, '.ranking juegos !!', P[2]), /no válido/);
  } finally { h.close(); }
});

test('.rival: más enfrentado, némesis y presa; sin rivales', async () => {
  const h = await boot({ env: ENV });
  try {
    const [a, b] = await twoTeams(h);
    const c = await makeTeam(h, '2v2', 'Gamma', [P[6], P[7]]);
    assert.match(await say(h, '.rival', P[2]), /todavía no tiene rivales/);
    finish(h, a, b, 'host', 1);
    finish(h, a, b, 'host', 2);
    finish(h, a, c, 'guest', 3);
    const out = await say(h, '.rival', P[2]);
    assert.match(out, /Más enfrentado: Beta \(2V-0D-0E en 2\)/);
    assert.match(out, /Némesis \(más derrotas\): Gamma \(0V-1D-0E en 1\)/);
    assert.match(out, /Presa favorita \(más victorias\): Beta/);
    assert.match(await say(h, '.rival @x', P[2], { mentions: [P[4]] }), /Némesis \(más derrotas\): Alfa/);
  } finally { h.close(); }
});

test('.comparar jugador y equipo', async () => {
  const h = await boot({ env: ENV });
  try {
    const [a, b] = await twoTeams(h);
    finish(h, a, b, 'host');
    assert.match(await say(h, '.comparar', P[2]), /Uso:/);
    const pj = await say(h, '.comparar jugador @x @y', P[9], { mentions: [P[2], P[4]] });
    assert.match(pj, /Jugador2\* vs \*Jugador4[\s\S]*ELO: 1[.,]?024 — 976[\s\S]*Mayor ELO: Jugador2 \(48 de diferencia\)/);
    assert.match(await say(h, '.comparar jugador @x', P[4], { mentions: [P[2]] }), /Jugador4\* vs \*Jugador2/);
    assert.match(await say(h, '.comparar jugador @x', P[2], { mentions: [P[2]] }), /dos personas distintas/);
    assert.match(await say(h, '.comparar jugador', P[9]), /Uso:/);
    const pt = await say(h, `.comparar equipo ${a.id} ${b.id}`, P[9]);
    assert.match(pt, /Alfa\* \(2v2\) vs \*Beta[\s\S]*ELO: 1[.,]?024 — 976[\s\S]*Récord: 1V 0D 0E — 0V 1D 0E[\s\S]*Cara a cara: Alfa 1 — 0 Beta \(1 partidas/);
    assert.match(await say(h, `.comparar equipo ${b.id}`, P[2]), /Alfa\* \(2v2\) vs \*Beta/);
    assert.match(await say(h, `.comparar equipo ${a.id} ${a.id}`, P[2]), /dos equipos distintos/);
    assert.match(await say(h, '.comparar equipo', P[2]), /Uso:/);
    assert.match(await say(h, '.comparar equipo EQ-9999 EQ-0001', P[2]), /No encontré el equipo/);
  } finally { h.close(); }
});

test('.temporada: info, historial, cierre con premios, reinicio suave, permisos e idempotencia', async () => {
  const h = await boot({ env: ENV });
  try {
    assert.match(await say(h, '.temporada', P[2]), /Temporada 1[\s\S]*Aún no hay partidas[\s\S]*Premios al cierre.*300.*200.*100/);
    assert.match(await say(h, '.temporada zzz', P[2]), /desconocido/);
    assert.match(await say(h, '.temporada historial', P[2]), /no se ha cerrado ninguna/);
    assert.match(await say(h, '.temporada cerrar', P[1]), /No tienes permiso.*SUPERADMIN/);
    assert.match(await say(h, '.temporada cerrar', P[2]), /No tienes permiso/);
    const [a, b] = await twoTeams(h);
    finish(h, a, b, 'host');
    const events = [];
    h.bus.on(EVENTS.seasonClosed, (e) => events.push(e.season.number));
    const coins = h.users.find([P[2]]).coins;
    const out = await say(h, '.temporada cerrar', OWNER);
    assert.match(out, /Temporada 1 cerrada.*temporada 2[\s\S]*Podio: 🥇 Jugador[23] \(1[.,]?024 ELO\)[\s\S]*Premios: 🥇 300 🪙 · 🥈 200 🪙 · 🥉 100 🪙/);
    assert.deepEqual(events, [1]);
    // Premios en monedas virtuales a los 3 primeros (2 ganadores + 1er perdedor por orden de ELO)
    const rewarded = [P[2], P[3]].reduce((n, j) => n + h.users.find([j]).coins, 0) - 2 * coins;
    assert.equal(rewarded, 500);
    // Reinicio suave 50%: 1024 → 1012, 976 → 988; estadísticas de temporada a cero; las de siempre se conservan
    assert.equal(h.elo.player(P[2]).elo, 1012);
    assert.equal(h.elo.player(P[4]).elo, 988);
    assert.equal(h.elo.team(a.id).elo, 1012);
    assert.equal(h.elo.player(P[2]).season.matches, 0);
    assert.equal(h.elo.player(P[2]).matches, 1);
    assert.equal(h.elo.season().number, 2);
    assert.match(await say(h, '.temporada', P[2]), /Temporada 2/);
    assert.match(await say(h, '.temporada historial', P[2]), /Temporada 1 \(.*\): 🥇 Jugador[23].*Mejor equipo: Alfa/);
    // Segundo cierre = otra temporada distinta (la 2), no repite premios de la 1
    const coinsAfter = h.users.find([P[2]]).coins;
    assert.match(await say(h, '.temporada cerrar', OWNER), /Temporada 2 cerrada/);
    assert.equal(h.users.find([P[2]]).coins, coinsAfter);
    assert.equal(h.elo.seasons().length, 2);
    // Persistencia tras reiniciar
    h.db.close();
    const h2 = harness({ dir: h.dir, startAt: h.clock.t, env: ENV });
    try {
      assert.equal(h2.elo.season().number, 3);
      assert.equal(h2.elo.seasons().length, 2);
    } finally { h2.close(); }
  } finally { h.close(); }
});

test('competitivo: rate limit (cooldown) y los comandos son de grupo/privado sin registrar', async () => {
  const h = await boot({ env: ENV });
  try {
    const n = h.sent.length;
    await h.say('.ranking elo', { from: P[2], id: 'rl-1' });
    await h.say('.ranking elo', { from: P[2], id: 'rl-2' });
    const replies = h.sent.slice(n).map((s) => s.text);
    assert.equal(replies.length, 2);
    assert.match(replies[1], /Espera \d+ s/);
    // Usuario sin registrar: puede ver rankings pero .elo propio pide registro
    const m = h.sent.length;
    await h.say('.elo', { from: '59399888888888@s.whatsapp.net', id: 'nr-1' });
    assert.match(h.sent.slice(m)[0].text, /regístrate/);
  } finally { h.close(); }
});
