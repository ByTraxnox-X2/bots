'use strict';

const { ApiLookupService } = require('../lookup-service');
const { normalizeClan } = require('./normalize');

const CLAN_ID_RE = /^\d{3,15}$/;

const SPEC = Object.freeze({
  idName: 'id',
  idKey: 'clanId',
  normalize: normalizeClan,
  idRegex: CLAN_ID_RE,
  resultKey: 'id',
  invalidKind: 'INVALID_ID',
  logLabel: 'Clanes',
  kind: 'clan',
  notFoundCode: 'CLAN_NOT_FOUND',
  coreFields: ['name', 'level', 'memberCount', 'capacity'],
  messages: {
    notConfigured: 'La consulta de clanes no está configurada. El administrador debe definir CLAN_API_URLS en el archivo .env.',
    apiDown: 'Las APIs de clanes no respondieron en este momento. Inténtalo de nuevo en unos minutos.',
    invalid: 'El ID del clan no es válido (solo números, entre 3 y 15 dígitos).',
    needRegion: 'Las APIs de clanes configuradas necesitan la región. Defínela en CLAN_DEFAULT_REGION o indícala: *.verificarclan IDCLAN sa*',
    notFound: (where) => `No encontré ningún clan con ese ID${where}.`,
  },
});

/** Consulta de clanes sobre varias APIs configurables (CLAN_API_URLS). Misma mecánica que FreeFireService. */
class ClanApiService extends ApiLookupService {
  constructor({ config, fetchImpl = globalThis.fetch, logger = null, now = () => Date.now() }) {
    super({ cfg: config.clan, spec: SPEC, appName: config.name, version: config.version, fetchImpl, logger, now });
  }
}

module.exports = { ClanApiService, CLAN_ID_RE };
