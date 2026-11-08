'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { isValidTimeZone } = require('../utils/time');
const { readProviders } = require('../providers/registry');

const ROOT = path.resolve(__dirname, '..', '..');

/** Carga un archivo .env sencillo sin dependencias. No sobrescribe variables ya definidas. */
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function toInt(value, fallback, { min = -Infinity, max = Infinity } = {}) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function toList(value) {
  if (!value) return [];
  return String(value)
    .split(/[,\n;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Oculta el valor de parámetros de consulta (pueden llevar claves) al mostrar una URL en mensajes. */
function redactUrl(text) {
  return String(text).replace(/([?&][^=&]+=)[^&]*/g, '$1***').slice(0, 120);
}

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

/**
 * Construye la configuración a partir de un objeto env.
 * Es una función pura para poder probarla.
 */
function buildConfig(env = process.env, root = ROOT) {
  const resolveDir = (value, fallback) => path.resolve(root, value || fallback);

  const dataDir = resolveDir(env.DATA_DIR, 'data');
  const ffProv = readProviders(env, { prefix: 'FF_PROVIDER', listVar: 'FREEFIRE_PROVIDERS', kind: 'player' });
  const mediaProv = readProviders(env, { prefix: 'MEDIA_PROVIDER', listVar: 'MEDIA_PROVIDERS', kind: 'media' });
  const clanProv = readProviders(env, { prefix: 'CLAN_PROVIDER', listVar: 'CLAN_PROVIDERS', kind: 'clan' });

  return {
    root,
    name: 'BW BOT PREMIUM',
    version: '0.1.0',
    prefix: env.BOT_PREFIX || '.',
    timezone: env.TZ_BOT || 'America/Guayaquil',
    botPhone: onlyDigits(env.BOT_PHONE),
    ownerNumber: onlyDigits(env.OWNER_NUMBER) || '593990192338',
    paths: {
      data: dataDir,
      database: env.DATABASE_PATH
        ? path.resolve(root, env.DATABASE_PATH)
        : path.join(dataDir, 'database.json'),
      session: resolveDir(env.SESSION_DIR, path.join('data', 'session')),
      backups: resolveDir(env.BACKUP_DIR, path.join('data', 'backups')),
      logs: resolveDir(env.LOG_DIR, path.join('data', 'logs')),
      tmp: resolveDir(env.TMP_DIR, path.join('data', 'tmp')),
      lock: path.join(dataDir, 'bot.lock'),
    },
    log: {
      level: String(env.LOG_LEVEL || 'info').toLowerCase(),
      toFile: env.LOG_TO_FILE !== 'false',
    },
    db: {
      saveDebounceMs: toInt(env.DB_SAVE_DEBOUNCE_MS, 1500, { min: 0, max: 60000 }),
      backupEveryMinutes: toInt(env.DB_BACKUP_MINUTES, 360, { min: 0, max: 10080 }),
      backupKeep: toInt(env.DB_BACKUP_KEEP, 10, { min: 1, max: 200 }),
    },
    health: {
      // 0 = desactivado. En Docker se activa desde docker-compose (HEALTH_PORT=3000, HEALTH_HOST=0.0.0.0).
      port: toInt(env.HEALTH_PORT, 0, { min: 0, max: 65535 }),
      host: env.HEALTH_HOST || '127.0.0.1',
    },
    scheduler: {
      graceMs: toInt(env.SCHEDULER_GRACE_SECONDS, 300, { min: 0, max: 86400 }) * 1000,
    },
    whatsapp: {
      reconnectBaseMs: toInt(env.RECONNECT_BASE_MS, 2000, { min: 500, max: 60000 }),
      reconnectMaxMs: toInt(env.RECONNECT_MAX_MS, 120000, { min: 5000, max: 900000 }),
      reconnectMaxAttempts: toInt(env.RECONNECT_MAX_ATTEMPTS, 0, { min: 0, max: 10000 }),
      // Mensajes más viejos que esto (p. ej. los que llegan al reconectar) se ignoran para no ejecutar comandos atrasados.
      maxMessageAgeSec: toInt(env.MAX_MESSAGE_AGE_SECONDS, 120, { min: 5, max: 86400 }),
    },
    freefire: {
      apiUrls: toList(env.FF_API_URLS),
      apiKey: env.FF_API_KEY || '',
      defaultRegion: (env.FF_DEFAULT_REGION || '').toLowerCase(),
      regions: toList(env.FF_REGIONS).map((r) => r.toLowerCase()),
      timeoutMs: toInt(env.FF_API_TIMEOUT, 8000, { min: 500, max: 60000 }),
      cacheTtlSec: toInt(env.FF_CACHE_TTL, 300, { min: 0, max: 86400 }),
      maxConcurrent: toInt(env.FF_API_MAX_CONCURRENT, 4, { min: 1, max: 32 }),
      // Proveedores nombrados (FF_PROVIDER_n_* / FREEFIRE_PROVIDERS) y ajustes comunes de reintentos y fusión de datos.
      providers: ffProv.specs.map((x) => ({ ...x, kind: 'player' })),
      providerProblems: ffProv.problems,
      retries: env.FF_API_RETRIES ? toInt(env.FF_API_RETRIES, 1, { min: 0, max: 5 }) : null, // null: 1 para proveedores nombrados, 0 para plantillas FF_API_URLS
      backoffMs: toInt(env.FF_API_BACKOFF_MS, 300, { min: 0, max: 10000 }),
      merge: env.FF_MERGE_PROVIDERS !== 'false',
      mergeMax: toInt(env.FF_MERGE_MAX_EXTRA, 2, { min: 0, max: 5 }),
      healthUid: (env.FF_HEALTH_UID || '').trim(),
    },
    clan: {
      // Plantillas de URL con {id} (ID del clan), {region} y {key}. La región es opcional salvo que la plantilla la use.
      apiUrls: toList(env.CLAN_API_URLS),
      apiKey: env.CLAN_API_KEY || '',
      defaultRegion: (env.CLAN_DEFAULT_REGION || env.FF_DEFAULT_REGION || '').toLowerCase(),
      regions: toList(env.CLAN_REGIONS || env.FF_REGIONS).map((r) => r.toLowerCase()),
      timeoutMs: toInt(env.CLAN_API_TIMEOUT, 8000, { min: 500, max: 60000 }),
      cacheTtlSec: toInt(env.CLAN_CACHE_TTL, 600, { min: 0, max: 86400 }),
      maxConcurrent: toInt(env.CLAN_API_MAX_CONCURRENT, 4, { min: 1, max: 32 }),
      // Tiempo tras el cual la ficha guardada de un clan se vuelve a consultar al usarla.
      refreshHours: toInt(env.CLAN_REFRESH_HOURS, 6, { min: 1, max: 720 }),
      providers: clanProv.specs.map((x) => ({ ...x, kind: 'clan' })),
      providerProblems: clanProv.problems,
      retries: env.CLAN_API_RETRIES ? toInt(env.CLAN_API_RETRIES, 1, { min: 0, max: 5 }) : null,
      backoffMs: toInt(env.CLAN_API_BACKOFF_MS, 300, { min: 0, max: 10000 }),
      merge: env.CLAN_MERGE_PROVIDERS !== 'false',
      mergeMax: toInt(env.CLAN_MERGE_MAX_EXTRA, 2, { min: 0, max: 5 }),
      healthUid: (env.CLAN_HEALTH_ID || '').trim(),
    },
    gdc: {
      inviteTtlMin: toInt(env.GDC_INVITE_TTL_MINUTES, 10, { min: 1, max: 1440 }),
      maxMentions: toInt(env.GDC_MAX_MENTIONS, 200, { min: 0, max: 1000 }),
      squadTtlHours: toInt(env.GDC_SQUAD_TTL_HOURS, 36, { min: 1, max: 720 }),
      historyKeep: toInt(env.GDC_HISTORY_KEEP, 60, { min: 1, max: 1000 }),
    },
    teams: {
      inviteTtlMin: toInt(env.TEAM_INVITE_TTL_MINUTES, 60, { min: 1, max: 10080 }),
      maxPerCaptain: toInt(env.TEAM_MAX_PER_CAPTAIN, 3, { min: 1, max: 20 }),
      matchTtlHours: toInt(env.MATCH_TTL_HOURS, 24, { min: 1, max: 720 }),
      historyKeep: toInt(env.MATCH_HISTORY_KEEP, 300, { min: 10, max: 5000 }),
    },
    scrims: {
      checkinMinutes: toInt(env.SCRIM_CHECKIN_MINUTES, 30, { min: 1, max: 240 }),
      remindMinutes: toInt(env.SCRIM_REMIND_MINUTES, 15, { min: 1, max: 240 }),
      expireHours: toInt(env.SCRIM_EXPIRE_HOURS, 3, { min: 1, max: 48 }),
    },
    broadcast: {
      delayMs: toInt(env.BROADCAST_DELAY_MS, 1500, { min: 0, max: 60000 }),
    },
    elo: {
      k: toInt(env.ELO_K, 32, { min: 1, max: 200 }),
      kProvisional: toInt(env.ELO_K_PROVISIONAL, 48, { min: 1, max: 200 }),
      provisionalMatches: toInt(env.ELO_PROVISIONAL_MATCHES, 10, { min: 0, max: 100 }),
      // Partidas puntuables entre los mismos dos equipos en 24 h (evita inflar el ELO jugando siempre contra el mismo rival).
      maxPerPairDay: toInt(env.ELO_MAX_PAIR_PER_DAY, 4, { min: 1, max: 100 }),
      // Al cerrar una temporada: ELO = 1000 + (ELO - 1000) × softResetPercent / 100.
      softResetPercent: toInt(env.ELO_SEASON_SOFT_RESET_PERCENT, 50, { min: 0, max: 100 }),
      // Monedas virtuales para el top 1, 2 y 3 de jugadores al cerrar la temporada.
      seasonRewards: toList(env.ELO_SEASON_REWARDS || '300,200,100').map((n) => Math.max(0, parseInt(n, 10) || 0)).slice(0, 10),
    },
    games: {
      prizeCoins: toInt(env.GAME_PRIZE_COINS, 50, { min: 0, max: 100000 }),
      prizeXp: toInt(env.GAME_PRIZE_XP, 10, { min: 0, max: 100000 }),
      dailyCoinCap: toInt(env.GAME_DAILY_COIN_CAP, 500, { min: 0, max: 1000000 }),
      maxBet: toInt(env.GAME_MAX_BET, 1000, { min: 1, max: 1000000 }),
      lobbySec: toInt(env.GAME_LOBBY_SECONDS, 60, { min: 10, max: 600 }),
      roundSec: toInt(env.GAME_ROUND_SECONDS, 30, { min: 5, max: 300 }),
      questionSec: toInt(env.GAME_QUESTION_SECONDS, 30, { min: 5, max: 300 }),
    },
    ui: {
      // 'text' (por defecto): respuestas numeradas (.1 .2…), compatibles con todo. 'native': además intenta botones nativos de WhatsApp.
      buttons: ['native', 'text'].includes(String(env.UI_BUTTONS || '').toLowerCase()) ? String(env.UI_BUTTONS).toLowerCase() : 'text',
      ttlSec: toInt(env.UI_BUTTON_TTL, 300, { min: 30, max: 3600 }),
    },
    rateLimit: {
      userMax: toInt(env.RATE_LIMIT_USER_MAX, 8, { min: 1, max: 1000 }),
      userWindowSec: toInt(env.RATE_LIMIT_USER_WINDOW, 10, { min: 1, max: 3600 }),
      groupMax: toInt(env.RATE_LIMIT_GROUP_MAX, 30, { min: 1, max: 5000 }),
      groupWindowSec: toInt(env.RATE_LIMIT_GROUP_WINDOW, 10, { min: 1, max: 3600 }),
    },
    economy: {
      registerBonusCoins: toInt(env.REGISTER_BONUS_COINS, 100, { min: 0, max: 1000000 }),
      registerBonusXp: toInt(env.REGISTER_BONUS_XP, 50, { min: 0, max: 1000000 }),
      activityXp: toInt(env.ACTIVITY_XP, 5, { min: 0, max: 1000 }),
      activityXpCooldownSec: toInt(env.ACTIVITY_XP_COOLDOWN, 60, { min: 1, max: 86400 }),
    },
    play: {
      apiUrls: toList(env.PLAY_API_URLS),
      apiKeys: toList(env.PLAY_API_KEYS),
      searchUrls: toList(env.PLAY_SEARCH_URLS),
      downloadUrls: toList(env.PLAY_DOWNLOAD_URLS),
      maxQueue: toInt(env.MAX_PLAY_QUEUE, 10, { min: 1, max: 500 }),
      maxConcurrent: toInt(env.MAX_PLAY_CONCURRENT, 2, { min: 1, max: 10 }),
      maxFileSize: toInt(env.MAX_PLAY_FILE_SIZE, 64 * 1024 * 1024, { min: 1024 }),
      timeoutMs: toInt(env.PLAY_TIMEOUT, 60000, { min: 1000, max: 600000 }),
      cacheTtlSec: toInt(env.PLAY_CACHE_TTL, 3600, { min: 0 }),
      providers: mediaProv.specs.map((x) => ({ ...x, kind: 'media' })),
      providerProblems: mediaProv.problems,
      fileCacheMb: toInt(env.PLAY_FILE_CACHE_MB, 200, { min: 0, max: 100000 }),
      maxPerUser: toInt(env.MAX_PLAY_PER_USER, 1, { min: 1, max: 10 }),
      contextTtlSec: toInt(env.PLAY_CONTEXT_TTL, 300, { min: 30, max: 3600 }),
      results: toInt(env.PLAY_RESULTS, 5, { min: 1, max: 10 }),
      healthQuery: (env.MEDIA_HEALTH_QUERY || '').trim(),
      maxDurationSec: toInt(env.PLAY_MAX_DURATION, 1800, { min: 0, max: 86400 }),
    },
  };
}

const VALID_LOG_LEVELS = ['debug', 'info', 'warn', 'error'];

/** Devuelve la lista de problemas de configuración (vacía si todo está bien). */
function validateConfig(config) {
  const problems = [];
  if (!/^\d{8,15}$/.test(config.ownerNumber)) {
    problems.push('OWNER_NUMBER debe contener entre 8 y 15 dígitos.');
  }
  if (config.botPhone && !/^\d{8,15}$/.test(config.botPhone)) {
    problems.push('BOT_PHONE debe contener entre 8 y 15 dígitos (con código de país, sin +).');
  }
  if (!VALID_LOG_LEVELS.includes(config.log.level)) {
    problems.push(`LOG_LEVEL inválido. Usa: ${VALID_LOG_LEVELS.join(', ')}.`);
  }
  for (const template of config.freefire.apiUrls) {
    try {
      const probe = new URL(template.replace(/\{(uid|region|key)\}/g, 'x'));
      if (probe.protocol !== 'http:' && probe.protocol !== 'https:') throw new Error('protocolo');
    } catch {
      problems.push(`FF_API_URLS contiene una URL inválida (debe ser http/https): ${redactUrl(template)}`);
    }
  }
  for (const template of config.clan.apiUrls) {
    try {
      const probe = new URL(template.replace(/\{(id|region|key)\}/g, 'x'));
      if (probe.protocol !== 'http:' && probe.protocol !== 'https:') throw new Error('protocolo');
    } catch {
      problems.push(`CLAN_API_URLS contiene una URL inválida (debe ser http/https): ${redactUrl(template)}`);
    }
  }
  problems.push(...config.freefire.providerProblems, ...config.clan.providerProblems, ...config.play.providerProblems);
  if (!isValidTimeZone(config.timezone)) {
    problems.push(`TZ_BOT inválida: ${config.timezone}. Usa un nombre IANA, por ejemplo America/Guayaquil.`);
  }
  if (config.whatsapp.reconnectBaseMs > config.whatsapp.reconnectMaxMs) {
    problems.push('RECONNECT_BASE_MS no puede ser mayor que RECONNECT_MAX_MS.');
  }
  return problems;
}

function loadConfig() {
  loadEnvFile(path.join(ROOT, '.env'));
  return buildConfig(process.env, ROOT);
}

module.exports = { buildConfig, validateConfig, loadConfig, loadEnvFile, toList, toInt, onlyDigits, redactUrl, ROOT };
