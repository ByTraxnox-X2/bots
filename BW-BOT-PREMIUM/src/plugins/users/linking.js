'use strict';

const { UserError } = require('../../services/users');
const { parseUid, parseRegion } = require('../../utils/validators');
const { plain } = require('../../utils/text');

/** Valida UID y región tal como los escribió el usuario. Lanza UserError con un mensaje claro. */
function parseUidAndRegion(uidText, regionText, cfg) {
  const uid = parseUid(uidText);
  if (!uid.ok) throw new UserError('INVALID_UID', uid.error);
  let region = null;
  if (regionText) {
    const r = parseRegion(regionText, cfg.freefire.regions);
    if (!r.ok) throw new UserError('INVALID_REGION', r.error);
    region = r.value;
  }
  return { uid: uid.value, region };
}

/**
 * Decide si un UID se puede vincular, consultando las APIs de Free Fire.
 *  - La API lo encuentra                       → vínculo verificado (con datos reales).
 *  - La API responde "no existe" (definitivo)  → se rechaza.
 *  - Región rechazada / hace falta región      → se rechaza explicando qué hacer.
 *  - API caída / sin configurar / resultado no definitivo → se vincula SIN verificar y se avisa.
 * @returns { verified, region, snapshot, notice }
 */
async function checkLink({ ff, uid, region }) {
  const res = await ff.lookup(uid, { region });
  if (res.ok) {
    return {
      verified: true,
      region: res.region || region || null,
      snapshot: { fetchedAt: new Date(res.fetchedAt || Date.now()).toISOString(), provider: res.provider, data: { ...res.data } },
      notice: null,
    };
  }
  if (res.kind === 'NOT_FOUND' && !res.partial) throw new UserError('FF_NOT_FOUND', `❌ ${res.message}`);
  if (res.kind === 'REGION_ERROR') throw new UserError('FF_REGION', `❌ ${res.message}`);
  const reasons = {
    NOT_CONFIGURED: 'La consulta de Free Fire no está configurada',
    API_DOWN: 'Las APIs de Free Fire no respondieron',
    NOT_FOUND: 'El resultado de la búsqueda no fue definitivo',
  };
  return {
    verified: false,
    region,
    snapshot: null,
    notice: `⚠️ ${reasons[res.kind] || 'No se pudo verificar el UID'}, así que lo vinculé *sin verificar*. Se verificará cuando uses *.perfil*.`,
  };
}

/** Vincula el UID a la persona (comprobando antes que nadie más lo tenga). Devuelve texto de resultado. */
async function linkUid({ users, ff, config, identities, uid, region }) {
  const owner = users.findByFfUid(uid);
  const me = users.find(identities);
  if (owner && me && owner.jid !== me.jid) throw new UserError('UID_TAKEN', '❌ Ese UID ya está vinculado a otro usuario.');

  const check = await checkLink({ ff, uid, region });
  users.linkFreeFire(identities, { uid, region: check.region, verified: check.verified, snapshot: check.snapshot });

  const lines = [`🎮 UID *${uid}* vinculado${check.region ? ` (región ${check.region.toUpperCase()})` : ''}${check.verified ? ' ✅ verificado' : ''}.`];
  if (check.snapshot?.data?.nickname) lines.push(`👤 Nick: ${plain(check.snapshot.data.nickname)}`);
  if (check.notice) lines.push(check.notice);
  return lines.join('\n');
}

module.exports = { parseUidAndRegion, checkLink, linkUid };
