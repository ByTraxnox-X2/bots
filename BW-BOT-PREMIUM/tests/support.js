'use strict';

// Utilidades compartidas por los tests de las fases 5-9.
const { harness } = require('./harness');

const GROUP = '120363000000000001@g.us';
const GROUP2 = '120363000000000002@g.us';
const OWNER = '593990192338@s.whatsapp.net';
const jidOf = (n) => `59399${String(1000000 + n).padStart(7, '0')}@s.whatsapp.net`;
/** P[1]..P[n]: jugadores de prueba. P[1] es admin del grupo de WhatsApp. */
const P = Array.from({ length: 41 }, (_, i) => jidOf(i));
const nameOf = (n) => `Jugador${n}`;

/** Stack completo con `n` usuarios registrados. */
async function boot({ users = 14, admins = [P[1]], env = {}, startAt = Date.parse('2026-10-05T17:00:00Z'), harness: extra = {} } = {}) {
  const participants = P.slice(1, users + 1).map((id) => ({ id, admin: admins.includes(id) ? 'admin' : null }));
  const h = harness({
    gdc: true,
    startAt,
    groupAdmins: participants,
    env: { RATE_LIMIT_USER_MAX: '100000', RATE_LIMIT_GROUP_MAX: '100000', ...env },
    ...extra,
  });
  for (let i = 1; i <= users; i++) await h.say('.registro', { from: P[i], pushName: nameOf(i), id: `reg-${i}` });
  h.sent.length = 0;
  return h;
}

/** Ejecuta un comando como `from` saltándose el cooldown y devuelve el texto enviado como respuesta. */
async function say(h, text, from = P[1], opts = {}) {
  const cmd = text.trim().split(/\s+/)[0].slice(1).toLowerCase();
  const def = h.services.registry.get(cmd);
  h.d.limiter.limiter.clear(`c:${from}:${def ? def.name : cmd}`);
  h.d.denyLimiter.clear(`d:${from}`);
  const n = h.sent.length;
  await h.say(text, { group: GROUP, from, pushName: nameOf(P.indexOf(from)), ...opts });
  return h.sent.slice(n).map((s) => s.text).join('\n');
}

/** Igual que say pero devuelve los mensajes completos (con menciones). */
async function sayFull(h, text, from = P[1], opts = {}) {
  const n = h.sent.length;
  await say(h, text, from, opts);
  return h.sent.slice(n);
}

/** Crea un equipo y lo completa con invitaciones aceptadas. members[0] es el capitán. */
async function makeTeam(h, mode, name, members) {
  const size = Number(mode[0]);
  const [cap, ...rest] = members.slice(0, size);
  await say(h, `.equipo crear ${mode} ${name}`, cap);
  for (const m of rest) {
    await say(h, `.equipo invitar @x ${mode}`, cap, { mentions: [m] });
    await say(h, '.equipo aceptar', m);
  }
  return h.teams.find(name);
}

const sentTo = (h, re) => h.sent.filter((s) => re.test(s.text));

module.exports = { GROUP, GROUP2, OWNER, P, jidOf, nameOf, boot, say, sayFull, makeTeam, sentTo };
