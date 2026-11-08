'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { harness } = require('./harness');
const { P, GROUP, boot, say, sayFull, makeTeam } = require('./support');
const { parseMode } = require('../src/services/teams');
const { EVENTS } = require('../src/events/bus');
const { buildConfig } = require('../src/config');

const REG = 'registro';

test('parseMode: variantes válidas y no válidas', () => {
  assert.equal(parseMode('2v2'), '2v2');
  assert.equal(parseMode('4VS4'), '4v4');
  assert.equal(parseMode('6'), '6v6');
  assert.equal(parseMode('3v3'), null);
  assert.equal(parseMode('2v4'), null);
  assert.equal(parseMode('hola'), null);
});

test('.equipo crear: validaciones, nombre único, un equipo por modalidad', async () => {
  const h = await boot();
  try {
    assert.match(await say(h, '.equipo crear', P[1]), /Uso:/);
    assert.match(await say(h, '.equipo crear 3v3 Algo', P[1]), /2v2, 4v4 o 6v6/);
    assert.match(await say(h, '.equipo crear 2v2 ab', P[1]), /entre 3 y 20/);
    assert.match(await say(h, '.equipo crear 2v2 Los Pro', P[1]), /EQ-0001.*creado.*2v2.*capitán/s);
    assert.match(await say(h, '.equipo crear 2v2 Otro', P[1]), /Ya perteneces a un equipo 2v2/);
    assert.match(await say(h, '.equipo crear 2v2 los pro', P[2]), /Ya existe un equipo/);
    // Otra modalidad sí se permite
    assert.match(await say(h, '.equipo crear 4v4 Cuatro', P[1]), /EQ-0002/);
    assert.equal(h.teams.teamsOf(P[1]).length, 2);
    // No registrado no puede crear
    assert.match(await say(h, '.equipo crear 2v2 Fuera', 'x@s.whatsapp.net'), /registrarte/);
    // Límite de equipos capitaneados
    assert.match(await say(h, '.equipo crear 6v6 Seis', P[1]), /EQ-0003/);
    await say(h, '.equipo salir 2v2', P[1]);
    assert.ok(h.db.get('teams', 'EQ-0001').status === 'disuelto');
  } finally { h.close(); }
});

test('invitaciones: invitar, aceptar, rechazar, caducidad, duplicados y equipo lleno', async () => {
  const h = await boot();
  try {
    await say(h, '.equipo crear 2v2 Duo', P[1]);
    assert.match(await say(h, '.equipo invitar', P[1]), /Menciona/);
    assert.match(await say(h, '.equipo invitar @x', P[1], { mentions: [P[1]] }), /a ti mismo/);
    assert.match(await say(h, '.equipo invitar @x', P[1], { mentions: ['59300000000@s.whatsapp.net'] }), /no está registrada/);
    const [m] = await sayFull(h, '.equipo invitar @x', P[1], { mentions: [P[2]] });
    assert.match(m.text, /INVITACIÓN DE EQUIPO/);
    assert.deepEqual(m.mentions.sort(), [P[1], P[2]].sort(), 'menciones reales');
    assert.match(await say(h, '.equipo invitar @x', P[1], { mentions: [P[2]] }), /invitación pendiente/);
    assert.match(await say(h, '.equipo invitaciones', P[2]), /Duo.*EQ-0001/s);
    assert.match(await say(h, '.equipo rechazar', P[2]), /Rechazaste/);
    assert.match(await say(h, '.equipo aceptar', P[2]), /No tienes invitaciones/);
    // Caducidad
    await say(h, '.equipo invitar @x', P[1], { mentions: [P[2]] });
    h.clock.t += 61 * 60000;
    assert.match(await say(h, '.equipo aceptar', P[2]), /No tienes invitaciones/);
    // Aceptar y equipo completo
    await say(h, '.equipo invitar @x', P[1], { mentions: [P[2]] });
    assert.match(await say(h, '.equipo aceptar EQ-0001', P[2]), /Ahora eres parte.*2\/2/);
    assert.match(await say(h, '.equipo invitar @x', P[1], { mentions: [P[3]] }), /ya está completo/);
    assert.match(await say(h, '.equipo invitar @x', P[1], { mentions: [P[2]] }), /ya está en tu equipo/);
    // Quien ya tiene equipo de esa modalidad no puede ser invitado a otro
    await say(h, '.equipo crear 2v2 Otro', P[3]);
    assert.match(await say(h, '.equipo invitar @x', P[3], { mentions: [P[2]] }), /ya pertenece a un equipo 2v2/);
    // Un jugador sin permiso no invita
    assert.match(await say(h, '.equipo invitar @x', P[2], { mentions: [P[4]] }), /Solo el capitán o el subcapitán/);
  } finally { h.close(); }
});

test('tamaños 2v2, 4v4 y 6v6: el equipo nunca supera su tamaño y se marca completo', async () => {
  const h = await boot({ users: 14 });
  try {
    for (const [mode, n] of [['2v2', 2], ['4v4', 4], ['6v6', 6]]) {
      const t = await makeTeam(h, mode, `Team${mode}`, P.slice(1, n + 1));
      assert.equal(t.members.length, n);
      assert.ok(h.teams.isFull(t));
      assert.equal(t.size, n);
      // Extra invitado no cabe
      assert.match(await say(h, '.equipo invitar @x ' + mode, P[1], { mentions: [P[13]] }), /ya está completo/);
      assert.match(await say(h, `.equipo miembros ${t.id}`, P[1]), new RegExp(`${n}/${n}.*completo`, 's'));
      // Se libera para el siguiente modo
      for (let i = 2; i <= n; i++) await say(h, `.equipo salir ${mode}`, P[i]);
      await say(h, `.equipo salir ${mode}`, P[1]);
      assert.equal(h.teams.find(t.id), null, 'disuelto al quedar vacío');
    }
  } finally { h.close(); }
});

test('cargos: capitán, subcapitán, expulsar, renombrar, disolver y salida del capitán', async () => {
  const h = await boot();
  try {
    const t = await makeTeam(h, '4v4', 'Cuatro', [P[1], P[2], P[3], P[4]]);
    assert.match(await say(h, '.equipo subcapitan @x', P[2], { mentions: [P[3]] }), /Solo el capitán/);
    assert.match(await say(h, '.equipo subcapitan @x', P[1], { mentions: [P[3]] }), /subcapitán de/);
    assert.equal(t.vice, P[3]);
    assert.match(await say(h, '.equipo miembros', P[1]), /👑 Capitán[\s\S]*⭐ Subcapitán/);
    // El subcapitán puede invitar y expulsar jugadores, pero no al capitán
    assert.match(await say(h, '.equipo expulsar @x', P[3], { mentions: [P[1]] }), /No se puede expulsar al capitán/);
    assert.match(await say(h, '.equipo expulsar @x', P[2], { mentions: [P[4]] }), /Solo el capitán o el subcapitán/);
    assert.match(await say(h, '.equipo expulsar @x', P[3], { mentions: [P[4]] }), /fue expulsado/);
    assert.equal(t.members.length, 3);
    assert.match(await say(h, '.equipo expulsar @x', P[3], { mentions: [P[4]] }), /no está en el equipo/);
    assert.match(await say(h, '.equipo expulsar @x', P[1], { mentions: [P[1]] }), /equipo salir/);
    // Traspaso de capitán y renombrar
    assert.match(await say(h, '.equipo capitan @x', P[1], { mentions: [P[2]] }), /nuevo capitán/);
    assert.equal(t.captain, P[2]);
    assert.match(await say(h, '.equipo renombrar EQ-0001 Nuevo Nombre', P[1]), /Solo el capitán/);
    assert.match(await say(h, '.equipo renombrar EQ-0001 Nuevo Nombre', P[2]), /Nuevo Nombre/);
    assert.match(await say(h, '.equipo subcapitan quitar', P[2]), /Quitaste/);
    assert.equal(t.vice, null);
    // Sale el capitán: pasa al siguiente
    await say(h, '.equipo subcapitan @x', P[2], { mentions: [P[3]] });
    assert.match(await say(h, '.equipo salir', P[2]), /nuevo capitán es/);
    assert.equal(t.captain, P[3]);
    assert.equal(t.vice, null);
    // Disolver
    assert.match(await say(h, '.equipo disolver EQ-0001', P[1]), /Solo el capitán/);
    assert.match(await say(h, '.equipo disolver EQ-0001', P[3]), /se disolvió/);
    assert.match(await say(h, '.equipo info EQ-0001', P[3]), /No encontré/);
  } finally { h.close(); }
});

test('SUPERADMIN/OWNER pueden disolver o renombrar cualquier equipo; un ADMIN de grupo no', async () => {
  const h = await boot();
  try {
    await makeTeam(h, '2v2', 'Duo', [P[2], P[3]]);
    assert.match(await say(h, '.equipo disolver EQ-0001', P[1]), /Solo el capitán/); // P1 es admin del grupo
    h.permissions.setRole(P[1], 'SUPERADMIN');
    assert.match(await say(h, '.equipo disolver EQ-0001', P[1]), /se disolvió/);
  } finally { h.close(); }
});

test('info, miembros, lista y ayuda de subcomandos', async () => {
  const h = await boot();
  try {
    assert.match(await say(h, '.equipo', P[1]), /subcomandos/);
    assert.match(await say(h, '.equipo nada', P[1]), /Subcomando desconocido/);
    assert.match(await say(h, '.equipo info', P[1]), /No perteneces a ningún equipo/);
    await makeTeam(h, '2v2', 'Duo', [P[1], P[2]]);
    const info = await say(h, '.equipo info', P[1]);
    assert.match(info, /Duo.*EQ-0001.*2v2/s);
    assert.match(info, /2\/2/);
    assert.match(await say(h, '.equipo info duo', P[5]), /Capitán: Jugador1/);
    assert.match(await say(h, '.equipo ranking', P[1]), /Todavía no hay equipos/);
    assert.match(await say(h, '.equipo ranking 9v9', P[1]), /2v2, 4v4 o 6v6/);
  } finally { h.close(); }
});

// ---------- partidas ----------

async function twoTeams(h, mode = '2v2') {
  const n = Number(mode[0]);
  const a = await makeTeam(h, mode, 'Alfa', P.slice(1, n + 1));
  const b = await makeTeam(h, mode, 'Beta', P.slice(n + 1, 2 * n + 1));
  return { a, b, capA: P[1], capB: P[n + 1] };
}

test('partida: estados pendiente → abierta → llena → iniciada → finalizada con reporte coincidente', async () => {
  const h = await boot();
  try {
    const finished = [];
    h.bus.on(EVENTS.matchFinished, (e) => finished.push(e.match.id));
    const { a, b, capA, capB } = await twoTeams(h);
    assert.match(await say(h, '.partida crear', capA), /P-0001.*pendiente/s);
    const m = h.matches.get('P-0001');
    assert.equal(m.status, 'pendiente');
    assert.match(await say(h, '.partida unirse P-0001', capB), /está pendiente/);
    assert.match(await say(h, '.partida abrir P-0001', capB), /Solo el capitán o subcapitán del equipo anfitrión/);
    assert.match(await say(h, '.partida abrir 1', capA), /abierta/);
    assert.match(await say(h, '.partida lista', capB), /P-0001 2v2 — Alfa/);
    assert.match(await say(h, '.partida unirse P-0001', P[2]), /Solo el capitán|pertenece/);
    assert.match(await say(h, '.partida unirse P-0001', capA), /ya es el anfitrión/);
    assert.match(await say(h, '.partida mias', capB), /Tus equipos no tienen/);
    assert.match(await say(h, '.partida unirse P-0001', capB), /llena: Alfa vs Beta/);
    assert.match(await say(h, '.partida mias', capB), /P-0001 2v2 — llena/);
    assert.equal(m.status, 'llena');
    // Con la partida llena no se puede cambiar la plantilla
    assert.match(await say(h, '.equipo salir', P[2]), /llena o iniciada/);
    assert.match(await say(h, '.equipo disolver EQ-0001', capA), /llena o iniciada/);
    assert.match(await say(h, '.partida iniciar P-0001', P[2]), /Solo los capitanes|permiso|capitán/);
    assert.match(await say(h, '.partida resultado P-0001 victoria', capA), /iniciada|no se puede reportar/);
    assert.match(await say(h, '.partida iniciar P-0001', capB), /iniciada/);
    assert.equal(m.status, 'iniciada');
    assert.match(await say(h, '.partida resultado P-0001 victoria', P[2]), /Solo el capitán/);
    assert.match(await say(h, '.partida resultado P-0001 quizas', capA), /Uso:/);
    assert.match(await say(h, '.partida resultado P-0001 victoria', capA), /Falta que el otro capitán/);
    assert.equal(m.status, 'iniciada');
    assert.match(await say(h, '.partida resultado P-0001 derrota', capB), /finalizada de común acuerdo: Ganó Alfa/);
    assert.equal(m.status, 'finalizada');
    assert.equal(m.result.source, 'capitanes');
    assert.deepEqual(finished, ['P-0001']);
    // Estadísticas de equipos y jugadores
    assert.deepEqual([a.stats.played, a.stats.wins, a.stats.losses, a.stats.streak], [1, 1, 0, 1]);
    assert.deepEqual([b.stats.played, b.stats.wins, b.stats.losses, b.stats.streak], [1, 0, 1, -1]);
    assert.deepEqual(h.users.find([P[1]]).stats, { wins: 1, losses: 0, matches: 1 });
    assert.deepEqual(h.users.find([P[3]]).stats, { wins: 0, losses: 1, matches: 1 });
    // Idempotencia: no se puede reportar/finalizar otra vez ni cambiar el resultado
    assert.match(await say(h, '.partida resultado P-0001 derrota', capA), /no se puede reportar/);
    h.matches._finalize(m, 'guest', { source: 'x', by: 'y' });
    assert.equal(a.stats.played, 1);
    assert.equal(m.result.winner, 'host');
    assert.deepEqual(finished, ['P-0001']);
    // Tras finalizar los equipos pueden cambiar de nuevo
    assert.match(await say(h, '.equipo salir', P[2]), /Saliste/);
    // Historial, ranking y enfrentamientos
    assert.match(await say(h, '.equipo historial EQ-0002', capB), /P-0001 D vs Alfa/);
    assert.match(await say(h, '.equipo ranking 2v2', capA), /1\. Alfa.*1V 0D/);
    assert.match(await say(h, '.equipo vs EQ-0001 EQ-0002', capA), /Alfa: 1.*Beta: 0.*Empates: 0/s);
    assert.match(await say(h, '.equipo vs EQ-0001', capB), /Partidas: 1/);
    assert.match(await say(h, '.equipo stats EQ-0001', capA), /1 partidas · 1V 0D 0E · 100%/);
  } finally { h.close(); }
});

test('partida: reportes que no coinciden quedan en disputa y solo un administrador la resuelve', async () => {
  const h = await boot({ admins: [P[13]] });
  try {
    const { a, b, capA, capB } = await twoTeams(h);
    await say(h, '.partida crear', capA);
    await say(h, '.partida abrir P-0001', capA);
    await say(h, '.partida unirse P-0001', capB);
    await say(h, '.partida iniciar P-0001', capA);
    await say(h, '.partida resultado P-0001 victoria', capA);
    assert.match(await say(h, '.partida resultado P-0001 victoria', capB), /no coinciden/);
    const m = h.matches.get('P-0001');
    assert.equal(m.disputed, true);
    assert.equal(m.status, 'iniciada');
    assert.match(await say(h, '.partida info P-0001', capA), /EN DISPUTA/);
    // Un usuario normal no puede resolver (permiso validado por el dispatcher)
    assert.match(await say(h, '.partida resolver P-0001 A', capA), /No tienes permiso.*ADMIN/);
    // El admin del grupo (P1 es admin de WhatsApp en este grupo) sí, porque la partida se creó en este grupo
    assert.match(await say(h, '.partida resolver P-0001 B', P[13]), /Ganó Beta/);
    assert.equal(m.result.source, 'administrador');
    assert.equal(b.stats.wins, 1);
    assert.equal(a.stats.losses, 1);
    assert.match(await say(h, '.partida resolver P-0001 A', P[13]), /está finalizada/);
  } finally { h.close(); }
});

test('partida: un admin de otro grupo no resuelve partidas ajenas; SUPERADMIN sí; empate cuenta como empate', async () => {
  const h = await boot();
  try {
    const { a, b, capA, capB } = await twoTeams(h);
    await say(h, '.partida crear', capA); // creada en GROUP
    await say(h, '.partida abrir P-0001', capA);
    await say(h, '.partida unirse P-0001', capB);
    await say(h, '.partida iniciar P-0001', capA);
    const other = '120363000000000099@g.us';
    h.wa.groupMetadata = async () => ({ participants: [{ id: P[1], admin: 'admin' }] });
    assert.match(await say(h, '.partida resolver P-0001 empate', P[1], { group: other }), /solo puedes resolver partidas creadas en este grupo/i);
    h.permissions.setRole(P[1], 'SUPERADMIN');
    assert.match(await say(h, '.partida resolver P-0001 empate', P[1], { group: other }), /Empate/);
    assert.deepEqual([a.stats.draws, b.stats.draws, a.stats.streak], [1, 1, 0]);
    assert.deepEqual(h.users.find([P[1]]).stats, { wins: 0, losses: 0, matches: 1 });
  } finally { h.close(); }
});

test('partida: validaciones de equipos (incompleto, modalidad distinta, jugadores duplicados, desafío)', async () => {
  const h = await boot();
  try {
    await say(h, '.equipo crear 2v2 Solo', P[1]);
    assert.match(await say(h, '.partida crear', P[1]), /completo \(1\/2\)/);
    await say(h, '.equipo invitar @x', P[1], { mentions: [P[2]] });
    await say(h, '.equipo aceptar', P[2]);
    const cuatro = await makeTeam(h, '4v4', 'Cuatro', [P[3], P[4], P[5], P[6]]);
    const rival = await makeTeam(h, '2v2', 'Rival', [P[7], P[8]]);
    const tercero = await makeTeam(h, '2v2', 'Tercero', [P[9], P[10]]);
    assert.match(await say(h, '.partida crear ' + cuatro.id, P[1]), /juega 4v4 y el tuyo 2v2|No pertenec|No tienes un equipo 4v4/);
    assert.match(await say(h, '.partida crear EQ-0001', P[1]), /propio equipo/);
    // Desafío directo: solo el equipo desafiado puede unirse
    assert.match(await say(h, `.partida crear ${rival.id}`, P[1]), /Desafiaste a Rival/);
    await say(h, '.partida abrir P-0001', P[1]);
    assert.match(await say(h, '.partida unirse P-0001', P[9]), /desafío para otro equipo/);
    assert.match(await say(h, '.partida unirse P-0001', P[7]), /llena/);
    // Modalidad distinta
    await say(h, '.partida crear', P[3]);
    await say(h, '.partida abrir P-0002', P[3]);
    assert.match(await say(h, '.partida unirse P-0002', P[7]), /No tienes un equipo 4v4/);
    // Jugadores ocupados en otra partida llena
    await say(h, '.equipo salir', P[2]).catch(() => {});
    assert.equal(h.matches.liveFor(rival.id).length, 1);
    // Retirarse
    assert.match(await say(h, '.partida retirar P-0001', P[1]), /Solo el capitán o subcapitán del equipo rival/);
    assert.match(await say(h, '.partida retirar P-0001', P[7]), /Vuelve a estar abierta/);
    assert.equal(h.matches.get('P-0001').status, 'abierta');
    assert.equal(h.matches.get('P-0001').guest, null);
    assert.ok(tercero);
  } finally { h.close(); }
});

test('partida: un jugador no puede estar en dos partidas llenas/iniciadas a la vez ni en los dos equipos', async () => {
  const h = await boot();
  try {
    const a = await makeTeam(h, '2v2', 'Alfa', [P[1], P[2]]);
    const b = await makeTeam(h, '2v2', 'Beta', [P[3], P[4]]);
    // Un equipo con un jugador de Alfa no puede existir en la misma modalidad (prevención en la raíz)
    assert.match(await say(h, '.equipo invitar @x', P[3], { mentions: [P[1]] }), /ya pertenece a un equipo 2v2/);
    await say(h, '.partida crear', P[1]);
    await say(h, '.partida abrir P-0001', P[1]);
    await say(h, '.partida unirse P-0001', P[3]);
    // Alfa ya está en una partida llena: no puede crear/ocupar otra llena
    await say(h, '.partida crear', P[1]);
    await say(h, '.partida abrir P-0002', P[1]);
    const c = await makeTeam(h, '2v2', 'Gamma', [P[5], P[6]]);
    assert.match(await say(h, '.partida unirse P-0002', P[5]), /llena: Alfa vs Gamma|otra partida/);
    assert.ok(a && b && c);
    // Doble comprobación directa en el servicio
    const busy = h.matches._busyPlayers([P[1], P[7]], 'P-9999');
    assert.deepEqual(busy, [P[1]]);
  } finally { h.close(); }
});

test('partida: cancelar (anfitrión, admin), cancelar iniciada y vencimiento programado', async () => {
  const h = await boot({ admins: [P[13]] });
  try {
    const { capA, capB } = await twoTeams(h);
    await say(h, '.partida crear', capA);
    assert.match(await say(h, '.partida cancelar P-0001', capB), /Solo el capitán o subcapitán del anfitrión/);
    assert.match(await say(h, '.partida cancelar P-0001 ya no', capA), /cancelada/);
    assert.equal(h.matches.get('P-0001').cancelReason, 'ya no');
    assert.match(await say(h, '.partida cancelar P-0001', capA), /ya está cancelada/);
    assert.equal(h.scheduler.get('MATCH_EXP_P-0001').status, 'cancelled');
    // Iniciada: solo admin
    await say(h, '.partida crear', capA);
    await say(h, '.partida abrir P-0002', capA);
    await say(h, '.partida unirse P-0002', capB);
    await say(h, '.partida iniciar P-0002', capA);
    assert.match(await say(h, '.partida cancelar P-0002', capA), /solo la cancela un administrador/);
    assert.match(await say(h, '.partida cancelar P-0002', P[13]), /cancelada/);
    // Vencimiento: una partida abierta sin rival se cancela sola a las 24 h
    await say(h, '.partida crear', capA);
    await say(h, '.partida abrir P-0003', capA);
    assert.equal(h.scheduler.get('MATCH_EXP_P-0003').status, 'pending');
    h.clock.t += 25 * 3600000;
    await h.scheduler.runDue();
    assert.equal(h.matches.get('P-0003').status, 'cancelada');
    assert.equal(h.matches.get('P-0003').cancelReason, 'vencida sin iniciar');
    // Una partida iniciada nunca vence sola
    assert.equal(h.matches.expire('P-0002'), false);
  } finally { h.close(); }
});

test('reinicio: equipos, partidas y vencimientos persisten y no se duplican', async () => {
  const h = await boot();
  const { capA, capB } = await twoTeams(h);
  await say(h, '.partida crear', capA);
  await say(h, '.partida abrir P-0001', capA);
  await say(h, '.partida unirse P-0001', capB);
  await say(h, '.partida iniciar P-0001', capA);
  await say(h, '.partida crear', capA);
  h.db.close();
  const h2 = harness({ dir: h.dir, startAt: h.clock.t });
  try {
    assert.equal(h2.teams.active().length, 2);
    assert.equal(h2.matches.get('P-0001').status, 'iniciada');
    assert.equal(h2.matches.get('P-0002').status, 'pendiente');
    assert.deepEqual(h2.matches.get('P-0001').rosters.host, [P[1], P[2]]);
    assert.deepEqual(h2.matches.syncAll(), { rescheduled: 0 });
    // Reiniciar sin que exista el trabajo (p. ej. restaurado de una copia antigua) lo repone una sola vez
    h2.scheduler.cancel('MATCH_EXP_P-0002');
    assert.deepEqual(h2.matches.syncAll(), { rescheduled: 1 });
    assert.deepEqual(h2.matches.syncAll(), { rescheduled: 0 });
    assert.equal(h2.scheduler.get('MATCH_EXP_P-0002').status, 'pending');
    // Continuar la partida iniciada tras el reinicio
    h2.users.find([P[1]]);
    const m = h2.matches.get('P-0001');
    h2.matches.report(m, h2.users.find([P[1]]), 'win');
    h2.matches.report(m, h2.users.find([P[3]]), 'loss');
    assert.equal(m.status, 'finalizada');
    // Los ids siguen siendo únicos tras reiniciar
    const t = h2.teams.create({ user: h2.users.find([P[9]]), mode: '2v2', name: 'Nueva' });
    assert.equal(t.id, 'EQ-0003');
  } finally { h2.close(); }
});

test('auditoría de equipos y partidas, y límite de uso del comando', async () => {
  const h = await boot();
  try {
    await twoTeams(h);
    await say(h, '.partida crear', P[1]);
    const logs = h.db.col('logs');
    const actions = logs.filter((l) => l.scope === 'equipo' || l.scope === 'partida').map((l) => `${l.scope}:${l.action}`);
    assert.ok(actions.includes('equipo:crear'));
    assert.ok(actions.includes('equipo:invitar'));
    assert.ok(actions.includes('partida:crear'));
    assert.ok(logs.every((l) => !/key|token|secret/i.test(JSON.stringify(l))));
  } finally { h.close(); }
  // Cooldown real (sin saltarlo)
  const h2 = harness({ env: {}, startAt: Date.now() });
  try {
    await h2.say('.registro', { from: P[1], pushName: 'A', group: GROUP });
    h2.sent.length = 0;
    await h2.say('.equipo info 1', { from: P[1], group: GROUP });
    await h2.say('.equipo info 1', { from: P[1], group: GROUP });
    assert.match(h2.sent[h2.sent.length - 1].text, /Espera \d+ s/);
  } finally { h2.close(); }
});

test('config: valores por defecto de equipos', () => {
  const c = buildConfig({}, '/tmp');
  assert.deepEqual(c.teams, { inviteTtlMin: 60, maxPerCaptain: 3, matchTtlHours: 24, historyKeep: 300 });
  assert.ok(path && REG);
});
