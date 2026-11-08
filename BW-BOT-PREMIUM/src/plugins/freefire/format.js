'use strict';

const { plain } = require('../../utils/text');
const { formatNumber } = require('../../utils/validators');
const { dateOnly } = require('../../utils/text');

const rankLine = (label, value) => (typeof value === 'number' ? `${label} (código): ${value}` : `${label}: ${plain(value)}`);

/**
 * Líneas de texto de un jugador de Free Fire. SOLO se muestran los campos que la API entregó:
 * nunca se escribe "N/D", "0" ni valores de relleno.
 */
function playerLines(data, { full = false } = {}) {
  const lines = [];
  const add = (label, value) => {
    if (value !== undefined && value !== null && value !== '') lines.push(`${label}: ${value}`);
  };
  add('👤 Nick', data.nickname !== undefined ? plain(data.nickname) : undefined);
  add('🆔 UID', data.uid);
  add('🌎 Región', data.region ? data.region.toUpperCase() : undefined);
  add('⭐ Nivel', data.level !== undefined ? formatNumber(data.level) : undefined);
  if (full) add('✨ EXP', data.exp !== undefined ? formatNumber(data.exp) : undefined);
  add('❤️ Likes', data.likes !== undefined ? formatNumber(data.likes) : undefined);
  if (data.rank !== undefined) lines.push(`🏆 ${rankLine('Rango BR', data.rank)}`);
  if (full && data.rankPoints !== undefined) lines.push(`📈 Puntos BR: ${formatNumber(data.rankPoints)}`);
  if (full && data.csRank !== undefined) lines.push(`🏅 ${rankLine('Rango CS', data.csRank)}`);
  if (full && data.csRankPoints !== undefined) lines.push(`📈 Puntos CS: ${formatNumber(data.csRankPoints)}`);

  if (data.clanName !== undefined || data.clanId !== undefined) {
    const parts = [];
    if (data.clanName !== undefined) parts.push(plain(data.clanName));
    if (data.clanId !== undefined) parts.push(`ID ${data.clanId}`);
    lines.push(`🛡️ Clan: ${parts.join(' · ')}`);
    if (full) {
      if (data.clanLevel !== undefined) lines.push(`   Nivel del clan: ${formatNumber(data.clanLevel)}`);
      if (data.clanMembers !== undefined) {
        lines.push(`   Miembros: ${formatNumber(data.clanMembers)}${data.clanCapacity !== undefined ? `/${formatNumber(data.clanCapacity)}` : ''}`);
      }
    }
  }
  if (full) {
    if (data.bio !== undefined) lines.push(`💬 Bio: ${plain(data.bio)}`);
    if (data.createdAt) lines.push(`📅 Cuenta creada: ${dateOnly(data.createdAt)}`);
    if (data.lastLogin) lines.push(`🕒 Último login: ${dateOnly(data.lastLogin)}`);
    if (data.avatarUrl) lines.push(`🖼️ Avatar: ${data.avatarUrl}`);
    else if (data.avatarId !== undefined) lines.push(`🖼️ Avatar (ID): ${data.avatarId}`);
    if (data.bannerUrl) lines.push(`🎌 Banner: ${data.bannerUrl}`);
    else if (data.bannerId !== undefined) lines.push(`🎌 Banner (ID): ${data.bannerId}`);
  }
  return lines;
}

module.exports = { playerLines };
