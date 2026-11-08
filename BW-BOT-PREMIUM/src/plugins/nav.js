'use strict';

const { hasRole } = require('../middleware/permissions');

/**
 * Navegación del menú: secciones y acciones. Cada acción es un COMANDO real que se ejecuta por el despachador
 * (permisos y límites se revalidan al usarla), así que no hay lógica duplicada ni botones muertos.
 */
const SECTIONS = [
  { id: 'perfil', label: '👤 PERFIL', cats: ['usuario'] },
  { id: 'freefire', label: '🔥 FREE FIRE', cats: ['freefire', 'clanes'] },
  { id: 'gdc', label: '⚔️ GDC', cats: ['gdc'], groupOnly: true },
  { id: 'equipos', label: '👥 EQUIPOS', cats: ['equipos', 'scrims'] },
  { id: 'torneos', label: '🏆 TORNEOS', cats: ['torneos'] },
  { id: 'economia', label: '💰 ECONOMÍA', cats: ['economia'] },
  { id: 'juegos', label: '🎮 JUEGOS', cats: ['juegos'] },
  { id: 'ranking', label: '📊 RANKING', cats: ['ranking'] },
  { id: 'social', label: '👥 SOCIAL', cats: ['social'] },
  { id: 'play', label: '🎵 PLAY', cats: ['play'] },
  { id: 'tools', label: '🛠️ TOOLS', cats: ['tools'] },
  { id: 'moderacion', label: '🔨 MODERACIÓN', cats: ['moderacion'] },
  { id: 'admin', label: '👑 ADMIN', cats: ['admin', 'owner'] },
  { id: 'ayuda', label: '📖 AYUDA', cats: ['general'] },
];

/** Cómo ejecutar sin argumentos los comandos con subcomandos (su "pantalla de inicio"). */
const HOME = { gdc: 'gdc estado', torneo: 'torneo lista', equipo: 'equipo info', partida: 'partida lista', scrim: 'scrim lista', juegos: 'juegos lista', ranking: 'ranking', amigos: 'amigos', titulos: 'titulos', temporada: 'temporada', comparar: null, grupoconfig: null, broadcast: null };

const FULL_LABEL = { perfil: '👤 Perfil', balance: '🪙 Balance', nivel: '⭐ Nivel' };

/** ¿Se puede ejecutar sin argumentos? Sin subcomandos y sin parámetros obligatorios en el uso. */
function runnable(def) {
  if (def.name in HOME) return HOME[def.name] !== null;
  if (def.subcommands && def.subcommands.length) return false;
  let rest = def.usage.slice(def.name.length).trim();
  let prev;
  do { prev = rest; rest = rest.replace(/\[[^\[\]]*\]/g, '').trim(); } while (rest !== prev);
  return rest === '';
}

const commandFor = (def, prefix) => `${prefix}${def.name in HOME && HOME[def.name] ? HOME[def.name] : def.name}`;

function sectionById(id) {
  const q = String(id || '').toLowerCase();
  return SECTIONS.find((s) => s.id === q) || null;
}

/** Secciones visibles para esta persona en este chat (por rol, grupo y clan verificado). */
function visibleSections(ctx, visible) {
  const clanOk = ctx.isGroup && ctx.services.clans && ctx.services.clans.clanOfGroup(ctx.chatJid);
  return SECTIONS.filter((s) => {
    if (!s.cats.some((c) => visible.some((d) => d.category === c))) return false;
    if (s.groupOnly && !ctx.isGroup) return false;
    if (s.id === 'gdc' && !clanOk) return false; // la GDC solo existe en un grupo con clan verificado
    return true;
  });
}

function mainActions(ctx, visible) {
  return visibleSections(ctx, visible).map((s) => ({ label: s.label, command: `${ctx.prefix}menu ${s.id}` }));
}

function sectionActions(ctx, section, visible) {
  const defs = visible.filter((d) => section.cats.includes(d.category) && runnable(d));
  const acts = defs.slice(0, 12).map((d) => ({ label: `▶️ ${FULL_LABEL[d.name] || `${ctx.prefix}${d.name}`}`, command: commandFor(d, ctx.prefix) }));
  acts.push({ label: '⬅️ MENÚ', command: `${ctx.prefix}menu` });
  return acts;
}

/** Acciones de una categoría del registro (para .help <categoría>). */
function categoryActions(ctx, category, visible) {
  const defs = visible.filter((d) => d.category === category && runnable(d));
  const acts = defs.slice(0, 12).map((d) => ({ label: `▶️ ${ctx.prefix}${d.name}`, command: commandFor(d, ctx.prefix) }));
  acts.push({ label: '⬅️ AYUDA', command: `${ctx.prefix}help` });
  return acts;
}

module.exports = { SECTIONS, HOME, runnable, sectionById, visibleSections, mainActions, sectionActions, categoryActions, commandFor, hasRole };
