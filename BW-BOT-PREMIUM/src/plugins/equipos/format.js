'use strict';

const { plain } = require('../../utils/text');
const { STATUS } = require('../../services/matches');

const STATUS_ICON = { pendiente: '🕒', abierta: '🟢', llena: '🔒', iniciada: '▶️', finalizada: '🏁', cancelada: '❌' };

function teamHeader(t) {
  return `🛡️ *${plain(t.name)}* (${t.id}) · ${t.mode}`;
}

function roleOf(team, j) {
  return team.captain === j ? '👑 Capitán' : team.vice === j ? '⭐ Subcapitán' : 'Jugador';
}

function memberLines(team, users) {
  return team.members.map((j) => `• ${plain(users.find([j])?.name || j.split('@')[0])} — ${roleOf(team, j)}`);
}

function statsLine(team, teams) {
  const s = team.stats;
  const streak = s.streak > 0 ? ` · racha ${s.streak}V` : s.streak < 0 ? ` · racha ${-s.streak}D` : '';
  return `📊 ${s.played} partidas · ${s.wins}V ${s.losses}D ${s.draws}E · ${teams.winRate(team)}% victorias${streak}`;
}

function teamInfo(team, { users, teams }) {
  const lines = [teamHeader(team), `👥 Miembros: ${team.members.length}/${team.size}${teams.isFull(team) ? ' (completo)' : ''}`];
  lines.push(`👑 Capitán: ${plain(users.find([team.captain])?.name || team.captain)}`);
  if (team.vice) lines.push(`⭐ Subcapitán: ${plain(users.find([team.vice])?.name || team.vice)}`);
  lines.push(statsLine(team, teams));
  lines.push(`📅 Creado: ${team.createdAt.slice(0, 10)}`);
  return lines.join('\n');
}

function winnerName(m, teams) {
  if (!m.result) return null;
  if (m.result.winner === 'draw') return 'Empate';
  const t = teams.db.get('teams', m.result.winner === 'host' ? m.host : m.guest);
  return `Ganó ${plain(t?.name || '?')}`;
}

function matchInfo(m, { teams }) {
  const h = teams.db.get('teams', m.host);
  const g = m.guest ? teams.db.get('teams', m.guest) : null;
  const lines = [`${STATUS_ICON[m.status] || '•'} *Partida ${m.id}* · ${m.mode} · ${m.status.toUpperCase()}`, `🛡️ ${plain(h?.name || m.host)} (${m.host})`];
  lines.push(g ? `⚔️ ${plain(g.name)} (${g.id})` : m.challenged ? `⚔️ Desafío para ${m.challenged}` : '⚔️ Rival: pendiente');
  if (m.context) lines.push(`🏆 ${m.context.type === 'torneo' ? 'Torneo' : 'Scrim'} ${m.context.id}${m.context.round ? ` · ronda ${m.context.round}` : ''}`);
  if (m.status === STATUS.STARTED) {
    lines.push(`🧾 Reportes: anfitrión ${m.reports.host ? 'sí' : 'no'} · rival ${m.reports.guest ? 'sí' : 'no'}${m.disputed ? ' · ⚠️ EN DISPUTA (un administrador debe resolver)' : ''}`);
  }
  if (m.result) lines.push(`🏁 ${winnerName(m, teams)} (según ${m.result.source})`);
  if (m.cancelReason) lines.push(`Motivo: ${plain(m.cancelReason)}`);
  return lines.join('\n');
}

module.exports = { STATUS_ICON, teamHeader, memberLines, statsLine, teamInfo, matchInfo, winnerName, roleOf };
