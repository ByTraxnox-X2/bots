'use strict';

/**
 * ProviderRegistry: catálogo de adaptadores ("presets") de APIs reales de Free Fire y lectura de la configuración
 * por proveedor desde el entorno (.env). Los datos de cada preset vienen de su documentación pública; NINGUNO ha
 * sido verificado en vivo desde este entorno (ver docs/API_PROVIDERS.md). Las claves nunca están en el código.
 *
 *   Preset         Jugador  Clan   Clave        Base por defecto
 *   hlgaming       sí       sí     USERUID:API  https://proapis.hlgamingofficial.com/main/games/freefire/account/api
 *   ffcommunity    sí       no     x-api-key    https://developers.freefirecommunity.com/api/v1
 *   jinix          sí       sí     no           https://free-ff-api-src-5plp.onrender.com
 *   gameskinbo     sí       no     x-api-key    https://api.gameskinbo.com
 *
 * Normalización: las respuestas de todos los presets pasan por normalizePlayer/normalizeClan (tolerantes por alias:
 * AccountName|nickname|playerName → nickname, etc.); lo que el proveedor no entrega queda ausente.
 */

const q = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
const join = (base, path) => `${String(base).replace(/\/+$/, '')}${path}`;
const up = (r) => String(r || '').toUpperCase();

const PRESETS = Object.freeze({
  hlgaming: {
    id: 'hlgaming',
    label: 'HL Gaming Official',
    authRequired: true,
    defaultBase: 'https://proapis.hlgamingofficial.com/main/games/freefire/account/api',
    regions: ['ind', 'br', 'sg', 'ru', 'id', 'tw', 'us', 'vn', 'th', 'me', 'pk', 'cis', 'bd'],
    keyFormat: 'USERUID:APIKEY',
    kinds: {
      player: {
        needsRegion: true,
        build: ({ base, id, region, key }) => {
          const [useruid, api] = String(key).includes(':') ? String(key).split(/:(.*)/s) : ['', key];
          return { url: `${base}?${q({ sectionName: 'AccountInfo', PlayerUid: id, region: region, useruid, api })}` };
        },
      },
      clan: {
        needsRegion: true,
        build: ({ base, id, region, key }) => {
          const [useruid, api] = String(key).includes(':') ? String(key).split(/:(.*)/s) : ['', key];
          return { url: `${base}?${q({ sectionName: 'GuildInfo', PlayerUid: id, region: region, useruid, api })}` };
        },
      },
    },
  },
  ffcommunity: {
    id: 'ffcommunity',
    label: 'Free Fire Community API Hub',
    authRequired: true,
    defaultBase: 'https://developers.freefirecommunity.com/api/v1',
    regions: [], // la documentación indica sg, ind, br y "otras" sin lista cerrada
    userAgent: 'FFInfoClient/1.0 (+whatsapp-community)', // el servicio rechaza agentes con nombres de librerías/bots
    kinds: {
      player: {
        needsRegion: true,
        build: ({ base, id, region, key }) => ({ url: `${join(base, '/info')}?${q({ region, uid: id })}`, headers: { 'x-api-key': key } }),
      },
    },
  },
  jinix: {
    id: 'jinix',
    label: 'free-ff-api (jinix6, instancia pública)',
    authRequired: false,
    defaultBase: 'https://free-ff-api-src-5plp.onrender.com',
    regions: ['ind', 'br', 'sg', 'ru', 'id', 'tw', 'us', 'vn', 'th', 'me', 'pk', 'cis', 'bd'],
    kinds: {
      player: { needsRegion: true, build: ({ base, id, region }) => ({ url: `${join(base, '/api/v1/account')}?${q({ region: up(region), uid: id })}` }) },
      clan: { needsRegion: true, build: ({ base, id, region }) => ({ url: `${join(base, '/api/v1/guildInfo')}?${q({ region: up(region), guildID: id })}` }) },
    },
  },
  gameskinbo: {
    id: 'gameskinbo',
    label: 'GameSkinBo FF Info',
    authRequired: true,
    defaultBase: 'https://api.gameskinbo.com',
    regions: ['bd', 'ind', 'br', 'us', 'sac', 'na', 'th', 'id', 'sg', 'pk'],
    kinds: {
      player: { needsRegion: false, build: ({ base, id, region, key }) => ({ url: `${join(base, '/ff-info/get')}?${q({ uid: id, region: region ? up(region) : '' })}`, headers: { 'x-api-key': key } }) },
    },
  },
});

const REGIONS = Object.freeze(['br', 'us', 'na', 'sac', 'ind', 'sg', 'id', 'ru', 'tw', 'vn', 'th', 'me', 'pk', 'cis', 'bd']);

const bool = (v, d) => (v === undefined || v === '' ? d : !/^(0|false|no|off)$/i.test(String(v).trim()));
const int = (v, d, min, max) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d; };
const list = (v) => (v ? String(v).split(/[,\n;]/).map((s) => s.trim()).filter(Boolean) : []);

/**
 * Lee los proveedores de un tipo desde el entorno.
 *   prefix  'FF_PROVIDER' | 'CLAN_PROVIDER'      listVar 'FREEFIRE_PROVIDERS' | 'CLAN_PROVIDERS'
 * Cada proveedor `N` se configura con <prefix>_N_URL, _KEY, _TYPE (preset o generic), _ENABLED, _PRIORITY, _TIMEOUT,
 * _REGIONS, _NAME, _RETRIES, _RATE_LIMIT (consultas/min) y _AUTH_HEADER.
 * La lista `FREEFIRE_PROVIDERS=provider1,hlgaming` elige y ordena: `providerN` usa las variables numeradas y un
 * nombre de preset (p. ej. hlgaming) usa <prefix>_HLGAMING_*.
 */
function readProviders(env, { prefix, listVar, kind }) {
  const specs = [];
  const problems = [];
  const read = (slot, order) => {
    const g = (suffix) => env[`${prefix}_${slot}_${suffix}`];
    const typeRaw = String(g('TYPE') || (PRESETS[String(slot).toLowerCase()] ? String(slot).toLowerCase() : 'generic')).toLowerCase();
    const preset = typeRaw !== 'generic' ? PRESETS[typeRaw] : null;
    if (typeRaw !== 'generic' && !preset) { problems.push(`${prefix}_${slot}_TYPE desconocido: ${typeRaw}`); return; }
    if (preset && !preset.kinds[kind]) { problems.push(`El proveedor ${typeRaw} no soporta ${kind === 'player' ? 'jugadores' : 'clanes'}`); return; }
    const url = (g('URL') || (preset ? preset.defaultBase : '')).trim();
    if (!url) return;
    const regions = list(g('REGIONS')).map((r) => r.toLowerCase());
    specs.push({
      id: String(slot).toLowerCase(),
      name: g('NAME') || (preset ? preset.id : `${kind === 'player' ? 'ff' : 'clan'}${String(slot).toLowerCase().replace(/^provider/, '')}`),
      type: preset ? preset.id : 'generic',
      preset,
      url,
      key: g('KEY') || '',
      enabled: bool(g('ENABLED'), true),
      priority: int(g('PRIORITY'), order, 1, 1000),
      timeoutMs: g('TIMEOUT') ? int(g('TIMEOUT'), 8000, 500, 60000) : 0,
      regions: regions.length ? regions : preset ? preset.regions : [],
      retries: g('RETRIES') !== undefined && g('RETRIES') !== '' ? int(g('RETRIES'), 1, 0, 5) : undefined,
      rateLimitPerMin: int(g('RATE_LIMIT'), 0, 0, 100000),
      authHeader: g('AUTH_HEADER') || '',
    });
  };

  const wanted = list(env[listVar]);
  if (wanted.length) {
    wanted.forEach((entry, i) => {
      const e = entry.toLowerCase();
      const m = /^provider(\d+)$/.exec(e);
      read(m ? m[1] : e.toUpperCase(), i + 1);
    });
  } else {
    for (let n = 1; n <= 9; n += 1) {
      if (env[`${prefix}_${n}_URL`] || env[`${prefix}_${n}_TYPE`]) read(String(n), n);
    }
  }
  return { specs, problems };
}

module.exports = { PRESETS, REGIONS, readProviders };
