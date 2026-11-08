'use strict';

const jid = require('../whatsapp/jid');
const { UserError } = require('../services/users');
const { plain } = require('../utils/text');

const tag = (j) => jid.mentionTag(j);

/** Minúsculas sin tildes ni espacios sobrantes, para comparar respuestas. */
function norm(text) {
  return String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const games = (ctx) => ctx.services.games;

/** Sesión viva de un tipo en este chat o error claro. */
function needSession(ctx, type, label) {
  const s = games(ctx).activeOf(ctx.chatJid, type);
  if (!s) throw new UserError('NO_GAME', `No hay ${label} en curso aquí. Empieza una con *${ctx.prefix}${type}*.`);
  return s;
}

function addPlayer(s, j) {
  if (!s.players.includes(j)) s.players.push(j);
}

const names = (ctx, list) => list.map((j) => plain(ctx.services.users.find([j])?.name || tag(j))).join(', ');
const mentions = (list) => [...new Set(list)];
const tags = (list) => list.map(tag).join(' ');

module.exports = { tag, norm, games, needSession, addPlayer, names, mentions, tags, UserError, plain };
