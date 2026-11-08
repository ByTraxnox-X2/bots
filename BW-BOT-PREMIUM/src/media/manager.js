'use strict';

const { MediaProvider, MediaError } = require('./provider');
const { ProviderHealth } = require('./health');

function hostName(template) {
  try {
    return new URL(template.replace(/\{[a-z]+\}/g, 'x')).hostname || 'proveedor';
  } catch {
    return 'proveedor';
  }
}

/** Reúne los proveedores configurados, respeta su salud y hace fallback entre ellos. */
class ProviderManager {
  constructor({ config, fetchImpl = globalThis.fetch, now = () => Date.now(), logger = null }) {
    this.cfg = config.play;
    this.logger = logger;
    this.health = new ProviderHealth({ now });
    const templates = [...new Set([...this.cfg.apiUrls, ...this.cfg.searchUrls, ...this.cfg.downloadUrls])];
    const used = new Map();
    this.providers = templates.map((template, i) => {
      const base = hostName(template);
      const n = (used.get(base) || 0) + 1;
      used.set(base, n);
      const p = new MediaProvider({ template, name: n > 1 ? `${base}#${n}` : base, apiKey: this.cfg.apiKeys[i] || this.cfg.apiKeys[0] || '', timeoutMs: this.cfg.timeoutMs, fetchImpl });
      p.priority = 1000 + i;
      p.enabled = true;
      return p;
    });
    // Proveedores nombrados (MEDIA_PROVIDER_n_* / MEDIA_PROVIDERS): con prioridad, activación, clave y tiempo propios.
    const named = (this.cfg.providers || []).map((s) => {
      const p = new MediaProvider({ template: s.url, name: s.name, apiKey: s.key, timeoutMs: s.timeoutMs || this.cfg.timeoutMs, fetchImpl });
      p.priority = s.priority;
      p.enabled = s.enabled;
      return p;
    });
    this.providers = [...named, ...this.providers];
    this.providers.sort((a, b) => a.priority - b.priority);
  }

  get configured() {
    return this.providers.some((p) => p.enabled && !p.misconfigured && (p.canSearch || p.canDownload));
  }

  get canSearch() {
    return this.providers.some((p) => p.enabled && !p.misconfigured && p.canSearch);
  }

  get canDownload() {
    return this.providers.some((p) => p.enabled && !p.misconfigured && p.canDownload);
  }

  /** Proveedores usables, los sanos primero (los de circuito abierto se omiten). `prefer` va el primero si puede. */
  candidates(capability, prefer = null) {
    const list = this.providers.filter((p) => p.enabled && !p.misconfigured && (capability === 'search' ? p.canSearch : p.canDownload) && !this.health.isOpen(p.name));
    if (prefer) list.sort((a, b) => (b.name === prefer) - (a.name === prefer));
    return list;
  }

  /** Busca con fallback: devuelve { items, provider } con el primer proveedor que tenga resultados. */
  async search(query, { type = 'all', limit = 8, signal } = {}) {
    const list = this.candidates('search');
    if (!list.length) throw new MediaError(this.canSearch ? 'API_DOWN' : 'NOT_CONFIGURED', this.canSearch ? 'todos los proveedores de búsqueda están caídos' : 'no hay proveedores de búsqueda configurados');
    const attempts = [];
    let sawEmpty = false;
    for (const p of list) {
      const t0 = Date.now();
      try {
        const items = await p.search(query, { type, limit, signal });
        this.health.ok(p.name, Date.now() - t0);
        if (items.length) return { items, provider: p.name, attempts };
        sawEmpty = true;
        attempts.push({ provider: p.name, kind: 'NOT_FOUND' });
      } catch (err) {
        const kind = err instanceof MediaError ? err.kind : 'API_DOWN';
        this.health.fail(p.name, kind, err.detail || err.message);
        attempts.push({ provider: p.name, kind });
        this.logger?.warn?.(`Proveedor de búsqueda ${p.name} falló (${kind})`);
        if (kind === 'TIMEOUT') throw err;
      }
    }
    if (sawEmpty) throw Object.assign(new MediaError('NOT_FOUND', 'sin resultados'), { attempts });
    throw Object.assign(new MediaError('API_DOWN', 'ningún proveedor respondió'), { attempts });
  }

  status() {
    return this.providers.map((p) => {
      const h = this.health.snapshot(p.name);
      const state = !p.enabled ? 'desactivada' : p.misconfigured ? 'sin_configurar' : h.state;
      return {
        name: p.name,
        type: 'media',
        priority: p.priority,
        enabled: p.enabled,
        state,
        available: state === 'ok' || state === 'sin_probar' || state === 'degradada',
        lastLatencyMs: h.lastLatencyMs,
        lastError: h.lastError,
        successCount: h.ok,
        errorCount: h.failed,
        authRequired: p.needsKey,
        caps: [p.canSearch ? 'búsqueda' : null, p.canDownload ? 'descarga' : null].filter(Boolean).join('+'),
      };
    });
  }

  summary() {
    const st = this.status().filter((s) => s.enabled && s.state !== 'sin_configurar');
    if (!st.length) return { configured: 0, available: 0, level: 'sin_configurar' };
    const available = st.filter((s) => s.available).length;
    return { configured: st.length, available, level: available === 0 ? 'caido' : st.every((s) => s.state === 'ok' || s.state === 'sin_probar') ? 'operativo' : 'parcial' };
  }

  /** Health check: busca MEDIA_HEALTH_QUERY en cada proveedor con búsqueda. Un "sin resultados" cuenta como sano. */
  async checkHealth({ query = this.cfg.healthQuery } = {}) {
    if (!query) return { checked: 0 };
    let checked = 0;
    for (const p of this.providers) {
      if (!p.enabled || p.misconfigured || !p.canSearch) continue;
      checked += 1;
      const t0 = Date.now();
      try {
        await p.search(query, { limit: 1 });
        this.health.ok(p.name, Date.now() - t0);
      } catch (err) {
        this.health.fail(p.name, err instanceof MediaError ? err.kind : 'API_DOWN', err.detail || err.message);
      }
    }
    return { checked };
  }
}

module.exports = { ProviderManager };
