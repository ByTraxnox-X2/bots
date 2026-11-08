'use strict';

const jid = require('../whatsapp/jid');

const MAX_TEXT_LENGTH = 2000;

/** Quita envolturas de mensajes temporales, de una sola vista y documentos con pie de foto. */
function unwrap(message) {
  let m = message;
  for (let i = 0; i < 4 && m; i++) {
    const inner =
      m.ephemeralMessage?.message ||
      m.viewOnceMessage?.message ||
      m.viewOnceMessageV2?.message ||
      m.documentWithCaptionMessage?.message ||
      null;
    if (!inner) break;
    m = inner;
  }
  return m;
}

function extractText(m) {
  if (!m) return '';
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.listResponseMessage?.title ||
    m.templateButtonReplyMessage?.selectedDisplayText ||
    (extractButtonId(m) ? 'botón' : '') ||
    ''
  );
}

/** Id de un botón/lista pulsado (respuesta a mensajes con botones). null si el mensaje no es una pulsación. */
function extractButtonId(m) {
  if (!m) return null;
  const direct = m.buttonsResponseMessage?.selectedButtonId || m.listResponseMessage?.singleSelectReply?.selectedRowId || m.templateButtonReplyMessage?.selectedId;
  if (direct) return String(direct);
  const nf = m.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;
  if (nf) {
    try { const id = JSON.parse(nf).id; if (id) return String(id); } catch { /* ignorar */ }
  }
  return null;
}

function extractContext(m) {
  return (
    m?.extendedTextMessage?.contextInfo ||
    m?.imageMessage?.contextInfo ||
    m?.videoMessage?.contextInfo ||
    m?.documentMessage?.contextInfo ||
    null
  );
}

/** Marca de tiempo del mensaje en ms (Baileys la entrega como número o como objeto Long). 0 si no existe. */
function timestampMs(msg) {
  const ts = msg.messageTimestamp;
  const n = ts && typeof ts === 'object' && typeof ts.toNumber === 'function' ? ts.toNumber() : Number(ts);
  return Number.isFinite(n) && n > 0 ? n * 1000 : 0;
}

function unique(list) {
  return [...new Set(list.filter(Boolean))];
}

/**
 * Convierte un mensaje crudo de Baileys en una estructura simple.
 * Devuelve null si no es un mensaje que el bot deba procesar (propio, estado, sin texto, etc.).
 */
function parseIncoming(msg) {
  if (!msg || !msg.key || !msg.message) return null;
  const { key } = msg;
  if (key.fromMe) return null;
  const chatJid = jid.normalize(key.remoteJid);
  if (!chatJid || chatJid === 'status@broadcast' || chatJid.endsWith('@broadcast') || chatJid.endsWith('@newsletter')) return null;

  const content = unwrap(msg.message);
  const text = String(extractText(content) || '');
  if (!text.trim() || text.length > MAX_TEXT_LENGTH) return null;

  const isGroup = jid.isGroup(chatJid);
  const raw = isGroup
    ? [key.participant, key.participantAlt, key.participantPn]
    : [key.remoteJid, key.remoteJidAlt, key.senderPn];
  const senderJids = unique(raw.map((j) => jid.normalize(j)));
  if (senderJids.length === 0) return null;

  const buttonId = extractButtonId(content);
  const ctx = extractContext(content);
  const mentions = unique((ctx?.mentionedJid || []).map((j) => jid.normalize(j)));
  const quotedSender = ctx?.participant ? jid.normalize(ctx.participant) : null;

  return {
    key,
    raw: msg,
    chatJid,
    isGroup,
    senderJids,
    primarySender: senderJids.find((j) => jid.isUser(j)) || senderJids[0],
    timestampMs: timestampMs(msg),
    pushName: typeof msg.pushName === 'string' ? msg.pushName : '',
    text,
    buttonId,
    mentions,
    quotedSender,
    quotedId: ctx?.stanzaId ? String(ctx.stanzaId) : null,
  };
}

/**
 * Interpreta "<prefijo>comando arg1 arg2". Devuelve { name, args, argText } o null si no es un comando.
 * El nombre solo admite letras y números, así que cosas como "..." o ".!" no se consideran comandos.
 */
function parseCommand(text, prefix = '.') {
  const trimmed = String(text || '').trim();
  if (!trimmed.startsWith(prefix)) return null;
  const body = trimmed.slice(prefix.length);
  if (!body || /^\s/.test(body)) return null;
  const parts = body.split(/\s+/);
  const name = parts[0].toLowerCase();
  if (!/^[a-z0-9]{1,30}$/.test(name)) return null;
  const args = parts.slice(1).filter(Boolean);
  return { name, args, argText: args.join(' ') };
}

module.exports = { extractButtonId, parseIncoming, parseCommand, unwrap, extractText, MAX_TEXT_LENGTH };
