'use strict';

const { flatten, cleanString, toNumber, toIsoTime, toRegion, pick } = require('../freefire/normalize');

/**
 * Normalización tolerante de respuestas de APIs de clanes. Igual que en jugadores: solo se devuelven los campos
 * que la API entregó y son válidos; nada se estima ni se inventa.
 */

const DESC_MAX = 200;
const MEMBER_LIST_MAX = 100;
const LIST_KEYS = ['members', 'memberlist', 'memberslist', 'guildmembers', 'clanmembers', 'players'];
const LEADER_KEYS = ['captain', 'leader', 'owner', 'clanleader', 'guildleader', 'clancaptain'];
// Dentro de la información "del clan" no se leen datos de líderes ni de miembros.
const SCOPE_EXCLUDE = ['captain', 'leader', 'owner', 'member', 'players', 'pet', 'weapon'];

const str = (v) => cleanString(v);

const CLAN_FIELDS = [
  ['clanId', ['clanid', 'guildid', 'id'], str],
  ['name', ['clanname', 'guildname', 'name'], str],
  ['level', ['clanlevel', 'guildlevel', 'level'], toNumber],
  ['memberCount', ['membernum', 'membercount', 'memberscount', 'nummembers', 'members'], toNumber],
  ['capacity', ['capacity', 'maxmembers', 'membermax', 'maxmember'], toNumber],
  ['description', ['notice', 'announcement', 'description', 'desc', 'slogan', 'intro', 'bio'], (v) => cleanString(v, DESC_MAX)],
  ['region', ['region', 'clanregion', 'server'], toRegion],
  ['score', ['clanscore', 'guildscore', 'score', 'points', 'clanpoints', 'guildpoints'], toNumber],
  ['createdAt', ['createtime', 'createdat', 'createat', 'clancreatetime', 'creationtime'], toIsoTime],
];

function memberFromObject(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const entries = flatten(o);
  const m = {};
  const uid = pick(entries, ['uid', 'accountid', 'playerid', 'id'], { exclude: [], convert: str });
  const nickname = pick(entries, ['nickname', 'nick', 'playername', 'accountname', 'name', 'username'], { exclude: [], convert: str });
  const level = pick(entries, ['level', 'accountlevel', 'lvl'], { exclude: [], convert: toNumber });
  const role = pick(entries, ['role', 'position', 'rolename', 'title'], { exclude: [], convert: (v) => (typeof v === 'number' ? toNumber(v) : cleanString(v, 30)) });
  if (uid !== undefined) m.uid = uid;
  if (nickname !== undefined) m.nickname = nickname;
  if (level !== undefined) m.level = level;
  if (role !== undefined) m.role = role;
  return m.uid !== undefined || m.nickname !== undefined ? m : null;
}

/** Busca (hasta cierta profundidad) el primer arreglo de objetos bajo una clave de lista de miembros. */
function findList(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 4) return null;
  if (!Array.isArray(node)) {
    for (const [k, v] of Object.entries(node)) {
      const key = String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
      if (LIST_KEYS.includes(key) && Array.isArray(v) && v.length && typeof v[0] === 'object') return v;
    }
    for (const v of Object.values(node)) {
      const found = findList(v, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function findLeader(root, entries) {
  // 1) Objeto anidado (captainBasicInfo: { accountId, nickname, level })
  const walk = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || Array.isArray(node) || depth > 4) return null;
    for (const [k, v] of Object.entries(node)) {
      const key = String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
      if (v && typeof v === 'object' && !Array.isArray(v) && LEADER_KEYS.some((w) => key.startsWith(w) || key.endsWith(w))) {
        const m = memberFromObject(v);
        if (m) return m;
      }
    }
    for (const v of Object.values(node)) {
      const r = walk(v, depth + 1);
      if (r) return r;
    }
    return null;
  };
  const nested = walk(root);
  if (nested) return nested;
  // 2) Campos planos: captainId / captainName / leaderNickname...
  const leader = {};
  const uid = pick(entries, ['captainid', 'leaderid', 'ownerid', 'captainuid', 'leaderuid'], { exclude: [], convert: str });
  const nickname = pick(entries, ['captainname', 'leadername', 'ownername', 'captainnickname', 'leadernickname'], { exclude: [], convert: str });
  if (uid !== undefined) leader.uid = uid;
  if (nickname !== undefined) leader.nickname = nickname;
  return Object.keys(leader).length ? leader : null;
}

/**
 * @returns { found, data } con data = { clanId?, name?, level?, memberCount?, capacity?, description?, region?,
 *            score?, createdAt?, leader?: {uid?,nickname?,level?,role?}, members?: [...] }
 */
function normalizeClan(json) {
  const root = Array.isArray(json) ? json[0] : json;
  if (root === null || typeof root !== 'object') return { found: false, data: {} };
  const entries = flatten(root);
  const data = {};
  for (const [field, aliases, convert] of CLAN_FIELDS) {
    const v = pick(entries, aliases, { exclude: SCOPE_EXCLUDE, convert });
    if (v !== undefined) data[field] = v;
  }
  const list = findList(root);
  if (list) {
    const members = list.slice(0, MEMBER_LIST_MAX).map(memberFromObject).filter(Boolean);
    if (members.length) {
      data.members = members;
      // Si la API no dio el total, el tamaño de la lista es un dato real de la respuesta.
      if (data.memberCount === undefined && list.length <= MEMBER_LIST_MAX) data.memberCount = members.length;
    }
  }
  const leader = findLeader(root, entries);
  if (leader) data.leader = leader;
  return { found: data.name !== undefined || data.clanId !== undefined, data };
}

module.exports = { normalizeClan, memberFromObject };
