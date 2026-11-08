'use strict';

const fs = require('node:fs');
const { EventEmitter } = require('node:events');
const { Backoff } = require('../utils/backoff');
const jid = require('./jid');

/**
 * Gestor de conexión a WhatsApp sobre Baileys.
 *
 * Emite:
 *  - 'open'  (sock)           conexión establecida
 *  - 'close' ({ code, reason, willReconnect })
 *  - 'message' (upsert)       messages.upsert tal cual lo entrega Baileys
 *  - 'group-participants' (update)
 *  - 'pairing-code' (code)
 *  - 'logged-out'
 *  - 'fatal' (error)          se superó el máximo de reconexiones
 *
 * Baileys se carga de forma diferida (`loadBaileys`) para que el resto del bot
 * y los tests funcionen sin la dependencia instalada.
 */
class WhatsAppConnection extends EventEmitter {
  constructor({ config, logger, loadBaileys = defaultLoadBaileys, backoff = null, setTimer = setTimeout, clearTimer = clearTimeout }) {
    super();
    this.config = config;
    this.logger = logger;
    this.loadBaileys = loadBaileys;
    this.backoff =
      backoff ||
      new Backoff({
        baseMs: config.whatsapp.reconnectBaseMs,
        maxMs: config.whatsapp.reconnectMaxMs,
        maxAttempts: config.whatsapp.reconnectMaxAttempts,
      });
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.sock = null;
    this.state = 'idle'; // idle | connecting | open | closed | logged-out
    this.stopping = false;
    this._reconnectTimer = null;
    this._pairingRequested = false;
    this.selfJid = '';
    this.selfLid = '';
    this.connectedAt = null;
  }

  get selfNumber() {
    return jid.toNumber(this.selfJid);
  }

  async start() {
    this.stopping = false;
    await this._connect();
  }

  async _connect() {
    if (this.stopping) return;
    this.state = 'connecting';
    const baileys = await this.loadBaileys();
    const { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = baileys;

    fs.mkdirSync(this.config.paths.session, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(this.config.paths.session);

    let version;
try {
  ({ version } = await fetchLatestBaileysVersion());
    } catch (err) {
      this.logger.warn('No se pudo consultar la versión de WhatsApp Web; se usa la incluida en Baileys.', err);
    }

    const sock = makeWASocket({
      ...(version ? { version } : {}),
      auth: state,
      printQRInTerminal: false,
      browser: Browsers ? Browsers.ubuntu('Chrome') : ['BW BOT PREMIUM', 'Chrome', '1.0.0'],
      logger: silentPino(),
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });
    this.sock = sock;

    sock.ev.on('creds.update', async () => {
      try {
        await saveCreds();
      } catch (err) {
        this.logger.error('No se pudieron guardar las credenciales de sesión', err);
      }
    });

    sock.ev.on('messages.upsert', (upsert) => this.emit('message', upsert));
    sock.ev.on('group-participants.update', (u) => this.emit('group-participants', u));

    sock.ev.on('connection.update', (update) => {
      this._onConnectionUpdate(update, DisconnectReason).catch((err) => {
        this.logger.error('Error procesando connection.update', err);
      });
    });

    // Pairing code: solo si no hay sesión registrada y tenemos número.
    if (!state.creds.registered && !this._pairingRequested) {
      await this._requestPairing(sock);
    }
  }

  async _requestPairing(sock) {
    const phone = this.config.botPhone;
    if (!phone) {
      this.logger.error('No hay sesión guardada y falta BOT_PHONE en .env: no se puede generar el código de vinculación.');
      this.emit('fatal', new Error('Falta BOT_PHONE para el emparejamiento.'));
      return;
    }
    this._pairingRequested = true;
    // Baileys necesita unos instantes para abrir el socket antes de pedir el código.
    await new Promise((r) => this.setTimer(r, 3000));
    if (this.stopping) return;
    try {
      const code = await sock.requestPairingCode(phone);
      const pretty = String(code).match(/.{1,4}/g)?.join('-') || code;
      this.logger.info(`Código de vinculación: ${pretty}`);
      this.emit('pairing-code', pretty);
    } catch (err) {
      this._pairingRequested = false;
      this.logger.error('No se pudo solicitar el código de vinculación', err);
    }
  }

  async _onConnectionUpdate(update, DisconnectReason) {
    const { connection, lastDisconnect } = update;

    if (connection === 'open') {
      this.state = 'open';
      this.selfJid = jid.normalize(this.sock?.user?.id || '');
      this.selfLid = jid.normalize(this.sock?.user?.lid || '');
      this.connectedAt = Date.now();
      this._pairingRequested = false;
      this.backoff.reset();
      this.logger.info(`Conectado a WhatsApp como ${this.selfNumber || 'desconocido'}`);
      this.emit('open', this.sock);
      return;
    }

    if (connection !== 'close') return;

    const code = lastDisconnect?.error?.output?.statusCode;
    const reason = lastDisconnect?.error?.message || 'desconocido';
    this.sock = null;

    if (this.stopping) {
      this.state = 'closed';
      this.emit('close', { code, reason, willReconnect: false });
      return;
    }

    if (code === DisconnectReason.loggedOut) {
      this.state = 'logged-out';
      this.logger.error('La sesión fue cerrada desde el teléfono. Borra la carpeta de sesión y vuelve a vincular.');
      this.emit('logged-out');
      this.emit('close', { code, reason, willReconnect: false });
      return;
    }

    // Sesión corrupta (Bad MAC / inválida): requiere nueva vinculación.
    if (code === DisconnectReason.badSession) {
      this.logger.error('Sesión corrupta (badSession). Se aísla la carpeta de sesión para volver a vincular.');
      this._quarantineSession();
    }

    // 515 (restartRequired) es normal tras emparejar: reconectar de inmediato.
    const immediate = code === DisconnectReason.restartRequired;
    const delay = immediate ? 500 : this.backoff.next();

    if (delay === null) {
      this.state = 'closed';
      this.logger.error('Se superó el máximo de intentos de reconexión.');
      this.emit('close', { code, reason, willReconnect: false });
      this.emit('fatal', new Error('Máximo de reconexiones superado.'));
      return;
    }

    this.state = 'connecting';
    this.logger.warn(`Conexión cerrada (código ${code ?? 'n/d'}: ${reason}). Reintentando en ${Math.round(delay / 1000)}s.`);
    this.emit('close', { code, reason, willReconnect: true });
    this._scheduleReconnect(delay);
  }

  _scheduleReconnect(delay) {
    if (this._reconnectTimer) this.clearTimer(this._reconnectTimer);
    this._reconnectTimer = this.setTimer(() => {
      this._reconnectTimer = null;
      this._connect().catch((err) => {
        this.logger.error('Fallo al reconectar', err);
        const next = this.backoff.next();
        if (next === null) {
          this.emit('fatal', err);
        } else {
          this._scheduleReconnect(next);
        }
      });
    }, delay);
    if (this._reconnectTimer?.unref) this._reconnectTimer.unref();
  }

  _quarantineSession() {
    try {
      const dir = this.config.paths.session;
      if (fs.existsSync(dir)) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        fs.renameSync(dir, `${dir}.corrupt-${stamp}`);
      }
      this._pairingRequested = false;
    } catch (err) {
      this.logger.error('No se pudo aislar la sesión corrupta', err);
    }
  }

  async stop() {
    this.stopping = true;
    if (this._reconnectTimer) {
      this.clearTimer(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    const sock = this.sock;
    this.sock = null;
    this.state = 'closed';
    if (sock) {
      try {
        sock.ev.removeAllListeners('connection.update');
        sock.end(undefined);
      } catch (err) {
        this.logger.warn('Error cerrando el socket', err);
      }
    }
  }

  // ---------- acciones sobre WhatsApp (envoltorios finos sobre Baileys) ----------

  _requireSock() {
    if (!this.sock || this.state !== 'open') throw new Error('WhatsApp no está conectado.');
    return this.sock;
  }

  async sendText(to, text, { mentions = [], quoted } = {}) {
    const sock = this._requireSock();
    return sock.sendMessage(to, { text, ...(mentions.length ? { mentions } : {}) }, quoted ? { quoted } : undefined);
  }

  /**
   * Botones nativos: hasta 3 → botones de respuesta rápida; más → mensaje de lista. WhatsApp puede no mostrarlos en todos
   * los clientes (por eso el texto siempre trae también la lista numerada). Implementado, pendiente de verificación con
   * WhatsApp real.
   */
  async sendButtons(to, { text, footer = 'BW BOT PREMIUM', buttons }, { quoted } = {}) {
    const sock = this._requireSock();
    const opts = quoted ? { quoted } : undefined;
    if (buttons.length <= 3) {
      return sock.sendMessage(to, { text, footer, buttons: buttons.map((b) => ({ buttonId: b.id, buttonText: { displayText: b.label }, type: 1 })), headerType: 1 }, opts);
    }
    return sock.sendMessage(to, { text, footer, title: 'Opciones', buttonText: 'Ver opciones', sections: [{ title: 'Opciones', rows: buttons.slice(0, 10).map((b) => ({ title: b.label.slice(0, 24), rowId: b.id })) }] }, opts);
  }

  /**
   * Envía un archivo local (audio, video, imagen o documento). Baileys lee el archivo desde la ruta (stream).
   * Implementado, pendiente de verificación con WhatsApp real.
   */
  async sendMedia(to, { kind, file, mimetype, fileName, caption = '', quoted } = {}) {
    const sock = this._requireSock();
    const src = { url: file };
    let content;
    if (kind === 'audio') content = { audio: src, mimetype, ptt: false };
    else if (kind === 'video') content = { video: src, mimetype, ...(caption ? { caption } : {}) };
    else if (kind === 'image') content = { image: src, ...(caption ? { caption } : {}) };
    else content = { document: src, mimetype, fileName: fileName || 'archivo', ...(caption ? { caption } : {}) };
    return sock.sendMessage(to, content, quoted ? { quoted } : undefined);
  }

  async groupMetadata(groupJid) {
    return this._requireSock().groupMetadata(groupJid);
  }

  /** Borra un mensaje del chat (en grupos solo funciona si el bot es administrador). */
  async deleteMessage(chatJid, key) {
    return this._requireSock().sendMessage(chatJid, { delete: key });
  }

  /** Grupos en los que el bot está realmente presente ahora mismo (consulta a WhatsApp, nunca una lista inventada). */
  async listGroups() {
    const all = await this._requireSock().groupFetchAllParticipating();
    return Object.values(all || {}).map((g) => ({
      id: jid.normalize(g.id),
      subject: String(g.subject || ''),
      desc: String(g.desc || ''),
      owner: g.owner || null,
      creation: g.creation || null,
      announce: g.announce === true || g.announce === 'true',
      participants: Array.isArray(g.participants) ? g.participants : [],
    }));
  }

  /** Expulsa participantes. Devuelve el arreglo de resultados de Baileys ({ status, jid }). */
  async removeParticipants(groupJid, jids) {
    return this._requireSock().groupParticipantsUpdate(groupJid, jids, 'remove');
  }
}

async function defaultLoadBaileys() {
  let mod;
  try {
    mod = await import('@whiskeysockets/baileys');
  } catch (err) {
    const e = new Error('No está instalada la dependencia @whiskeysockets/baileys. Ejecuta: npm ci');
    e.cause = err;
    throw e;
  }
  const m = mod.default && typeof mod.default === 'function' ? mod : mod;
  return {
    makeWASocket: typeof mod.default === 'function' ? mod.default : mod.makeWASocket,
    useMultiFileAuthState: m.useMultiFileAuthState,
    DisconnectReason: m.DisconnectReason,
    fetchLatestBaileysVersion: m.fetchLatestBaileysVersion,
    Browsers: m.Browsers,
  };
}

/** Logger mudo compatible con la interfaz de pino que espera Baileys. */
function silentPino() {
  const noop = () => {};
  const l = { level: 'silent', trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop };
  l.child = () => l;
  return l;
}

module.exports = { WhatsAppConnection, silentPino };
