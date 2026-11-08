'use strict';

/**
 * Utilidades de JID de WhatsApp. Funciones puras, sin dependencias.
 * Formatos: 593999@s.whatsapp.net, 593999:12@s.whatsapp.net (dispositivo),
 * 123456@lid (identificador anónimo), 120363...@g.us (grupo).
 */

function decode(jid) {
  const raw = String(jid || '');
  const at = raw.indexOf('@');
  if (at < 1) return null;
  const user = raw.slice(0, at).split(':')[0].split('_')[0];
  const server = raw.slice(at + 1);
  if (!user || !server) return null;
  return { user, server };
}

/** Normaliza a user@server sin sufijo de dispositivo. Devuelve '' si es inválido. */
function normalize(jid) {
  const d = decode(jid);
  return d ? `${d.user}@${d.server}` : '';
}

function isGroup(jid) {
  return decode(jid)?.server === 'g.us';
}

function isLid(jid) {
  return decode(jid)?.server === 'lid';
}

function isUser(jid) {
  const s = decode(jid)?.server;
  return s === 's.whatsapp.net' || s === 'c.us';
}

/** Número telefónico del JID (solo para JIDs de usuario, no @lid). */
function toNumber(jid) {
  const d = decode(jid);
  if (!d || (d.server !== 's.whatsapp.net' && d.server !== 'c.us')) return '';
  return d.user.replace(/\D/g, '');
}

/** Convierte un número (con o sin +, espacios, guiones) a JID de usuario. */
function fromNumber(number) {
  const digits = String(number || '').replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return '';
  return `${digits}@s.whatsapp.net`;
}

function sameUser(a, b) {
  const na = normalize(a);
  return na !== '' && na === normalize(b);
}

/** Etiqueta de mención @número para texto. */
function mentionTag(jid) {
  const d = decode(jid);
  return d ? `@${d.user}` : '@usuario';
}

module.exports = { decode, normalize, isGroup, isLid, isUser, toNumber, fromNumber, sameUser, mentionTag };
