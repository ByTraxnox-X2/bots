'use strict';

/**
 * Esquema de la base de datos y migraciones.
 * Cada colección es un objeto indexado por id, salvo las listadas en ARRAY_COLLECTIONS.
 */

const SCHEMA_VERSION = 3;

const OBJECT_COLLECTIONS = [
  'users', // jid -> usuario
  'groups', // jid de grupo -> configuración del grupo
  'clans', // idClan -> clan verificado
  'teams', // idEquipo -> equipo 2v2/4v4/6v6
  'gdc', // jid de grupo -> configuración y estado de GDC
  'tournaments', // idTorneo -> torneo
  'scrims', // idScrim -> scrim
  'matches', // idPartida -> partida entre equipos (2v2/4v4/6v6)
  'games', // idSesion -> sesión de juego interactivo
  'economy', // jid -> cooldowns/estado económico
  'inventory', // jid -> items
  'rankings', // clave de ranking -> datos
  'achievements', // jid -> logros
  'missions', // jid -> misiones
  'settings', // configuración global
  'permissions', // jid -> rol (ADMIN/MOD) y baneos
  'mediaCache', // clave -> metadatos de búsquedas
  'market', // idPublicacion -> venta
  'scheduled', // idEvento -> evento programado (scheduler)
  'meta', // información interna de la DB
];

const ARRAY_COLLECTIONS = [
  'events', // eventos internos importantes
  'logs', // acciones administrativas
  'history', // historial genérico
];

function emptyData() {
  const data = {};
  for (const name of OBJECT_COLLECTIONS) data[name] = {};
  for (const name of ARRAY_COLLECTIONS) data[name] = [];
  data.meta = { schemaVersion: SCHEMA_VERSION, createdAt: new Date().toISOString() };
  return data;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Devuelve lista de errores de estructura (vacía si es válida). */
function validate(data) {
  const errors = [];
  if (!isPlainObject(data)) return ['La base de datos no es un objeto.'];
  for (const name of OBJECT_COLLECTIONS) {
    if (!isPlainObject(data[name])) errors.push(`La colección "${name}" debe ser un objeto.`);
  }
  for (const name of ARRAY_COLLECTIONS) {
    if (!Array.isArray(data[name])) errors.push(`La colección "${name}" debe ser una lista.`);
  }
  if (isPlainObject(data.meta) && typeof data.meta.schemaVersion !== 'number') {
    errors.push('meta.schemaVersion debe ser numérico.');
  }
  return errors;
}

/** Rellena colecciones faltantes sin tocar las existentes. */
function ensureCollections(data) {
  const base = emptyData();
  for (const name of [...OBJECT_COLLECTIONS, ...ARRAY_COLLECTIONS]) {
    if (data[name] === undefined) data[name] = base[name];
  }
  return data;
}

/**
 * Migraciones ordenadas. `up` recibe los datos y los modifica in situ.
 * Para añadir una nueva: sube SCHEMA_VERSION y agrega una entrada con version = SCHEMA_VERSION.
 */
const MIGRATIONS = [
  {
    version: 1,
    description: 'Estructura inicial',
    up(data) {
      ensureCollections(data);
    },
  },
  {
    version: 2,
    description: 'Añade colecciones market y scheduled si faltaban',
    up(data) {
      ensureCollections(data);
    },
  },
  {
    version: 3,
    description: 'Añade la colección games (sesiones de juegos interactivos)',
    up(data) {
      ensureCollections(data);
    },
  },
];

function migrate(data, migrations = MIGRATIONS, target = SCHEMA_VERSION) {
  ensureCollections(data);
  if (!isPlainObject(data.meta)) data.meta = {};
  let current = Number.isInteger(data.meta.schemaVersion) ? data.meta.schemaVersion : 0;
  const applied = [];
  if (current > target) {
    throw new Error(
      `La base de datos es de una versión más nueva (${current}) que la soportada (${target}).`
    );
  }
  for (const m of migrations) {
    if (m.version > current && m.version <= target) {
      m.up(data);
      current = m.version;
      data.meta.schemaVersion = current;
      applied.push(m.version);
    }
  }
  data.meta.schemaVersion = Math.max(current, data.meta.schemaVersion || 0);
  return applied;
}

module.exports = {
  SCHEMA_VERSION,
  OBJECT_COLLECTIONS,
  ARRAY_COLLECTIONS,
  MIGRATIONS,
  emptyData,
  validate,
  ensureCollections,
  migrate,
  isPlainObject,
};
