'use strict';

// Stack completo con un WhatsApp falso, compartido por los tests de integración.
const path = require('node:path');

const { Dispatcher } = require('../src/handlers/dispatcher');
const { CommandRegistry } = require('../src/commands/registry');
const { PermissionService } = require('../src/middleware/permissions');
const { CommandLimiter } = require('../src/middleware/ratelimit');
const { UserService } = require('../src/services/users');
const { ClanService } = require('../src/services/clans');
const { GdcService } = require('../src/services/gdc');
const { buildExtras } = require('../src/services/extras');
const { Scheduler } = require('../src/scheduler');
const { FreeFireService } = require('../src/providers/freefire/service');
const { ClanApiService } = require('../src/providers/clans/service');
const { registerPlugins } = require('../src/plugins');
const { EventBus } = require('../src/events/bus');
const { Database } = require('../src/database');
const { buildConfig } = require('../src/config');
const { tmpDir, cleanup } = require('./helpers');

const OWNER = '593990192338@s.whatsapp.net';
const ALICE = '593991111111@s.whatsapp.net';
const BOB = '593992222222@s.whatsapp.net';
const GROUP = '120363000000000001@g.us';
const UID = '123456789';

const silentLogger = () => {
  const logs = { error: [], warn: [] };
  const l = {
    debug() {}, info() {}, warn: (...a) => logs.warn.push(a), error: (...a) => logs.error.push(a), child: () => l, logs,
    recent: (level, limit = 20) => (level === 'ERROR' ? logs.error : logs.warn).slice(-limit).map((a) => ({ time: '2026-01-01T00:00:00.000Z', level: level || 'WARN', scope: 'test', msg: String(a[0]), error: a[1]?.message || null })),
  };
  return l;
};

const fakeRes = (status, body) => ({ status, headers: { get: () => null }, body: null, text: async () => JSON.stringify(body) });

/** Crea todo el stack con un WhatsApp falso que guarda lo que el bot envía. */
function harness({ env = {}, fetchImpl, clanFetch, extraCommands = [], groupAdmins = [], metaFails = false, gdc: withGdc = false, startAt = null, dir: givenDir = null, self = null, waExtra = {}, groupsList = [], deleteFails = false, sleep = async () => {}, mediaOptions = {}, mediaFails = false } = {}) {
  const dir = givenDir || tmpDir();
  const config = buildConfig({ FF_API_URLS: 'https://ff.test/player/{uid}', FF_REGIONS: 'sa,br', FF_CACHE_TTL: '0', CLAN_API_URLS: 'https://clan.test/clan/{id}', CLAN_CACHE_TTL: '0', ...env }, dir);
  const logger = silentLogger();
  const db = new Database({ file: path.join(dir, 'db.json'), saveDebounceMs: 0, logger }).load();
  const sent = [];
  const deleted = [];
  const removed = [];
  const media = [];
  const wa = {
    sendText: async (to, text, opts = {}) => { sent.push({ to, text, mentions: opts.mentions || [], quoted: opts.quoted }); },
    groupMetadata: async () => {
      if (metaFails) throw new Error('sin conexión');
      return { participants: groupAdmins.map((p) => ({ ...p })) };
    },
  };
  wa.deleteMessage = async (chat, key) => { if (deleteFails) throw new Error('sin permisos'); deleted.push({ chat, key }); };
  wa.removeParticipants = async (group, jids) => { removed.push({ group, jids }); return jids.map((j) => ({ status: '200', jid: j })); };
  wa.listGroups = async () => groupsList;
  wa.sendMedia = async (to, opts = {}) => {
    if (mediaFails) throw new Error('WhatsApp rechazó el archivo');
    const fs = require('node:fs');
    // Se registra el contenido en el momento del envío: después el bot borra los temporales.
    media.push({ to, kind: opts.kind, mimetype: opts.mimetype, fileName: opts.fileName, caption: opts.caption, exists: fs.existsSync(opts.file), bytes: fs.existsSync(opts.file) ? fs.statSync(opts.file).size : 0, file: opts.file });
  };
  if (self) { wa.selfJid = self; wa.selfNumber = self.split('@')[0]; }
  Object.assign(wa, waExtra);
  const bus = new EventBus();
  const permissions = new PermissionService({ db, config });
  const users = new UserService({ db, config, bus });
  const ff = new FreeFireService({ config, logger, fetchImpl });
  const clanApi = new ClanApiService({ config, logger, fetchImpl: clanFetch });
  const clans = new ClanService({ db, bus, logger });
  const registry = registerPlugins(new CommandRegistry());
  registry.registerAll(extraCommands);
  const limiter = new CommandLimiter({ config });
  // Reloj controlable y scheduler sin temporizadores reales: los tests avanzan el tiempo y llaman a runDue().
  const clock = { t: startAt ?? Date.now() };
  const now = () => clock.t;
  const scheduler = new Scheduler({ db, logger, now, setTimer: () => ({ unref() {} }), clearTimer: () => {}, defaultGraceMs: config.scheduler.graceMs });
  const gdc = withGdc ? new GdcService({ db, config, clans, users, scheduler, wa, bus, logger, now }).register() : null;
  const extras = buildExtras({ db, config, bus, logger, users, clans, scheduler, wa, permissions, now, sleep, mediaOptions });
  const services = { config, db, bus, permissions, users, ff, clanApi, clans, registry, logger, scheduler, wa, ...extras, ...(gdc ? { gdc } : {}) };
  const d = new Dispatcher({ config, logger, wa, registry, permissions, users, limiter, services });
  services.dispatcher = d;
  services.startedAt = clock.t - 3725000;
  let n = 0;
  const msg = (text, { from = ALICE, group = null, mentions = [], quoted = null, ts, id, pushName = 'Alice', fromMe = false } = {}) => ({
    key: { remoteJid: group || from, ...(group ? { participant: from } : {}), id: id || `M${++n}`, fromMe },
    pushName,
    messageTimestamp: ts ?? Math.floor(Date.now() / 1000),
    message: mentions.length || quoted
      ? { extendedTextMessage: { text, contextInfo: { ...(mentions.length ? { mentionedJid: mentions } : {}), ...(quoted ? { participant: quoted } : {}) } } }
      : { conversation: text },
  });
  const say = async (text, opts) => { await d.handleMessage(msg(text, opts)); };
  const last = () => sent[sent.length - 1]?.text;
  return { ...extras, services, dir, config, db, d, sent, deleted, removed, media, users, ff, clanApi, clans, gdc, scheduler, clock, wa, bus, permissions, msg, say, last, logger, close: () => { db.close(); cleanup(dir); } };
}

const playerApi = (extra = {}) => async (url) => {
  const uid = String(url).split('/').pop().split('?')[0];
  return fakeRes(200, { basicInfo: { accountId: uid, nickname: 'ProPlayer', level: 65, ...extra } });
};


module.exports = { OWNER, ALICE, BOB, GROUP, UID, silentLogger, fakeRes, harness, playerApi };
