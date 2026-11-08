'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { harness } = require('./harness');
const { P, GROUP, GROUP2, boot, say, makeTeam } = require('./support');
const { EVENTS } = require('../src/events/bus');

const ENV = { REGISTER_BONUS_COINS: '100', ACTIVITY_XP: '0' };
const START = Date.parse('2026-10-05T17:00:00Z'); // 12:00 en Guayaquil
const coins = (h, j) => h.users.find([j]).coins;
const T1 = 'TRN-001';

/** n equipos 2v2: Tk con capitán P[2k] y jugador P[2k+1]. */
async function mkTeams(h, n) {
  const out = [];
  for (let i = 1; i <= n; i++) out.push(await makeTeam(h, '2v2', `Eq${i}`, [P[2 * i], P[2 * i + 1]]));
  return out;
}
const cap = (i) => P[2 * i];

async function openTournament(h, { max = 8, prize = 0 } = {}) {
  await say(h, `.torneo crear 2v2 ${max} Copa Test`, P[1]);
  if (prize) await say(h, `.torneo editar ${T1} premio ${prize}`, P[1]);
  await say(h, `.torneo abrir ${T1}`, P[1]);
}

async function readyTournament(h, n, opts = {}) {
  await mkTeams(h, n);
  await openTournament(h, opts);
  for (let i = 1; i <= n; i++) await say(h, `.torneo inscribir ${T1}`, cap(i));
  await say(h, `.torneo cerrar ${T1}`, P[1]);
  for (let i = 1; i <= n; i++) await say(h, `.torneo checkin ${T1}`, cap(i));
}

/** Los dos capitanes reportan el mismo resultado de una partida del torneo. side = 'host' | 'guest' (ganador). */
async function play(h, matchId, side) {
  const m = h.matches.get(matchId);
  const hostCap = h.teams.db.get('teams', m.host).captain;
  const guestCap = h.teams.db.get('teams', m.guest).captain;
  await say(h, `.partida resultado ${matchId} ${side === 'host' ? 'victoria' : 'derrota'}`, hostCap);
  await say(h, `.partida resultado ${matchId} ${side === 'host' ? 'derrota' : 'victoria'}`, guestCap);
  return h.matches.get(matchId);
}

const liveMatches = (h) => h.tournaments.pendingMatches(h.tournaments.get(T1));

test('.torneo crear/editar/abrir/eliminar: validaciones, permisos y estados del borrador', async () => {
  const h = await boot({ env: ENV });
  try {
    assert.match(await say(h, '.torneo crear 2v2 8 Copa', P[2]), /No tienes permiso.*ADMIN/);
    assert.match(await say(h, '.torneo crear 2v2', P[1]), /Uso:/);
    assert.match(await say(h, '.torneo crear 5v5 8 Copa', P[1]), /2v2, 4v4 o 6v6/);
    assert.match(await say(h, '.torneo crear 2v2 99 Copa', P[1]), /entre 2 y 32/);
    assert.match(await say(h, '.torneo crear 2v2 8 ab', P[1]), /entre 3 y 40/);
    assert.match(await say(h, '.torneo crear 2v2 8 Copa Verano', P[1]), /TRN-001.*borrador/s);
    assert.match(await say(h, '.torneo crear 2v2 8 copa verano', P[1]), /Ya existe un torneo/);
    assert.match(await say(h, '.torneo editar TRN-001 premio abc', P[1]), /número entero/);
    assert.match(await say(h, '.torneo editar TRN-001 premio 500', P[1]), /actualizado/);
    assert.match(await say(h, '.torneo editar TRN-001 puntos 5', P[1]), /5 pts por victoria/);
    assert.match(await say(h, '.torneo editar TRN-001 max 4', P[1]), /4 equipos|actualizado/);
    assert.match(await say(h, '.torneo editar TRN-001 nombre Copa Otoño', P[1]), /Copa Otoño/);
    assert.match(await say(h, '.torneo editar TRN-001 color rojo', P[1]), /Campo no editable/);
    assert.match(await say(h, '.torneo editar TRN-001 inicio 11:00', P[1]), /actualizado/); // 11:00 ya pasó hoy → mañana
    assert.ok(h.tournaments.get(T1).startAt > h.clock.t);
    assert.match(await say(h, '.torneo editar TRN-001 inicio ayer', P[1]), /HH:MM/);
    assert.match(await say(h, '.torneo editar TRN-001 inicio borrar', P[1]), /Sin definir|sin definir/i);
    // Otro grupo no puede gestionar
    h.wa.groupMetadata = async () => ({ participants: [{ id: P[1], admin: 'admin' }] });
    assert.match(await say(h, '.torneo abrir TRN-001', P[1], { group: GROUP2 }), /solo puedes gestionar torneos creados en este grupo/i);
    assert.match(await say(h, '.torneo abrir TRN-999', P[1]), /No encontré el torneo/);
    assert.match(await say(h, '.torneo abrir TRN-001', P[1]), /Inscripción abierta/);
    assert.match(await say(h, '.torneo abrir TRN-001', P[1]), /está inscripcion/);
    assert.match(await say(h, '.torneo eliminar TRN-001', P[1]), /no se puede eliminar/);
    assert.match(await say(h, '.torneo crear 4v4 4 Otro', P[1]), /TRN-002/);
    assert.match(await say(h, '.torneo eliminar TRN-002', P[1]), /eliminado/);
    assert.equal(h.tournaments.get('TRN-002'), null);
    assert.match(await say(h, '.torneo editar TRN-001 max 3', P[1]), /actualizado/);
    // El id no se reutiliza
    assert.match(await say(h, '.torneo crear 2v2 4 Tercero', P[1]), /TRN-003/);
  } finally { h.close(); }
});

test('.torneo inscribir/salir/participantes/checkin/checkout: reglas de equipos y jugadores', async () => {
  const h = await boot({ env: ENV });
  try {
    await mkTeams(h, 4);
    const four = await makeTeam(h, '4v4', 'Cuatro', [P[10], P[11], P[12], P[13]]);
    await say(h, '.equipo crear 2v2 Solo', P[14]);
    await openTournament(h, { max: 3 });
    assert.match(await say(h, '.torneo inscribir TRN-001', P[14]), /debe estar completo \(1\/2\)/);
    assert.match(await say(h, '.torneo inscribir TRN-001', P[10]), /No tienes un equipo 2v2/);
    assert.match(await say(h, '.torneo inscribir TRN-001', P[3]), /Solo el capitán o el subcapitán/);
    assert.match(await say(h, '.torneo inscribir TRN-001 ' + four.id, P[10]), /es 2v2 y tu equipo 4v4/);
    assert.match(await say(h, '.torneo inscribir TRN-001', cap(1)), /inscrito en.*1\/3/);
    assert.match(await say(h, '.torneo inscribir TRN-001', cap(1)), /ya está inscrito/);
    await say(h, '.torneo inscribir TRN-001', cap(2));
    await say(h, '.torneo inscribir TRN-001', cap(3));
    assert.match(await say(h, '.torneo inscribir TRN-001', cap(4)), /ya tiene los 3 equipos/);
    assert.match(await say(h, '.torneo participantes TRN-001', P[5]), /3\/3 equipos · 6 jugadores[\s\S]*Eq1[\s\S]*sin check-in/);
    // No se puede hacer check-in con el equipo incompleto, ni ser retirado por un no capitán
    assert.match(await say(h, '.torneo salir TRN-001', P[3]), /Solo el capitán/);
    assert.match(await say(h, '.torneo salir TRN-001', cap(3)), /salió/);
    assert.match(await say(h, '.torneo salir TRN-001', cap(3)), /no está inscrito/);
    assert.match(await say(h, '.torneo checkin TRN-001', cap(1)), /Check-in hecho.*1\/2/);
    assert.match(await say(h, '.torneo checkin TRN-001', cap(1)), /ya hizo check-in/);
    assert.match(await say(h, '.torneo checkout TRN-001', cap(1)), /Check-out hecho/);
    assert.match(await say(h, '.torneo checkout TRN-001', cap(1)), /no tenía check-in/);
    assert.match(await say(h, '.torneo checkin TRN-001', cap(3)), /no está inscrito/);
    // El equipo registrado no se puede disolver; tras cerrar tampoco se cambia la plantilla
    assert.match(await say(h, '.equipo disolver EQ-0001', cap(1)), /participa en el torneo/);
    await say(h, '.torneo cerrar TRN-001', P[1]);
    assert.match(await say(h, '.equipo salir', P[3]), /participa en el torneo/);
    assert.match(await say(h, '.torneo inscribir TRN-001', cap(3)), /está cerrado/);
    // Un jugador no puede participar con dos equipos en torneos activos
    await openTournamentTwo(h);
  } finally { h.close(); }
});

async function openTournamentTwo(h) {
  await say(h, '.torneo crear 2v2 4 Segundo', P[1]);
  await say(h, '.torneo abrir TRN-002', P[1]);
  assert.match(await say(h, '.torneo inscribir TRN-002', cap(1)), /ya está inscrito en Copa Test/);
}

test('torneo de 4 equipos completo: cuadro, partidas reales, avance, campeón, premios, puntos y ranking', async () => {
  const h = await boot({ env: ENV });
  try {
    const events = [];
    h.bus.on(EVENTS.tournamentFinished, (e) => events.push(e.tournament.id));
    await readyTournament(h, 4, { prize: 200 });
    assert.match(await say(h, '.torneo iniciar TRN-001', cap(1)), /No tienes permiso/);
    const start = (await (async () => { const n = h.sent.length; await say(h, '.torneo iniciar TRN-001', P[1]); return h.sent.slice(n)[0]; })());
    assert.match(start.text, /comienza[\s\S]*Semifinal[\s\S]*Eq1 vs Eq2[\s\S]*Eq3 vs Eq4[\s\S]*Final[\s\S]*— vs —/);
    assert.ok(start.mentions.includes(cap(1)), 'menciona capitanes reales');
    const t = h.tournaments.get(T1);
    assert.equal(t.status, 'en_curso');
    assert.equal(liveMatches(h).length, 2);
    const [m1, m2] = liveMatches(h);
    assert.match(await say(h, '.torneo partidas TRN-001', P[5]), new RegExp(`${m1.matchId}[\\s\\S]*${m2.matchId}`));
    assert.match(await say(h, '.torneo ronda TRN-001', P[5]), /Semifinal/);
    assert.match(await say(h, '.torneo ronda TRN-001 9', P[5]), /entre 1 y 2/);
    // Las partidas de torneo no admiten empate ni se cancelan por los capitanes
    assert.match(await say(h, `.partida resultado ${m1.matchId} empate`, cap(1)), /no hay empates/);
    assert.match(await say(h, `.partida cancelar ${m1.matchId}`, cap(1)), /pertenece a un torneo/);
    // Semifinales: ganan Eq1 (host) y Eq4 (guest)
    await play(h, m1.matchId, 'host');
    assert.equal(liveMatches(h).length, 1);
    await play(h, m2.matchId, 'guest');
    const final = liveMatches(h);
    assert.equal(final.length, 1);
    assert.equal(final[0].name, 'Final');
    assert.deepEqual([final[0].a, final[0].b], ['EQ-0001', 'EQ-0004']);
    assert.match(await say(h, '.torneo bracket TRN-001', P[5]), /✅ Eq1[\s\S]*✅ Eq4/);
    // Final: gana Eq4
    await play(h, final[0].matchId, 'guest');
    assert.equal(t.status, 'finalizado');
    assert.equal(t.champion, 'EQ-0004');
    assert.equal(t.runnerUp, 'EQ-0001');
    assert.deepEqual(events, [T1]);
    // Premios: 200 a cada jugador campeón, 100 al subcampeón (monedas virtuales)
    assert.equal(coins(h, cap(4)), 100 + 200);
    assert.equal(coins(h, P[9]), 100 + 200);
    assert.equal(coins(h, cap(1)), 100 + 100);
    assert.equal(coins(h, cap(2)), 100);
    // Puntos: victorias x3 + bonos
    assert.deepEqual(Object.fromEntries(h.tournaments.pointsTable(t).map((r) => [r.teamId, r.pts])), { 'EQ-0004': 3 + 3 + 10, 'EQ-0001': 3 + 5 });
    assert.match(await say(h, '.torneo puntos TRN-001', P[5]), /1\. Eq4 — 16 pts[\s\S]*2\. Eq1 — 8 pts/);
    assert.match(await say(h, '.torneo ranking', P[5]), /1\. Eq4 — 16 pts · 1 títulos · 2 victorias/);
    assert.match(await say(h, '.torneo stats EQ-0004', P[5]), /1 jugados · 1 títulos/);
    assert.match(await say(h, '.torneo stats EQ-0003', P[5]), /1 jugados · 0 títulos|todavía no terminó/);
    assert.match(await say(h, '.torneo ganadores', P[5]), /Copa Test: 🥇 Eq4 · 🥈 Eq1/);
    assert.match(await say(h, '.torneo historial', P[5]), /Copa Test \(TRN-001\) — 🥇 Eq4/);
    assert.match(await say(h, '.torneo premios TRN-001', P[5]), /200 🪙 por jugador[\s\S]*Pagados: 4/);
    assert.match(await say(h, '.torneo info TRN-001', P[5]), /FINALIZADO[\s\S]*Campeón: Eq4/);
    assert.match(await say(h, '.torneo partidas TRN-001', P[5]), /No hay partidas en juego/);
    // Idempotencia: reprocesar el último evento o finalizar a mano no repite premios ni puntos
    h.tournaments.onMatchFinished(h.matches.get(final[0].matchId));
    h.tournaments._finalize(t, t.bracket.rounds[1].matches[0]);
    assert.equal(coins(h, cap(4)), 300);
    assert.equal(h.tournaments.teamStats('EQ-0004').points, 16);
    assert.equal(events.length, 1, 'finalizar dos veces no repite');
    // Estadísticas de equipo de las partidas reales
    assert.equal(h.db.get('teams', 'EQ-0004').stats.wins, 2);
    assert.match(await say(h, '.torneo finalizar TRN-001', P[1]), /está finalizado/);
    // La plantilla vuelve a poder cambiar
    assert.match(await say(h, '.equipo salir', P[9]), /Saliste/);
  } finally { h.close(); }
});

test('torneo con número impar de equipos: descansos (bye) y tamaños 3, 5 y 6', async () => {
  for (const n of [3, 5, 6]) {
    const h = await boot({ env: ENV, users: 14 });
    try {
      await readyTournament(h, n);
      await say(h, '.torneo iniciar TRN-001', P[1]);
      const t = h.tournaments.get(T1);
      const size = n <= 4 ? 4 : 8;
      assert.equal(t.bracket.size, size);
      const byes = t.bracket.rounds[0].matches.filter((m) => m.how === 'descanso').length;
      assert.equal(byes, size - n);
      assert.equal(liveMatches(h).filter((m) => m.round === 1).length, n - size / 2);
      // Jugar todo hasta el final, siempre gana el anfitrión
      let guard = 0;
      while (h.tournaments.get(T1).status === 'en_curso' && guard++ < 20) {
        for (const m of liveMatches(h)) await play(h, m.matchId, 'host');
      }
      assert.equal(h.tournaments.get(T1).status, 'finalizado', `n=${n}`);
      assert.ok(h.tournaments.get(T1).champion);
    } finally { h.close(); }
  }
});

test('torneo: iniciar exige 2 equipos con check-in, excluye no-shows y admite sorteo', async () => {
  const h = await boot({ env: ENV });
  try {
    await mkTeams(h, 4);
    await openTournament(h);
    for (let i = 1; i <= 4; i++) await say(h, `.torneo inscribir ${T1}`, cap(i));
    assert.match(await say(h, `.torneo iniciar ${T1}`, P[1]), /al menos 2 equipos con check-in \(hay 0\)/);
    await say(h, `.torneo checkin ${T1}`, cap(1));
    assert.match(await say(h, `.torneo iniciar ${T1}`, P[1]), /hay 1/);
    for (const i of [2, 3, 4]) await say(h, `.torneo checkin ${T1}`, cap(i));
    // Sale un jugador de Eq3 antes de iniciar (la plantilla aún no está bloqueada con la inscripción abierta)
    await say(h, '.equipo salir', P[7]);
    assert.match(await say(h, `.torneo iniciar ${T1}`, P[1]), /Eq3 ya no está completo/);
    await say(h, `.torneo checkout ${T1}`, cap(3));
    h.games.randInt = (n) => 0;
    h.tournaments.randInt = (n) => 0;
    assert.match(await say(h, `.torneo iniciar ${T1} sorteo`, P[1]), /sorteo/);
    const t = h.tournaments.get(T1);
    assert.deepEqual(t.noShows, ['EQ-0003']);
    assert.equal(t.teams.length, 3);
    assert.equal(t.seeding, 'sorteo');
    assert.equal(t.bracket.size, 4);
    assert.match(await say(h, `.torneo iniciar ${T1}`, P[1]), /está en curso/);
    assert.match(await say(h, `.torneo salir ${T1}`, cap(1)), /está en curso/);
    assert.match(await say(h, `.torneo checkin ${T1}`, cap(1)), /está en curso/);
  } finally { h.close(); }
});

test('torneo: descalificación (partida en juego y walkover futuro) y cancelación con partidas pendientes', async () => {
  const h = await boot({ env: ENV });
  try {
    await readyTournament(h, 4);
    await say(h, `.torneo iniciar ${T1}`, P[1]);
    assert.match(await say(h, `.torneo descalificar ${T1}`, P[1]), /Uso:/);
    assert.match(await say(h, `.torneo descalificar ${T1} EQ-0001`, cap(1)), /No tienes permiso/);
    assert.match(await say(h, `.torneo descalificar ${T1} EQ-0001`, P[1]), /fue descalificado/);
    const t = h.tournaments.get(T1);
    assert.equal(t.bracket.rounds[0].matches[0].winner, 'EQ-0002');
    assert.equal(h.matches.get(t.bracket.rounds[0].matches[0].matchId).result.source, 'administrador');
    assert.match(await say(h, `.torneo descalificar ${T1} EQ-0001`, P[1]), /ya está descalificado/);
    // Eq2 también descalificado antes de jugar la final: el finalista restante avanza por walkover
    const m2 = liveMatches(h).find((m) => m.round === 1);
    await play(h, m2.matchId, 'host'); // gana Eq3
    assert.match(await say(h, `.torneo descalificar ${T1} EQ-0002`, P[1]), /fue descalificado/);
    assert.equal(t.status, 'finalizado');
    assert.equal(t.champion, 'EQ-0003');
    assert.equal(t.bracket.rounds[1].matches[0].how, 'partida');
    // Cancelar un torneo en curso cancela sus partidas
    const h2 = await boot({ env: ENV });
    try {
      await readyTournament(h2, 4);
      await say(h2, `.torneo iniciar ${T1}`, P[1]);
      const ids = liveMatches(h2).map((m) => m.matchId);
      assert.match(await say(h2, `.torneo cancelar ${T1} lluvia`, cap(1)), /No tienes permiso/);
      assert.match(await say(h2, `.torneo cancelar ${T1} lluvia`, P[1]), /cancelado/);
      assert.deepEqual(ids.map((id) => h2.matches.get(id).status), ['cancelada', 'cancelada']);
      assert.equal(h2.tournaments.get(T1).cancelReason, 'lluvia');
      assert.match(await say(h2, `.torneo cancelar ${T1}`, P[1]), /está cancelado/);
      assert.match(await say(h2, `.torneo eliminar ${T1}`, P[1]), /eliminado/);
      assert.match(await say(h2, `.torneo info ${T1}`, P[1]), /No encontré/);
    } finally { h2.close(); }
  } finally { h.close(); }
});

test('torneo: programación persistente (cierre automático, recordatorio, inicio automático) con menciones reales', async () => {
  const h = await boot({ env: ENV });
  try {
    await mkTeams(h, 3);
    await openTournament(h);
    // 12:00 locales ahora; cierre 13:00, inicio 14:00
    assert.match(await say(h, `.torneo editar ${T1} cierre 13:00`, P[1]), /actualizado/);
    assert.match(await say(h, `.torneo editar ${T1} inicio 14:00`, P[1]), /actualizado/);
    const ids = () => h.scheduler.pending().filter((j) => j.type.startsWith('tournament.')).map((j) => j.type).sort();
    assert.deepEqual(ids(), ['tournament.close', 'tournament.remind', 'tournament.start']);
    // Reeditar la hora reprograma sin duplicar
    await say(h, `.torneo editar ${T1} inicio 15:00`, P[1]);
    assert.equal(ids().length, 3);
    await say(h, `.torneo editar ${T1} inicio 14:00`, P[1]);
    assert.equal(ids().length, 3);
    assert.deepEqual(h.tournaments.syncAll(), { created: 0, cancelled: 0 });
    for (let i = 1; i <= 3; i++) await say(h, `.torneo inscribir ${T1}`, cap(i));
    // 13:00 → se cierra la inscripción y se avisa a los capitanes
    h.clock.t = Date.parse('2026-10-05T18:00:30Z');
    await h.scheduler.runDue();
    const t = h.tournaments.get(T1);
    assert.equal(t.status, 'cerrado');
    const closeMsg = h.sent.find((s) => /Inscripción cerrada/.test(s.text));
    assert.ok(closeMsg && closeMsg.to === GROUP);
    assert.deepEqual(closeMsg.mentions.sort(), [cap(1), cap(2), cap(3)].sort());
    await say(h, `.torneo checkin ${T1}`, cap(1));
    await say(h, `.torneo checkin ${T1}`, cap(2));
    // 13:45 → recordatorio a quienes faltan
    h.clock.t = Date.parse('2026-10-05T18:46:00Z');
    await h.scheduler.runDue();
    const rem = h.sent.find((s) => /empieza en 15 minutos/.test(s.text));
    assert.ok(rem);
    assert.deepEqual(rem.mentions, [cap(3)], 'solo se menciona a quien falta');
    // 14:00 → inicio automático con los 2 equipos con check-in
    h.clock.t = Date.parse('2026-10-05T19:00:10Z');
    await h.scheduler.runDue();
    assert.equal(t.status, 'en_curso');
    assert.deepEqual(t.noShows, ['EQ-0003']);
    assert.match(h.sent[h.sent.length - 1].text, /comienza/);
    assert.equal(h.scheduler.pending().filter((j) => j.type.startsWith('tournament.')).length, 0);
    assert.equal(liveMatches(h).length, 1);
    // Los trabajos no se repiten
    await h.scheduler.runDue();
    assert.equal(h.sent.filter((s) => /comienza/.test(s.text)).length, 1);
  } finally { h.close(); }
});

test('torneo: sin equipos suficientes el inicio automático avisa y no empieza; falla de envío se reintenta', async () => {
  const h = await boot({ env: ENV });
  try {
    await mkTeams(h, 2);
    await openTournament(h);
    await say(h, `.torneo editar ${T1} inicio 14:00`, P[1]);
    await say(h, `.torneo inscribir ${T1}`, cap(1));
    await say(h, `.torneo inscribir ${T1}`, cap(2));
    await say(h, `.torneo checkin ${T1}`, cap(1));
    let failing = true;
    const real = h.wa.sendText;
    h.wa.sendText = async (...a) => { if (failing) throw new Error('sin conexión'); return real(...a); };
    h.clock.t = Date.parse('2026-10-05T19:00:10Z');
    await h.scheduler.runDue();
    assert.equal(h.tournaments.get(T1).status, 'inscripcion', 'no empezó');
    failing = false;
    h.clock.t += 20000;
    await h.scheduler.runDue();
    assert.match(h.sent[h.sent.length - 1].text, /no pudo empezar.*hay 1/);
    assert.equal(h.sent.filter((s) => /no pudo empezar/.test(s.text)).length, 1);
    assert.equal(h.tournaments.get(T1).status, 'inscripcion');
  } finally { h.close(); }
});

test('reinicio: torneo en curso, trabajos programados y cuadro persisten; el torneo continúa y termina', async () => {
  const h = await boot({ env: ENV });
  await readyTournament(h, 4, { prize: 50 });
  await say(h, `.torneo editar ${T1} inicio borrar`, P[1]).catch(() => {});
  await say(h, `.torneo iniciar ${T1}`, P[1]);
  const [m1] = liveMatches(h);
  await play(h, m1.matchId, 'host');
  h.db.close();
  const h2 = harness({ dir: h.dir, startAt: h.clock.t, env: ENV });
  try {
    const t = h2.tournaments.get(T1);
    assert.equal(t.status, 'en_curso');
    assert.equal(t.bracket.rounds[0].matches[0].winner, 'EQ-0001');
    assert.deepEqual(h2.tournaments.syncAll(), { created: 0, cancelled: 0 });
    const live = h2.tournaments.pendingMatches(t);
    assert.equal(live.length, 1);
    // Terminar el torneo tras el reinicio con el servicio (los capitanes reportan igual)
    const rep = (matchId, winnerSide) => {
      const m = h2.matches.get(matchId);
      const hc = h2.users.find([h2.teams.db.get('teams', m.host).captain]);
      const gc = h2.users.find([h2.teams.db.get('teams', m.guest).captain]);
      h2.matches.report(m, hc, winnerSide === 'host' ? 'win' : 'loss');
      h2.matches.report(m, gc, winnerSide === 'host' ? 'loss' : 'win');
    };
    rep(live[0].matchId, 'guest');
    const final = h2.tournaments.pendingMatches(t);
    assert.equal(final[0].name, 'Final');
    rep(final[0].matchId, 'host');
    assert.equal(t.status, 'finalizado');
    assert.equal(t.champion, 'EQ-0001');
    assert.equal(h2.users.find([cap(1)]).coins, 150);
    // Los ids de partida siguen siendo únicos
    assert.equal(new Set(h2.matches.all().map((m) => m.id)).size, h2.matches.all().length);
  } finally { h2.close(); }
});

test('torneo: comandos de consulta (lista, proximos, ronda) y subcomando desconocido', async () => {
  const h = await boot({ env: ENV });
  try {
    assert.match(await say(h, '.torneo', P[2]), /subcomandos/);
    assert.match(await say(h, '.torneo xyz', P[2]), /Subcomando desconocido/);
    assert.match(await say(h, '.torneo lista', P[2]), /No hay torneos activos/);
    assert.match(await say(h, '.torneo proximos', P[2]), /No hay torneos programados/);
    assert.match(await say(h, '.torneo ranking', P[2]), /Todavía no hay ranking/);
    assert.match(await say(h, '.torneo ganadores', P[2]), /Todavía no hay campeones/);
    assert.match(await say(h, '.torneo historial', P[2]), /Todavía no hay torneos finalizados/);
    await openTournament(h);
    await say(h, `.torneo editar ${T1} inicio 20:00`, P[1]);
    assert.match(await say(h, '.torneo lista', P[2]), /Copa Test \(TRN-001\) · 2v2 · 0\/8 · inscripcion/);
    assert.match(await say(h, '.torneo proximos', P[2]), /Copa Test.*2026-10-05 20:00/);
    assert.match(await say(h, '.torneo ronda TRN-001', P[2]), /todavía no tiene cuadro/);
    assert.match(await say(h, '.torneo bracket TRN-001', P[2]), /todavía no tiene cuadro/);
    assert.match(await say(h, '.torneo participantes TRN-001', P[2]), /todavía no tiene equipos/);
    assert.match(await say(h, '.torneo puntos TRN-001', P[2]), /Nadie tiene puntos/);
    assert.match(await say(h, '.torneo premios TRN-001', P[2]), /sin premio|no tiene premio/);
    assert.match(await say(h, '.torneo stats', P[2]), /No perteneces a ningún equipo/);
    assert.match(await say(h, '.torneo finalizar TRN-001', P[1]), /está inscripcion/);
  } finally { h.close(); }
});

// ---------- scrims ----------

async function scrimSetup(h) {
  await makeTeam(h, '2v2', 'Alfa', [P[2], P[3]]);
  await makeTeam(h, '2v2', 'Beta', [P[4], P[5]]);
}
const S1 = 'SCR-001';

test('.scrim crear/unirse/salir/equipos/lista/horario/info: validaciones y estados', async () => {
  const h = await boot({ env: ENV });
  try {
    await scrimSetup(h);
    await makeTeam(h, '2v2', 'Gamma', [P[6], P[7]]);
    await say(h, '.equipo crear 2v2 Solo', P[8]);
    assert.match(await say(h, '.scrim crear', P[2]), /Uso:/);
    assert.match(await say(h, '.scrim crear 25:99', P[2]), /HH:MM/);
    assert.match(await say(h, '.scrim crear 2020-01-01 10:00', P[2]), /ya pasó/);
    assert.match(await say(h, '.scrim crear 2027-12-01 10:00', P[2]), /más de 30 días/);
    assert.match(await say(h, '.scrim crear 20:00', P[8]), /debe estar completo/);
    assert.match(await say(h, '.scrim crear 20:00', P[3]), /Solo el capitán/);
    assert.match(await say(h, '.scrim crear 20:00', P[2]), /SCR-001.*2026-10-05 20:00/s);
    assert.match(await say(h, '.scrim crear 21:00', P[2]), /ya tiene un scrim sin terminar/);
    assert.match(await say(h, '.scrim horario SCR-001', P[5]), /faltan 8 h 0 min/);
    assert.match(await say(h, '.scrim lista', P[5]), /SCR-001 2v2.*Alfa \(busca rival\)/);
    assert.match(await say(h, '.scrim info SCR-001', P[5]), /ABIERTO[\s\S]*Rival: pendiente/);
    assert.match(await say(h, '.scrim unirse SCR-001', P[2]), /ya es el anfitrión/);
    assert.match(await say(h, '.scrim unirse SCR-001', P[4]), /Scrim SCR-001 completo: Alfa vs Beta/);
    assert.match(await say(h, '.scrim unirse SCR-001', P[6]), /está lleno/);
    assert.match(await say(h, '.scrim equipos SCR-001', P[1]), /Alfa.*Jugador2, Jugador3[\s\S]*Beta.*Jugador4, Jugador5/);
    assert.match(await say(h, '.scrim salir SCR-001', P[2]), /Solo el capitán o subcapitán del equipo rival/);
    assert.match(await say(h, '.scrim salir SCR-001', P[4]), /Vuelve a estar abierto|vuelve a estar abierto/i);
    assert.equal(h.scrims.get(S1).status, 'abierto');
    assert.match(await say(h, '.scrim info SCR-999', P[5]), /No encontré el scrim/);
    // Con scrim lleno la plantilla queda bloqueada
    await say(h, '.scrim unirse SCR-001', P[4]);
    assert.match(await say(h, '.equipo salir', P[3]), /tiene un scrim/);
    assert.match(await say(h, '.equipo disolver EQ-0002', P[4]), /tiene un scrim/);
  } finally { h.close(); }
});

test('.scrim checkin → partida real → resultado (coincidente, disputa, admin), ranking, estadísticas e historial', async () => {
  const h = await boot({ env: ENV, admins: [P[13]] });
  try {
    await scrimSetup(h);
    await say(h, '.scrim crear 20:00', P[2]);
    await say(h, '.scrim unirse SCR-001', P[4]);
    // 12:00; el check-in abre 30 min antes de las 20:00
    assert.match(await say(h, '.scrim checkin SCR-001', P[2]), /abre 30 minutos antes/);
    h.clock.t = Date.parse('2026-10-06T00:40:00Z'); // 19:40
    assert.match(await say(h, '.scrim checkin SCR-001', P[3]), /Solo el capitán/);
    assert.match(await say(h, '.scrim checkin SCR-001', P[2]), /Falta el otro equipo/);
    assert.match(await say(h, '.scrim checkin SCR-001', P[2]), /ya hizo check-in/);
    assert.match(await say(h, '.scrim resultado SCR-001 victoria', P[2]), /está lleno/);
    assert.match(await say(h, '.scrim checkin SCR-001', P[4]), /Check-in completo[\s\S]*P-0001/);
    const s = h.scrims.get(S1);
    assert.equal(s.status, 'en_curso');
    assert.equal(h.matches.get(s.matchId).status, 'iniciada');
    assert.equal(h.matches.get(s.matchId).context.type, 'scrim');
    assert.match(await say(h, '.scrim info SCR-001', P[5]), /EN CURSO[\s\S]*Partida: P-0001/);
    assert.match(await say(h, '.scrim resultado SCR-001 quizas', P[2]), /Uso:/);
    assert.match(await say(h, '.scrim resultado SCR-001 victoria', P[2]), /Falta el del otro capitán/);
    assert.match(await say(h, '.scrim resultado SCR-001 victoria', P[4]), /no coinciden/);
    assert.match(await say(h, '.scrim resolver SCR-001 A', P[2]), /No tienes permiso/);
    assert.match(await say(h, '.scrim resolver SCR-001 B', P[13]), /finalizado por un administrador/);
    assert.equal(s.status, 'finalizado');
    assert.equal(s.result.winner, 'guest');
    assert.match(await say(h, '.scrim ranking', P[5]), /1\. Beta — 3 pts · 1V 0E 0D[\s\S]*2\. Alfa — 0 pts/);
    assert.match(await say(h, '.scrim estadisticas EQ-0001', P[5]), /1 jugados · 0V 0E 1D · 0 pts/);
    assert.match(await say(h, '.scrim historial', P[5]), /SCR-001 Alfa vs Beta — ganó Beta/);
    assert.match(await say(h, '.scrim historial EQ-0002', P[5]), /ganó Beta/);
    // Segundo scrim con empate de común acuerdo
    h.clock.t = Date.parse('2026-10-06T01:00:00Z');
    await say(h, '.scrim crear 20:00', P[2]);
    await say(h, '.scrim unirse SCR-002', P[4]);
    h.clock.t = Date.parse('2026-10-07T00:45:00Z');
    await say(h, '.scrim checkin SCR-002', P[2]);
    await say(h, '.scrim checkin SCR-002', P[4]);
    await say(h, '.scrim resultado SCR-002 empate', P[2]);
    assert.match(await say(h, '.scrim resultado SCR-002 empate', P[4]), /Scrim SCR-002 finalizado: empate/);
    assert.deepEqual([h.scrims.teamStats('EQ-0001').points, h.scrims.teamStats('EQ-0002').points], [1, 4]);
    // Idempotencia: reprocesar el evento no suma dos veces
    h.scrims.onMatchFinished(h.matches.get('P-0002'));
    assert.equal(h.scrims.teamStats('EQ-0002').points, 4);
    assert.equal(h.scrims.teamStats('EQ-0002').played, 2);
  } finally { h.close(); }
});

test('.scrim cancelar y vencimiento; recordatorio con menciones; reinicio repone los trabajos', async () => {
  const h = await boot({ env: ENV, admins: [P[13]] });
  try {
    await scrimSetup(h);
    await say(h, '.scrim crear 20:00', P[2]);
    assert.match(await say(h, '.scrim cancelar SCR-001', P[4]), /Solo el capitán o subcapitán del anfitrión/);
    assert.deepEqual(h.scheduler.pending().filter((j) => j.type.startsWith('scrim.')).map((j) => j.type).sort(), ['scrim.expire', 'scrim.remind']);
    assert.match(await say(h, '.scrim cancelar SCR-001 sin rival', P[2]), /cancelado/);
    assert.equal(h.scheduler.pending().filter((j) => j.type.startsWith('scrim.')).length, 0);
    assert.match(await say(h, '.scrim cancelar SCR-001', P[2]), /está cancelado/);
    // Recordatorio
    await say(h, '.scrim crear 20:00', P[2]);
    await say(h, '.scrim unirse SCR-002', P[4]);
    h.clock.t = Date.parse('2026-10-06T00:46:00Z'); // 19:46
    await h.scheduler.runDue();
    const rem = h.sent.find((s) => /Scrim SCR-002.*empieza en 15 minutos/.test(s.text));
    assert.ok(rem);
    assert.deepEqual(rem.mentions.sort(), [P[2], P[4]].sort());
    await h.scheduler.runDue();
    assert.equal(h.sent.filter((s) => /empieza en 15 minutos/.test(s.text)).length, 1);
    // Reinicio: los trabajos siguen y syncAll no duplica
    h.db.close();
    const h2 = harness({ dir: h.dir, startAt: h.clock.t, env: ENV });
    try {
      assert.deepEqual(h2.scrims.syncAll(), { created: 0, cancelled: 0 });
      assert.equal(h2.scrims.get('SCR-002').status, 'lleno');
      // Vence 3 h después de la hora sin check-in: se cancela y se avisa
      h2.clock.t = Date.parse('2026-10-06T04:05:00Z');
      await h2.scheduler.start();
      assert.equal(h2.scrims.get('SCR-002').status, 'cancelado');
      assert.equal(h2.scrims.get('SCR-002').cancelReason, 'vencido sin terminar');
      assert.match(h2.sent[h2.sent.length - 1].text, /venció sin terminar/);
    } finally { h2.close(); }
    return;
  } finally { /* h ya cerrada arriba */ }
});

test('.scrim en curso: solo un administrador cancela y la partida asociada se cancela', async () => {
  const h = await boot({ env: ENV, admins: [P[13]] });
  try {
    await scrimSetup(h);
    await say(h, '.scrim crear 20:00', P[2]);
    await say(h, '.scrim unirse SCR-001', P[4]);
    h.clock.t = Date.parse('2026-10-06T00:40:00Z');
    await say(h, '.scrim checkin SCR-001', P[2]);
    await say(h, '.scrim checkin SCR-001', P[4]);
    assert.match(await say(h, '.scrim cancelar SCR-001', P[2]), /solo lo cancela un administrador/);
    assert.match(await say(h, '.scrim cancelar SCR-001 caída', P[13]), /cancelado/);
    assert.equal(h.matches.get('P-0001').status, 'cancelada');
    assert.equal(h.scrims.get(S1).status, 'cancelado');
    // Los equipos quedan libres
    assert.match(await say(h, '.scrim crear 21:00', P[2]), /SCR-002|ya pasó|creado/);
  } finally { h.close(); }
});
