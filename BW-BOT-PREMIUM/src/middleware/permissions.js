'use strict';

const jid = require('../whatsapp/jid');

/** Roles de menor a mayor privilegio. */
const ROLES = Object.freeze(['USER', 'MOD', 'ADMIN', 'SUPERADMIN', 'OWNER']);
/** Roles que se pueden asignar desde el bot (OWNER solo se define con OWNER_NUMBER). */
const ASSIGNABLE_ROLES = Object.freeze(['MOD', 'ADMIN', 'SUPERADMIN']);

function roleLevel(role) {
  const i = ROLES.indexOf(role);
  return i === -1 ? -1 : i;
}

/** ¿El rol `actual` cumple con el rol `requerido` (o uno superior)? */
function hasRole(actual, required) {
  return roleLevel(actual) >= roleLevel(required) && roleLevel(required) >= 0;
}

const COLLECTION = 'permissions';

/**
 * Resolución de roles y baneos. La validación siempre ocurre en el backend: el menú o los botones
 * solo ocultan opciones, nunca conceden permisos.
 *
 * Una persona puede llegar con varios identificadores (JID de teléfono y/o @lid). Se consideran todos.
 */
class PermissionService {
  constructor({ db, config }) {
    this.db = db;
    this.config = config;
  }

  _keys(identities) {
    const keys = new Set();
    for (const j of identities || []) {
      const n = jid.normalize(j);
      if (n) keys.add(n);
    }
    return [...keys];
  }

  isOwner(identities) {
    return (identities || []).some((j) => jid.toNumber(j) === this.config.ownerNumber);
  }

  /**
   * @param identities lista de JIDs de la persona (teléfono, lid…)
   * @param opts.isGroupAdmin  es administrador del grupo de WhatsApp donde escribe
   * @returns { role, level, banned }
   */
  resolve(identities, { isGroupAdmin = false } = {}) {
    if (this.isOwner(identities)) return { role: 'OWNER', level: roleLevel('OWNER'), banned: false };

    let role = 'USER';
    let banned = false;
    for (const key of this._keys(identities)) {
      const rec = this.db.get(COLLECTION, key);
      if (!rec) continue;
      if (rec.banned) banned = true;
      if (roleLevel(rec.role) > roleLevel(role)) role = rec.role;
    }
    if (isGroupAdmin && roleLevel('ADMIN') > roleLevel(role)) role = 'ADMIN';
    return { role, level: roleLevel(role), banned };
  }

  getRecord(jidValue) {
    return this.db.get(COLLECTION, jid.normalize(jidValue)) || null;
  }

  setRole(jidValue, role, { by = null } = {}) {
    const key = jid.normalize(jidValue);
    if (!key) throw new Error('JID inválido.');
    if (!ASSIGNABLE_ROLES.includes(role) && role !== 'USER') throw new Error(`Rol no asignable: ${role}.`);
    if (this.isOwner([key])) throw new Error('No se puede cambiar el rol del OWNER.');
    const rec = this.db.ensure(COLLECTION, key, () => ({ role: 'USER', banned: false }));
    rec.role = role;
    rec.updatedAt = new Date().toISOString();
    if (by) rec.updatedBy = jid.normalize(by);
    this.db.touch();
    return rec;
  }

  setBanned(jidValue, banned, { by = null, reason = '' } = {}) {
    const key = jid.normalize(jidValue);
    if (!key) throw new Error('JID inválido.');
    if (this.isOwner([key])) throw new Error('No se puede banear al OWNER.');
    const rec = this.db.ensure(COLLECTION, key, () => ({ role: 'USER', banned: false }));
    rec.banned = Boolean(banned);
    rec.bannedReason = banned ? String(reason).slice(0, 200) : '';
    rec.updatedAt = new Date().toISOString();
    if (by) rec.updatedBy = jid.normalize(by);
    this.db.touch();
    return rec;
  }
}

module.exports = { PermissionService, ROLES, ASSIGNABLE_ROLES, roleLevel, hasRole };
