'use strict';

/**
 * ProviderRouter: decide qué proveedores consultar y en qué orden para una región.
 *  - descarta desactivados y mal configurados (sin clave);
 *  - ordena por prioridad (menor número = antes; estable);
 *  - omite los que no soportan la región pedida (REGION_NOT_SUPPORTED) y los que exigen región cuando no hay;
 *  - pone al final los que están en cooldown; si TODOS lo están, se intentan igualmente (mejor intentar que rendirse).
 */
class ProviderRouter {
  constructor({ health, now = () => Date.now() }) {
    this.health = health;
    this.now = now;
  }

  static sorted(providers) {
    return providers.map((p, i) => ({ p, i })).sort((a, b) => (a.p.priority - b.p.priority) || (a.i - b.i)).map((x) => x.p);
  }

  /** @returns { pool: Provider[], skipped: [{provider, reason}] } */
  plan(providers, { region = null } = {}) {
    const skipped = [];
    const usable = [];
    for (const p of ProviderRouter.sorted(providers)) {
      if (!p.enabled) continue;
      if (p.misconfigured) continue;
      if (!region && p.needsRegion) { skipped.push({ provider: p, reason: 'no_region' }); continue; }
      if (region && !p.supportsRegion(region)) { skipped.push({ provider: p, reason: 'region_unsupported' }); continue; }
      usable.push(p);
    }
    const t = this.now();
    const healthy = usable.filter((p) => !this.health.isOpen(p, t));
    const pool = healthy.length ? healthy : usable;
    return { pool, skipped, usable };
  }
}

module.exports = { ProviderRouter };
