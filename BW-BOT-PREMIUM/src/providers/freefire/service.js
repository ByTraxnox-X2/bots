'use strict';

const { ApiLookupService, Semaphore } = require('../lookup-service');
const { normalizePlayer } = require('./normalize');

const UID_RE = /^\d{5,15}$/;

const SPEC = Object.freeze({
  idName: 'uid',
  idKey: 'uid',
  normalize: normalizePlayer,
  idRegex: UID_RE,
  resultKey: 'uid',
  invalidKind: 'INVALID_UID',
  logLabel: 'Free Fire',
  kind: 'player',
  notFoundCode: 'PLAYER_NOT_FOUND',
  coreFields: ['nickname', 'level', 'exp', 'likes', 'rank'],
  messages: {
    notConfigured: 'La consulta de Free Fire no está configurada. El administrador debe definir FF_API_URLS en el archivo .env.',
    apiDown: 'Las APIs de Free Fire no respondieron en este momento. Inténtalo de nuevo en unos minutos.',
    invalid: 'El UID no es válido.',
    needRegion: 'Necesito la región del jugador. Ejemplo: *.ff 123456789 sa*',
    notFound: (where) => `No encontré ningún jugador con ese UID${where}.`,
  },
});

/**
 * Consulta de jugadores de Free Fire sobre varias APIs configurables (FF_API_URLS) con fallback, cache,
 * circuit breaker y errores diferenciados. Ver ApiLookupService para el contrato de lookup().
 */
class FreeFireService extends ApiLookupService {
  constructor({ config, fetchImpl = globalThis.fetch, logger = null, now = () => Date.now() }) {
    super({ cfg: config.freefire, spec: SPEC, appName: config.name, version: config.version, fetchImpl, logger, now });
  }
}

module.exports = { FreeFireService, Semaphore, UID_RE };
