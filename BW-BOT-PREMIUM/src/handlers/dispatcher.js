'use strict';

const jid = require('../whatsapp/jid');
const { parseIncoming, parseCommand } = require('./message');
const { hasRole } = require('../middleware/permissions');
const { CommandRegistry } = require('../commands/registry');
const { RateLimiter } = require('../middleware/ratelimit');
const { UserError } = require('../services/users');
const { InteractionService } = require('../services/interactions');

const GROUP_META_TTL_MS = 60 * 1000;
const SEEN_MAX = 1000;
const DENY_NOTICE_WINDOW_MS = 15 * 1000;

const GENERIC_ERROR = '⚠️ Ocurrió un error inesperado al ejecutar el comando. Inténtalo de nuevo en un momento.';

/**
 * Despachador de mensajes. Pipeline por mensaje:
 *   parseIncoming → ¿comando? → ban → alcance (grupo/privado) → permisos → registro → rate limit → handler.
 *
 * - Un comando desconocido se ignora en silencio (así no se responde a mensajes de otros bots o texto normal).
 * - Los rechazos (permisos, registro, límites) se responden como mucho una vez cada pocos segundos por persona.
 * - Un error en un handler nunca tumba el bot: UserError → su mensaje; cualquier otro → mensaje genérico + log.
 * - Cada mensaje se procesa de forma independiente (concurrente); drain() espera a los que están en curso.
 */
class Dispatcher {
  constructor({ config, logger, wa, registry, permissions, users, limiter, services = {}, now = () => Date.now() }) {
    this.config = config;
    this.logger = logger;
    this.wa = wa;
    this.registry = registry;
    this.permissions = permissions;
    this.users = users;
    this.limiter = limiter;
    this.services = services;
    this.now = now;
    this.stopping = false;
    this.inflight = new Set();
    this.seen = new Set(); // ids de mensajes ya procesados (WhatsApp puede reentregar)
    this.groupCache = new Map(); // groupJid -> { at, meta }
    this.denyLimiter = new RateLimiter({ now });
  }

  /** Punto de entrada para el evento 'message' de la conexión (messages.upsert). */
  handleUpsert(upsert) {
    if (this.stopping || !upsert || upsert.type !== 'notify' || !Array.isArray(upsert.messages)) return;
    for (const msg of upsert.messages) {
      const p = this.handleMessage(msg)
        .catch((err) => this.logger.error('Error no controlado procesando un mensaje', err))
        .finally(() => this.inflight.delete(p));
      this.inflight.add(p);
    }
  }

  stop() {
    this.stopping = true;
  }

  /** Espera a que terminen los mensajes en curso (con tope de tiempo). */
  async drain(timeoutMs = 8000) {
    if (this.inflight.size === 0) return true;
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs);
    });
    const result = await Promise.race([Promise.allSettled([...this.inflight]).then(() => 'done'), timeout]);
    clearTimeout(timer);
    return result === 'done';
  }

  _alreadySeen(msg) {
    const id = msg?.key?.id;
    if (!id) return false;
    const k = `${msg.key.remoteJid}|${id}`;
    if (this.seen.has(k)) return true;
    this.seen.add(k);
    while (this.seen.size > SEEN_MAX) this.seen.delete(this.seen.values().next().value);
    return false;
  }

  async handleMessage(rawMsg) {
    const incoming = parseIncoming(rawMsg);
    if (!incoming) return;
    if (this._alreadySeen(rawMsg)) return;

    const maxAge = this.config.whatsapp.maxMessageAgeSec * 1000;
    if (incoming.timestampMs && this.now() - incoming.timestampMs > maxAge) return;

    const identities = incoming.senderJids;

    // Pulsación de un botón: se traduce al comando guardado y sigue el MISMO camino que un mensaje escrito
    // (permisos, registro y límites se revalidan con la identidad de quien pulsa).
    if (incoming.buttonId) {
      const r = this.services.interactions?.resolveButton({ chat: incoming.chatJid, users: identities, buttonId: incoming.buttonId });
      if (!r || r.reason === 'invalid') return;
      if (!r.ok) {
        return this._deny(incoming, incoming.primarySender, r.reason === 'foreign' ? '🚫 Ese botón es de otra persona. Usa el comando tú mismo.' : '⌛ Ese botón ya expiró. Vuelve a usar el comando.');
      }
      incoming.text = r.command;
    }

    // Moderación automática de grupos (silencios, antilinks, antispam, antiflood). Exentos: OWNER, MOD+ y admins del grupo.
    if (incoming.isGroup && this.services.groups) {
      const pre = this.permissions.resolve(identities);
      if (pre.banned) return;
      if (!hasRole(pre.role, 'MOD')) {
        try {
          const verdict = await this.services.groups.inspect(incoming, { isAdmin: () => this._isGroupAdmin(incoming.chatJid, identities) });
          if (verdict.stop) return;
        } catch (err) {
          this.logger.error('Error en la moderación automática', err);
        }
      }
    }

    let parsed = parseCommand(incoming.text, this.config.prefix);

    // Alternativa de texto a los botones: ".1", ".2"… eligen una opción de la última lista que recibió esa persona.
    if (parsed && /^\d{1,2}$/.test(parsed.name) && this.services.interactions) {
      const r = this.services.interactions.resolveNumber({ chat: incoming.chatJid, user: incoming.primarySender, n: Number(parsed.name) });
      if (!r.ok) return;
      incoming.text = r.command;
      parsed = parseCommand(r.command, this.config.prefix);
    }

    if (!parsed) {
      await this._plainMessage(incoming);
      return;
    }

    const def = this.registry.get(parsed.name);
    if (!def) return;

    const base = this.permissions.resolve(identities);
    if (base.banned) return; // los usuarios baneados no reciben ninguna respuesta

    // Modo mantenimiento: solo el OWNER puede usar comandos.
    const maint = this.services.admin?.maintenance?.();
    if (maint?.enabled && base.role !== 'OWNER') {
      return this._deny(incoming, incoming.primarySender, `🛠️ El bot está en mantenimiento${maint.reason ? `: ${maint.reason}` : ''}. Vuelve a intentarlo más tarde.`);
    }

    // Subcomando (p. ej. ".gdc crear"): el primer argumento que coincide se consume y aporta sus propios requisitos.
    const sub = CommandRegistry.findSub(def, parsed.args[0]);
    if (sub) {
      parsed.args = parsed.args.slice(1);
      parsed.argText = parsed.args.join(' ');
    }
    const scope = sub ? sub.scope : def.scope;
    const needsRegistration = sub ? sub.requiresRegistration : def.requiresRegistration;
    const requiredRole = sub ? (parsed.args.length > 0 && sub.permissionsWithArgs ? sub.permissionsWithArgs : sub.permissions) : def.permissions;
    const commandLabel = sub ? `${def.name} ${sub.name}` : def.name;

    const isOwner = base.role === 'OWNER';
    const userKey = incoming.primarySender;
    const chatJid = incoming.chatJid;
    const deny = (text) => this._deny(incoming, userKey, text);

    // Alcance
    if (scope === 'group' && !incoming.isGroup) return deny('Este comando solo funciona en grupos.');
    if (scope === 'private' && incoming.isGroup) return deny('Este comando solo funciona en chat privado con el bot.');

    // Rol (solo se consulta el grupo de WhatsApp si hace falta saber si es admin del grupo)
    let roleInfo = base;
    let roleResolved = !incoming.isGroup || isOwner;
    const getRole = async () => {
      if (!roleResolved) {
        const isGroupAdmin = await this._isGroupAdmin(chatJid, identities);
        roleInfo = this.permissions.resolve(identities, { isGroupAdmin });
        roleResolved = true;
      }
      return roleInfo;
    };
    if (requiredRole !== 'USER') {
      const r = await getRole();
      if (!hasRole(r.role, requiredRole)) {
        return deny(`🚫 No tienes permiso para usar *${this.config.prefix}${commandLabel}*. Requiere rol ${requiredRole}.`);
      }
    }

    // Registro
    const user = this.users.find(identities);
    if (needsRegistration && !user) {
      return deny(`Primero debes registrarte con *${this.config.prefix}registro* para usar *${this.config.prefix}${commandLabel}*.`);
    }

    // Límite de uso
    const limit = this.limiter.check({ userKey, groupKey: incoming.isGroup ? chatJid : null, command: def.name, cooldownSec: def.cooldown, isOwner });
    if (!limit.allowed) {
      if (limit.notify) {
        const text =
          limit.reason === 'cooldown'
            ? `⏳ Espera ${limit.retryAfterSec} s para volver a usar *${this.config.prefix}${def.name}*.`
            : limit.reason === 'group'
              ? `⏳ Este grupo está usando el bot demasiado rápido. Intenta de nuevo en ${limit.retryAfterSec} s.`
              : `⏳ Vas muy rápido. Intenta de nuevo en ${limit.retryAfterSec} s.`;
        await this._send(incoming, text);
      }
      return;
    }

    // Ejecución
    const ctx = this._buildContext(incoming, parsed, def, { user, getRole, base, sub });
    let replyText = null;
    let replyOpts = {};
    try {
      // El handler devuelve un texto, o { text, mentions } si necesita mencionar a alguien.
      const out = await (sub ? sub.handler(ctx) : def.handler(ctx));
      if (typeof out === 'string' && out) replyText = out;
      else if (out && typeof out.text === 'string' && out.text) {
        replyText = out.text;
        replyOpts = { mentions: Array.isArray(out.mentions) ? out.mentions : [], actions: out.actions || null, anyone: !!out.anyone };
      }
    } catch (err) {
      if (err instanceof UserError || err?.userMessage) {
        await ctx.reply(err.userMessage || err.message);
      } else {
        this.logger.error(`Fallo en el comando ${def.name}`, err);
        await ctx.reply(GENERIC_ERROR);
      }
      return;
    }
    if (replyText) await ctx.reply(replyText, replyOpts);

    // Actividad (solo cuenta si el comando terminó bien)
    this._activity(incoming, 'command');
  }

  async _plainMessage(incoming) {
    const base = this.permissions.resolve(incoming.senderJids);
    if (base.banned) return;
    this._activity(incoming, 'message');
  }

  _activity(incoming, kind) {
    try {
      const r = this.users.recordActivity(incoming.senderJids, { kind, name: incoming.pushName });
      if (r.levelUps.length) {
        const last = r.levelUps[r.levelUps.length - 1];
        const coins = r.levelUps.reduce((a, l) => a + l.coins, 0);
        this._send(incoming, `🎉 ¡Subiste al nivel ${last.level}! Recibes ${coins} monedas.`).catch(() => {});
      }
    } catch (err) {
      this.logger.error('Error registrando actividad', err);
    }
  }

  _buildContext(incoming, parsed, def, { user, getRole, base, sub = null }) {
    const reply = (text, opts = {}) => this._send(incoming, text, opts);
    return {
      prefix: this.config.prefix,
      config: this.config,
      command: def,
      sub: sub ? sub.name : null, // subcomando resuelto (ya validado), o null
      subDef: sub,
      args: parsed.args,
      argText: parsed.argText,
      text: incoming.text,
      chatJid: incoming.chatJid,
      isGroup: incoming.isGroup,
      sender: incoming.primarySender,
      senderJids: incoming.senderJids,
      pushName: incoming.pushName,
      mentions: incoming.mentions,
      quotedSender: incoming.quotedSender,
      quotedId: incoming.quotedId || null,
      user, // perfil del que escribe (null si no está registrado)
      baseRole: base.role,
      getRole,
      reply,
      sendMedia: (opts) => this._sendMedia(incoming, opts),
      messageId: incoming.key?.id || null,
      messageTimestampMs: incoming.timestampMs || 0,
      services: this.services,
      registry: this.registry,
    };
  }

  // ---------- envío ----------

  async _deny(incoming, userKey, text) {
    const r = this.denyLimiter.hit(`d:${userKey}`, 1, DENY_NOTICE_WINDOW_MS);
    if (r.allowed) await this._send(incoming, text);
  }

  async _send(incoming, text, { mentions = [], actions = null, anyone = false } = {}) {
    try {
      let body = text;
      let native = null;
      const it = actions && this.services.interactions ? this.services.interactions.create({ chat: incoming.chatJid, user: incoming.primarySender, actions, anyone }) : null;
      if (it) {
        // La alternativa numerada va SIEMPRE en el texto: si el cliente no muestra los botones, sigue siendo usable.
        body = `${text}\n${InteractionService.fallbackText(it.items, this.config.prefix)}`;
        if (this.config.ui?.buttons === 'native' && typeof this.wa.sendButtons === 'function') native = it.items;
      }
      if (native) {
        try {
          await this.wa.sendButtons(incoming.chatJid, { text: body, buttons: native.map((i) => ({ id: i.buttonId, label: i.label })) }, { quoted: incoming.raw });
          return;
        } catch (err) {
          this.logger.warn('No se pudieron enviar botones nativos; se usa texto numerado', err);
        }
      }
      await this.wa.sendText(incoming.chatJid, body, { mentions, quoted: incoming.raw });
    } catch (err) {
      this.logger.error('No se pudo enviar la respuesta', err);
    }
  }

  /** Envía un archivo. Devuelve { ok } y NUNCA lanza: quien llama decide qué decir según el resultado real. */
  async _sendMedia(incoming, opts) {
    try {
      if (typeof this.wa.sendMedia !== 'function') return { ok: false, error: 'unsupported' };
      const { actions, ...rest } = opts || {};
      const it = actions && this.services.interactions ? this.services.interactions.create({ chat: incoming.chatJid, user: incoming.primarySender, actions }) : null;
      if (it) rest.caption = `${rest.caption || ''}\n${InteractionService.fallbackText(it.items, this.config.prefix)}`.trim();
      await this.wa.sendMedia(incoming.chatJid, { ...rest, quoted: incoming.raw });
      return { ok: true };
    } catch (err) {
      this.logger.error('No se pudo enviar el archivo multimedia', err);
      return { ok: false, error: String(err && err.message ? err.message : err).slice(0, 120) };
    }
  }

  // ---------- grupos ----------

  async _groupMeta(groupJid) {
    const hit = this.groupCache.get(groupJid);
    if (hit && this.now() - hit.at < GROUP_META_TTL_MS) return hit.meta;
    const meta = await this.wa.groupMetadata(groupJid);
    this.groupCache.set(groupJid, { at: this.now(), meta });
    while (this.groupCache.size > 200) this.groupCache.delete(this.groupCache.keys().next().value);
    return meta;
  }

  /** ¿La persona es admin del grupo de WhatsApp? Si no se puede saber, se asume que no (más seguro). */
  async _isGroupAdmin(groupJid, identities) {
    try {
      const meta = await this._groupMeta(groupJid);
      const mine = new Set(identities.map((j) => jid.normalize(j)).filter(Boolean));
      for (const p of meta?.participants || []) {
        if (!p || !p.admin) continue;
        const ids = [p.id, p.lid, p.phoneNumber, p.jid].map((j) => jid.normalize(j)).filter(Boolean);
        if (ids.some((id) => mine.has(id))) return true;
      }
    } catch (err) {
      this.logger.warn('No se pudo consultar el grupo para verificar admins', err);
    }
    return false;
  }

  /** Invalida la cache de un grupo (por ejemplo cuando cambian los participantes). */
  invalidateGroup(groupJid) {
    this.groupCache.delete(groupJid);
  }
}

module.exports = { Dispatcher, GENERIC_ERROR };
