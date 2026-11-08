'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, say, makeTeam, P } = require('./support');

const ENV = { REGISTER_BONUS_COINS: '0', ACTIVITY_XP: '0' };
const ADMIN = { jid: P[1] };

async function twoTeams(h) {
  const a = await makeTeam(h, '2v2', 'Alfa', [P[2], P[3]]);
  const b = await makeTeam(h, '2v2', 'Beta', [P[4], P[5]]);
  return [a, b];
}
function finish(h, a, b, winner, i = 0) {
  const m = h.matches.createForContext({ host: a, guest: b, context: { type: 'scrim', id: `S${i}` } });
  h.matches.resolve(m, ADMIN, winner);
  return m;
}

test('.amigos: solicitud, aceptación, solicitudes mutuas, rechazo, eliminación y límites', async () => {
  const h = await boot({ env: ENV });
  try {
    assert.match(await say(h, '.amigos', P[2]), /todavía no tiene amigos/);
    assert.match(await say(h, '.amigos agregar', P[2]), /Uso:/);
    assert.match(await say(h, '.amigos agregar @x', P[2], { mentions: [P[2]] }), /No puedes agregarte a ti mismo/);
    assert.match(await say(h, '.amigos agregar @x', P[2], { mentions: ['593990000777@s.whatsapp.net'] }), /no está registrada/);
    assert.match(await say(h, '.amigos agregar @x', P[2], { mentions: [P[3]] }), /Solicitud enviada/);
    assert.match(await say(h, '.amigos agregar @x', P[2], { mentions: [P[3]] }), /Ya le enviaste una solicitud/);
    assert.match(await say(h, '.amigos solicitudes', P[2]), /No tienes solicitudes/);
    assert.match(await say(h, '.amigos solicitudes', P[3]), /Solicitudes pendientes[\s\S]*Jugador2/);
    assert.match(await say(h, '.amigos', P[3]), /todavía no tiene amigos.*1 solicitudes pendientes/);
    assert.match(await say(h, '.amigos aceptar @x', P[3], { mentions: [P[4]] }), /No tienes ninguna solicitud/);
    assert.match(await say(h, '.amigos aceptar @x', P[3], { mentions: [P[2]] }), /ahora son amigos/);
    assert.match(await say(h, '.amigos agregar @x', P[2], { mentions: [P[3]] }), /Ya son amigos/);
    assert.match(await say(h, '.amigos', P[2]), /Amigos de Jugador2\* \(1\/50\)[\s\S]*Jugador3/);
    assert.match(await say(h, '.amigos @x', P[5], { mentions: [P[3]] }), /Amigos de Jugador3[\s\S]*Jugador2/);
    // Solicitudes cruzadas: la segunda acepta al instante
    await say(h, '.amigos agregar @x', P[4], { mentions: [P[5]] });
    assert.match(await say(h, '.amigos agregar @x', P[5], { mentions: [P[4]] }), /ahora son amigos/);
    // Rechazar
    await say(h, '.amigos agregar @x', P[6], { mentions: [P[7]] });
    assert.match(await say(h, '.amigos rechazar @x', P[7], { mentions: [P[6]] }), /rechazada/);
    assert.match(await say(h, '.amigos rechazar @x', P[7], { mentions: [P[6]] }), /No tienes ninguna solicitud/);
    assert.match(await say(h, '.amigos solicitudes', P[7]), /No tienes solicitudes/);
    // Eliminar (desaparece en ambos lados)
    assert.match(await say(h, '.amigos eliminar @x', P[2], { mentions: [P[4]] }), /no está en tu lista/);
    assert.match(await say(h, '.amigos eliminar @x', P[2], { mentions: [P[3]] }), /ya no está en tu lista/);
    assert.deepEqual(h.social.friendsOf(h.users.find([P[3]])), []);
    // Sin registro no se puede agregar
    const n = h.sent.length;
    await h.say('.amigos agregar @x', { from: '593990000888@s.whatsapp.net', id: 'nr', mentions: [P[2]] });
    assert.match(h.sent.slice(n)[0].text, /debes registrarte/);
    // Máximo de amigos
    const me = h.users.find([P[8]]);
    h.social._s(me).friends = Array.from({ length: 50 }, (_, i) => `x${i}@s.whatsapp.net`);
    assert.match(await say(h, '.amigos agregar @x', P[8], { mentions: [P[9]] }), /máximo de 50 amigos/);
    // Persistencia
    h.db.close();
    const { harness } = require('./harness');
    const h2 = harness({ dir: h.dir, startAt: h.clock.t, env: ENV });
    try {
      assert.deepEqual(h2.social.friendsOf(h2.users.find([P[5]])), [P[4]]);
    } finally { h2.close(); }
  } finally { h.close(); }
});

test('.logros .titulos .insignias: se desbloquean con datos reales y los títulos se equipan', async () => {
  const h = await boot({ env: ENV });
  try {
    const first = await say(h, '.logros', P[2]);
    assert.match(first, /Logros de Jugador2\* \(1\/15\)[\s\S]*✅ Bienvenido[\s\S]*🔒 Nivel 5.*\(1\/5\)[\s\S]*🔒 Primera sangre/);
    assert.match(await say(h, '.titulos', P[2]), /Títulos de Jugador2\* \(1\)[\s\S]*Recién llegado/);
    assert.match(await say(h, '.titulos equipar', P[2]), /Uso:/);
    assert.match(await say(h, '.titulos equipar Maestro', P[2]), /No tienes ese título/);
    assert.match(await say(h, '.titulos quitar', P[2]), /No tienes ningún título equipado/);
    assert.match(await say(h, '.titulos equipar recién llegado', P[2]), /Título equipado: \*Recién llegado\*/);
    assert.match(await say(h, '.titulos', P[2]), /Recién llegado ← equipado/);
    assert.match(await say(h, '.perfil', P[2]), /Título: Recién llegado[\s\S]*Amigos: 0 · 🏆 Logros: 1\/15/);
    // Victoria real → logro "Primera sangre" y capitán
    const [a, b] = await twoTeams(h);
    finish(h, a, b, 'host');
    const after = await say(h, '.logros', P[2]);
    assert.match(after, /✅ Primera sangre[\s\S]*✅ Capitán/);
    assert.match(await say(h, '.logros', P[3]), /🔒 Capitán/);
    assert.match(await say(h, '.logros @x', P[5], { mentions: [P[2]] }), /Logros de Jugador2/);
    assert.match(await say(h, '.titulos equipar primera sangre', P[2]), /Primera sangre/);
    assert.match(await say(h, '.titulos quitar', P[2]), /Ya no llevas ningún título/);
    // Subir de nivel desbloquea logros de nivel
    h.users.addXp([P[2]], 5000, 'prueba');
    assert.match(await say(h, '.logros', P[2]), /✅ Nivel 5[\s\S]*✅ Nivel 10/);
    // Idempotencia: sincronizar otra vez no duplica
    h.social.sync(h.users.find([P[2]]));
    const ids = h.users.find([P[2]]).achievements.map((x) => x.id);
    assert.equal(new Set(ids).size, ids.length);
    // Insignias
    assert.match(await say(h, '.insignias', P[2]), /Capitán de equipo/);
    assert.match(await say(h, '.insignias', P[10]), /todavía no tiene insignias/);
    h.clock.t += 40 * 86400000;
    assert.match(await say(h, '.insignias', P[10]), /Veterano \(40 días/);
    h.users.find([P[10]]).ffVerified = true;
    assert.match(await say(h, '.insignias', P[10]), /Cuenta de Free Fire verificada/);
    // Sin registrar no puede equipar títulos; consulta de no registrados
    assert.match(await say(h, '.logros @x', P[2], { mentions: ['593990000777@s.whatsapp.net'] }), /no está registrada/);
  } finally { h.close(); }
});

test('.medallas: campeón/subcampeón de torneo y podios de temporada, a partir de la final real', async () => {
  const h = await boot({ env: ENV });
  try {
    const [a, b] = await twoTeams(h);
    assert.match(await say(h, '.medallas', P[2]), /todavía no tiene medallas/);
    // Torneo finalizado cuya final fue una partida real ganada por Beta
    const final = finish(h, a, b, 'guest');
    h.db.set('tournaments', 'TRN-900', {
      id: 'TRN-900', name: 'Copa Real', status: 'finalizado', champion: b.id, runnerUp: a.id, teams: [],
      bracket: { rounds: [{ matches: [{ matchId: final.id }] }] },
    });
    assert.match(await say(h, '.medallas', P[4]), /Medallas de Jugador4\* \(1\)[\s\S]*🏆 Campeón de Copa Real \(TRN-900\)/);
    assert.match(await say(h, '.medallas', P[2]), /🥈 Subcampeón de Copa Real/);
    assert.match(await say(h, '.medallas', P[8]), /todavía no tiene medallas/);
    assert.match(await say(h, '.logros', P[4]), /✅ Campeón de torneo/);
    assert.match(await say(h, '.insignias', P[4]), /Campeón de torneo \(1\)/);
    // Podio de temporada
    h.elo.closeSeason({ jid: P[1] });
    const m = await say(h, '.medallas', P[4]);
    assert.match(m, /Podio de la temporada 1 \(puesto [123]\)/);
    assert.match(await say(h, '.medallas @x', P[8], { mentions: [P[4]] }), /Medallas de Jugador4/);
  } finally { h.close(); }
});

test('.estadisticas y .comparar perfil: datos reales', async () => {
  const h = await boot({ env: ENV });
  try {
    const [a, b] = await twoTeams(h);
    finish(h, a, b, 'host');
    h.games.recordStat(P[2], 'dados', true);
    h.games.recordStat(P[2], 'dados', true);
    h.games.recordStat(P[2], 'ppt', false);
    await say(h, '.amigos agregar @x', P[2], { mentions: [P[3]] });
    await say(h, '.amigos aceptar @x', P[3], { mentions: [P[2]] });
    const st = await say(h, '.estadisticas', P[2]);
    assert.match(st, /Estadísticas de Jugador2[\s\S]*Partidas: 1 · 1V 0D \(100% victorias\)[\s\S]*ELO: 1[.,]?024 \(#1\)[\s\S]*Juegos: 2 victorias de 3 · mejor: dados \(2\)[\s\S]*Torneos: 0 ganados[\s\S]*Equipos: Alfa \(2v2\)[\s\S]*Amigos: 1 · 🏅 Logros: \d+\/15/);
    assert.match(await say(h, '.estadisticas @x', P[8], { mentions: [P[4]] }), /Estadísticas de Jugador4[\s\S]*0V 1D[\s\S]*Juegos: 0 victorias de 0/);
    assert.match(await say(h, '.stats', P[2]), /Estadísticas de Jugador2/);
    const cmp = await say(h, '.comparar perfil @x @y', P[8], { mentions: [P[2], P[4]] });
    assert.match(cmp, /Jugador2\* vs \*Jugador4[\s\S]*Amigos: 1 — 0[\s\S]*ELO: 1[.,]?024 — 976[\s\S]*Victorias en juegos: 2 — 0/);
    assert.match(await say(h, '.comparar perfil @x', P[4], { mentions: [P[2]] }), /Jugador4\* vs \*Jugador2/);
    assert.match(await say(h, '.comparar perfil @x', P[2], { mentions: [P[2]] }), /dos personas distintas/);
    assert.match(await say(h, '.comparar perfil', P[8]), /Uso:/);
  } finally { h.close(); }
});
