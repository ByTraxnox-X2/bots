'use strict';

const { plain, ago, dateOnly } = require('../../utils/text');
const { formatNumber } = require('../../utils/validators');

const NO_CLAN_TEXT = '⚠️ *CLAN NO VERIFICADO*\nEste grupo no tiene un clan verificado.\nUn administrador puede usar:\n*.verificarclan IDCLAN*';

const roleText = (r) => (typeof r === 'number' ? `rol (código) ${r}` : plain(r));

/** Líneas del clan con SOLO los datos que existen (API real o configuración local). */
function clanLines(clan, { full = false } = {}) {
  const d = clan.snapshot?.data || {};
  const lines = [];
  lines.push(`⚔️ *${plain(clan.name || d.name || `Clan ${clan.id}`)}*`);
  lines.push(`🆔 ID: ${clan.id}`);
  const region = clan.region || d.region;
  if (region) lines.push(`🌎 Región: ${region.toUpperCase()}`);
  if (d.level !== undefined) lines.push(`⭐ Nivel del clan: ${formatNumber(d.level)}`);
  if (d.memberCount !== undefined) lines.push(`👥 Miembros: ${formatNumber(d.memberCount)}${d.capacity !== undefined ? `/${formatNumber(d.capacity)}` : ''}`);
  else if (d.capacity !== undefined) lines.push(`👥 Capacidad: ${formatNumber(d.capacity)}`);
  if (d.leader && (d.leader.nickname !== undefined || d.leader.uid !== undefined)) {
    lines.push(`👑 Líder: ${d.leader.nickname !== undefined ? plain(d.leader.nickname) : `UID ${d.leader.uid}`}`);
  }
  if (d.score !== undefined) lines.push(`🏆 Puntuación: ${formatNumber(d.score)}`);
  if (full && d.createdAt) lines.push(`📅 Creado: ${dateOnly(d.createdAt)}`);
  const desc = clan.description || d.description;
  if (desc) lines.push(`📝 ${plain(desc)}`);
  return lines;
}

function snapshotNote(clan, now = Date.now()) {
  if (!clan.snapshot?.fetchedAt) return null;
  return `_Datos de la API ${ago(now - Date.parse(clan.snapshot.fetchedAt))}_`;
}

module.exports = { clanLines, snapshotNote, roleText, NO_CLAN_TEXT };
