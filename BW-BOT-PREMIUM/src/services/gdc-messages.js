'use strict';

const jid = require('../whatsapp/jid');
const { plain } = require('../utils/text');

const SQUAD_SIZE = 4;

const NO_CLAN_GDC_TEXT = '⚠️ Este grupo no tiene un clan verificado.\n\nUn administrador puede usar:\n*.verificarclan IDCLAN*';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const platesLine = (plates) => `🏷️ Placas obligatorias: ${plates === null || plates === undefined ? 'sin definir' : plates}`;

/** El honor solo se menciona si el clan lo activó (si está desactivado no se muestra como requisito). */
function honorLine(cfg) {
  if (!cfg.honorEnabled) return null;
  return cfg.honorRequired > 0 ? `⭐ Honor requerido: ${cfg.honorRequired}` : '⭐ Honor: activado (sin valor requerido definido)';
}

/** "@123" para cada JID real; la lista de menciones del mensaje debe ser exactamente estos JIDs. */
function mentionText(jids) {
  return jids.map((j) => jid.mentionTag(j)).join(' ');
}

function squadCounts(squads) {
  const list = Object.values(squads);
  return { total: list.length, complete: list.filter((s) => s.members.length >= SQUAD_SIZE).length };
}

function reminderText({ clan, doc, mentions }) {
  const cfg = clan.config;
  const counts = squadCounts(doc.squads);
  const lines = [`⚔️ *GDC EN ${cfg.reminderMinutes === 1 ? '1 MINUTO' : `${cfg.reminderMinutes} MINUTOS`}*`, ''];
  lines.push(`🕖 Inicio: ${cfg.gdcTime}`);
  lines.push(platesLine(doc.platesRequired));
  const honor = honorLine(cfg);
  if (honor) lines.push(honor);
  lines.push(`👥 Formen sus escuadras de ${SQUAD_SIZE} jugadores.`);
  lines.push('🎮 Entren a Free Fire y prepárense.');
  if (counts.total > 0) lines.push('', `📋 Escuadras registradas: ${counts.total} (${plural(counts.complete, 'completa', 'completas')})`);
  if (mentions.length) lines.push('', mentionText(mentions));
  return lines.join('\n');
}

function startText({ clan, doc, mentions }) {
  const cfg = clan.config;
  const counts = squadCounts(doc.squads);
  const lines = ['⚔️ *GDC INICIADA*', ''];
  lines.push(platesLine(doc.platesRequired));
  const honor = honorLine(cfg);
  if (honor) lines.push(honor);
  lines.push(`👥 Escuadras registradas: ${counts.total}${counts.total ? ` (${plural(counts.complete, 'completa', 'completas')})` : ''}`);
  lines.push('', '🔥 La GDC ha comenzado. ¡Mucha suerte a todos!');
  if (mentions.length) lines.push('', mentionText(mentions));
  return lines.join('\n');
}

/** Línea de una persona en una escuadra: nombre del bot y, si hay ficha de Free Fire guardada, su nick real. */
function memberLabel(user, jidValue) {
  if (!user) return jid.mentionTag(jidValue);
  const nick = user.ffSnapshot?.data?.nickname;
  const name = plain(user.name);
  return nick && plain(nick) !== name ? `${name} (FF: ${plain(nick)})` : name;
}

function squadText(squad, resolveUser) {
  const full = squad.members.length >= SQUAD_SIZE;
  const lines = [`⚔️ *Escuadra #${squad.number}* — ${squad.members.length}/${SQUAD_SIZE}`];
  squad.members.forEach((m) => lines.push(`${m === squad.captain ? '👑' : '👤'} ${memberLabel(resolveUser(m), m)}`));
  for (let i = squad.members.length; i < SQUAD_SIZE; i++) lines.push('⬜ libre');
  lines.push(full ? '✅ ESCUADRA COMPLETA' : squad.open ? '🔓 Abierta: *.gdc unirse ' + squad.number + '*' : '🔒 Cerrada: solo por invitación');
  return lines.join('\n');
}

module.exports = { SQUAD_SIZE, NO_CLAN_GDC_TEXT, reminderText, startText, squadText, platesLine, honorLine, mentionText, squadCounts, memberLabel, plural };
