'use strict';

const jid = require('../whatsapp/jid');
const { UserError } = require('../services/users');
const { hasRole } = require('../middleware/permissions');
const { plain } = require('../utils/text');

const tag = (j) => jid.mentionTag(j);

/** Persona objetivo de un comando: mención o mensaje citado (solo JIDs reales entregados por WhatsApp). */
function targetJid(ctx) {
  return ctx.mentions[0] || ctx.quotedSender || null;
}

/** Usuario registrado al que apunta la mención; error claro si no hay mención o no está registrado. */
function targetUser(ctx, usage) {
  const t = targetJid(ctx);
  if (!t) throw new UserError('USAGE', `Menciona a la persona o responde a su mensaje: *${ctx.prefix}${usage}*`);
  const u = ctx.services.users.find([t]);
  if (!u) throw new UserError('TARGET_NOT_REGISTERED', 'Esa persona no está registrada en el bot.');
  return u;
}

/** Argumentos sin menciones (@123…) para sacar el texto libre de un comando. */
function textArgs(ctx, from = 0) {
  return ctx.args.slice(from).filter((a) => !a.startsWith('@')).join(' ');
}

/** ¿Es moderador efectivo? SUPERADMIN+ en cualquier sitio; ADMIN solo en el grupo indicado. */
async function canModerate(ctx, groupJid = null) {
  const role = (await ctx.getRole()).role;
  if (hasRole(role, 'SUPERADMIN')) return true;
  return hasRole(role, 'ADMIN') && Boolean(groupJid) && groupJid === ctx.chatJid;
}

const name = (users, j) => plain(users.find([j])?.name || tag(j));

module.exports = { tag, targetJid, targetUser, textArgs, canModerate, name };
