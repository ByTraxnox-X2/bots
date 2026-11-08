'use strict';

/**
 * Normalización tolerante de respuestas de APIs de Free Fire.
 *
 * Cada API devuelve un formato distinto. Esta función busca, dentro del JSON recibido, solamente los
 * campos que reconoce por su nombre y SOLO devuelve los que existen y son válidos. Si la API no entrega
 * un dato, el resultado simplemente no tiene esa propiedad: nunca se rellena, se estima ni se inventa nada.
 * Los códigos numéricos (por ejemplo de rango) se conservan tal cual, sin traducirlos a nombres.
 */

const MAX_DEPTH = 6;
const STR_MAX = 80;
const BIO_MAX = 150;
const DEFAULT_EXCLUDE = ['clan', 'guild', 'captain', 'leader', 'pet', 'weapon'];

function flatten(node, out = [], path = [], depth = 0) {
  if (depth > MAX_DEPTH || node === null || node === undefined) return out;
  if (Array.isArray(node)) {
    node.slice(0, 3).forEach((item, i) => flatten(item, out, [...path, `item${i}`], depth + 1));
    return out;
  }
  if (typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      const key = String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
      if (v !== null && typeof v === 'object') flatten(v, out, [...path, key], depth + 1);
      else if (['string', 'number', 'boolean'].includes(typeof v)) out.push({ path, key, depth, value: v });
    }
  }
  return out;
}

function cleanString(value, max = STR_MAX) {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const s = String(value)
    .replace(/[\u0000-\u001F\u007F​-‏‪-‮⁦-⁩]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
  return s || undefined;
}

function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 && value <= 1e12 ? value : undefined;
  if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim())) {
    const n = Number(value);
    return Number.isFinite(n) && n <= 1e12 ? n : undefined;
  }
  return undefined;
}

/** Convierte epoch en segundos o milisegundos, o una fecha ISO, a ISO; descarta fechas imposibles. */
function toIsoTime(value) {
  let ms;
  const n = toNumber(value);
  if (n !== undefined) ms = n > 1e11 ? n : n * 1000;
  else if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value.trim())) ms = Date.parse(value);
  if (!Number.isFinite(ms)) return undefined;
  const year = new Date(ms).getUTCFullYear();
  return year >= 2010 && year <= 2100 ? new Date(ms).toISOString() : undefined;
}

function toUrl(value) {
  if (typeof value !== 'string') return undefined;
  const s = value.trim();
  if (s.length > 300) return undefined;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

function toRegion(value) {
  const s = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^[a-z]{2,6}$/.test(s) ? s : undefined;
}

/** Un segmento de ruta pertenece a un contexto si empieza o termina con él (evita falsos positivos como "competitive" ~ "pet"). */
const segMatch = (seg, word) => seg.startsWith(word) || seg.endsWith(word);

/** Busca el mejor candidato para una lista de alias (prioridad por orden de alias, luego menor profundidad). */
function pick(entries, aliases, { exclude = DEFAULT_EXCLUDE, require: needCtx = null, convert }) {
  for (const alias of aliases) {
    const matches = entries
      .filter((e) => e.key === alias)
      .filter((e) => !exclude.some((x) => e.path.some((seg) => segMatch(seg, x))))
      .filter((e) => !needCtx || e.path.some((seg) => needCtx.some((x) => segMatch(seg, x))))
      .sort((a, b) => a.depth - b.depth);
    for (const m of matches) {
      const v = convert(m.value);
      if (v !== undefined) return v;
    }
  }
  return undefined;
}

const num = (v) => toNumber(v);
const str = (v) => cleanString(v);

const PLAYER_FIELDS = [
  ['uid', ['uid', 'accountid', 'playerid'], str],
  ['nickname', ['nickname', 'nick', 'playername', 'accountname', 'username', 'name'], str],
  ['level', ['level', 'accountlevel', 'lvl'], num],
  ['exp', ['exp', 'experience', 'accountexp', 'xp'], num],
  ['likes', ['likes', 'liked', 'like', 'accountlikes', 'totallikes'], num],
  ['region', ['region', 'accountregion', 'server'], toRegion],
  ['bio', ['signature', 'bio', 'sign', 'about'], (v) => cleanString(v, BIO_MAX)],
  ['createdAt', ['createat', 'createdat', 'createtime', 'accountcreatetime', 'creationtime'], toIsoTime],
  ['lastLogin', ['lastloginat', 'lastlogin', 'lastlogintime'], toIsoTime],
  ['rank', ['brrank', 'rankname', 'rank'], (v) => (typeof v === 'number' ? toNumber(v) : cleanString(v, 40))],
  ['rankPoints', ['brrankpoint', 'brrankpoints', 'rankingpoints', 'rankingpoint', 'rankpoints', 'brpoints'], num],
  ['csRank', ['csrank', 'csrankname'], (v) => (typeof v === 'number' ? toNumber(v) : cleanString(v, 40))],
  ['csRankPoints', ['csrankpoint', 'csrankpoints', 'csrankingpoints', 'csrankingpoint'], num],
];

const CLAN_CTX = ['clan', 'guild'];
const CLAN_EXCLUDE = ['captain', 'leader'];
const CLAN_FIELDS = [
  ['clanId', ['clanid', 'guildid', 'id'], str],
  ['clanName', ['clanname', 'guildname', 'name'], str],
  ['clanLevel', ['clanlevel', 'guildlevel', 'level'], num],
  ['clanMembers', ['membernum', 'members', 'membercount'], num],
  ['clanCapacity', ['capacity', 'maxmembers'], num],
];

/**
 * @param json respuesta ya parseada de la API
 * @returns { found: boolean, data: object } donde `data` solo contiene campos presentes y válidos.
 */
function normalizePlayer(json) {
  const root = Array.isArray(json) ? json[0] : json;
  if (root === null || typeof root !== 'object') return { found: false, data: {} };
  const entries = flatten(root);
  const data = {};

  for (const [field, aliases, convert] of PLAYER_FIELDS) {
    const v = pick(entries, aliases, { convert });
    if (v !== undefined) data[field] = v;
  }

  // Avatar y banner: una URL válida o un identificador numérico, según lo que entregue la API.
  for (const [field, aliases] of [
    ['avatar', ['avatarurl', 'avatarid', 'headpic', 'avatar']],
    ['banner', ['bannerurl', 'bannerid', 'banner']],
  ]) {
    const url = pick(entries, aliases, { convert: toUrl });
    if (url) {
      data[`${field}Url`] = url;
      continue;
    }
    const id = pick(entries, aliases, { convert: (v) => (typeof v === 'number' || /^\d+$/.test(String(v)) ? toNumber(v) : undefined) });
    if (id !== undefined) data[`${field}Id`] = id;
  }

  // Clan: solo si hay un identificador o nombre dentro de un contexto de clan/guild.
  const clan = {};
  for (const [field, aliases, convert] of CLAN_FIELDS) {
    const v = pick(entries, aliases, { exclude: CLAN_EXCLUDE, require: CLAN_CTX, convert });
    if (v !== undefined) clan[field] = v;
  }
  if (clan.clanId !== undefined || clan.clanName !== undefined) Object.assign(data, clan);

  return { found: data.nickname !== undefined || data.level !== undefined, data };
}

module.exports = { normalizePlayer, flatten, cleanString, toNumber, toIsoTime, toUrl, toRegion, pick, segMatch };
