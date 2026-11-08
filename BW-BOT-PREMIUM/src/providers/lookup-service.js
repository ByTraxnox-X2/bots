'use strict';

const { FfProvider, FfApiError } = require('./freefire/provider');
const { ProviderHealth } = require('./health');
const { ProviderCache } = require('./cache');
const { ProviderRouter } = require('./router');

const HINT_MAX = 1000;
const HINT_TTL_MS = 24 * 3600 * 1000;
const MAX_REGION_PROBES = 12;
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

class Semaphore {
  constructor(max) {
    this.max = max;
    this.active = 0;
    this.queue = [];
  }

  async run(fn) {
    if (this.active >= this.max) await new Promise((resolve) => this.queue.push(resolve));
    this.active += 1;
    try {
      return await fn();
    } finally {
      this.active -= 1;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

/**
 * ProviderManager genérico: consulta un identificador (UID de jugador o ID de clan) sobre varios proveedores
 * configurables con prioridad, fallback, reintentos acotados, cooldown, cache y fusión de datos entre proveedores.
 * Lo usan Free Fire (jugadores) y los clanes; cada uno aporta su `spec`:
 *   idName / idKey / normalize   cómo se arma la consulta y se interpreta la respuesta
 *   idRegex                      formato válido del identificador
 *   resultKey                    'uid' | 'id'          invalidKind  'INVALID_UID' | 'INVALID_ID'
 *   kind                         'player' | 'clan'      notFoundCode 'PLAYER_NOT_FOUND' | 'CLAN_NOT_FOUND'
 *   coreFields                   campos que, si faltan, justifican consultar otro proveedor para completarlos
 *   messages                     { notConfigured, apiDown, invalid, notFound(where), needRegion }
 *
 * Resultado de lookup():
 *   { ok: true, <resultKey>, region, data, provider, provenance, cached }
 *   { ok: false, kind, code, message, <resultKey>, region, attempts }
 *     kind: NOT_CONFIGURED | NOT_FOUND | REGION_ERROR | API_DOWN | INVALID_*   (compatibilidad)
 *     code: PLAYER_NOT_FOUND | CLAN_NOT_FOUND | API_DOWN | API_TIMEOUT | API_RATE_LIMIT | API_NOT_CONFIGURED |
 *           API_INVALID_RESPONSE | API_AUTH_ERROR | REGION_NOT_SUPPORTED
 *
 * "No encontrado" (la API respondió y no lo tiene) es distinto de "API caída". Nunca inventa datos: `data` solo
 * contiene lo que algún proveedor entregó y `provenance` (interno) dice de qué proveedor salió cada campo.
 */
class ApiLookupService {
  constructor({ cfg, spec, appName = 'BW-BOT', version = '0', fetchImpl = globalThis.fetch, logger = null, now = () => Date.now() }) {
    this.cfg = cfg;
    this.spec = spec;
    this.messages = spec.messages;
    this.logger = logger;
    this.now = now;
    this.sem = new Semaphore(this.cfg.maxConcurrent);
    this.cache = new ProviderCache({ ttlSec: cfg.cacheTtlSec, now });
    this.health = new ProviderHealth({ now });
    this.router = new ProviderRouter({ health: this.health, now });
    this.hints = new Map(); // id -> { region, at }
    this.inflight = new Map();
    this.rl = new Map(); // provider -> [timestamps] (límite propio por proveedor)
    this.sleep = cfg.sleep || sleepMs;

    const userAgent = `${appName.replace(/\s+/g, '-')}/${version}`;
    const common = { apiKey: this.cfg.apiKey, timeoutMs: this.cfg.timeoutMs, fetchImpl, userAgent, idName: spec.idName, idKey: spec.idKey, normalize: spec.normalize, kind: spec.kind || 'player' };
    const named = (cfg.providers || []).map(
      (s, index) => new FfProvider({ ...common, index, template: s.url, apiKey: s.key, spec: s, preset: s.preset || null })
    );
    const legacy = (cfg.apiUrls || []).map(
      (template, index) => new FfProvider({ ...common, index: named.length + index, template })
    );
    const providers = [...named, ...legacy];
    // Si dos APIs comparten nombre, se distinguen con un sufijo para el estado.
    const seen = new Map();
    for (const p of providers) {
      const n = (seen.get(p.name) || 0) + 1;
      seen.set(p.name, n);
      if (n > 1) p.name = `${p.name}#${n}`;
    }
    this.providers = providers;
  }

  get configured() {
    return this.providers.some((p) => p.enabled && !p.misconfigured);
  }

  /** Estado completo de cada proveedor (para ADMIN/OWNER). Nunca incluye URLs completas ni claves. */
  status() {
    const t = this.now();
    return ProviderRouter.sorted(this.providers).map((p) => {
      const s = this.health.snapshot(p);
      let state = 'sin_probar';
      if (!p.enabled) state = 'desactivada';
      else if (p.misconfigured) state = 'sin_configurar';
      else if (s.openUntil > t) state = 'caida';
      else if (s.lastOkAt) state = s.fails > 0 ? 'degradada' : 'ok';
      else if (s.lastError) state = s.fails > 0 ? 'degradada' : 'sin_probar';
      return {
        name: p.name,
        type: p.type,
        priority: p.priority,
        enabled: p.enabled,
        state,
        available: state === 'ok' || state === 'sin_probar' || state === 'degradada',
        lastLatencyMs: s.lastLatencyMs,
        lastError: s.lastError,
        lastErrorCode: s.lastErrorCode,
        lastOkAt: s.lastOkAt,
        lastFailAt: s.lastFailAt,
        lastUsedAt: s.lastUsedAt,
        errorCount: s.errorCount,
        successCount: s.successCount,
        cooldownUntil: s.openUntil > t ? s.openUntil : null,
        limited: s.limited && s.openUntil > t,
        authError: s.authError,
        needsRegion: p.needsRegion,
        regions: p.regions,
        authRequired: p.authRequired,
      };
    });
  }

  /** Resumen para usuarios normales: sin nombres de proveedores, solo si el servicio funciona. */
  summary() {
    const st = this.status().filter((s) => s.enabled && s.state !== 'sin_configurar');
    if (st.length === 0) return { configured: 0, available: 0, level: 'sin_configurar' };
    const available = st.filter((s) => s.available).length;
    const level = available === 0 ? 'caido' : available === st.length && st.every((s) => s.state !== 'degradada') ? 'operativo' : 'parcial';
    return { configured: st.length, available, level };
  }

  /**
   * Consulta un identificador (UID de jugador o ID de clan).
   * @param opts.region  región indicada por el usuario (si no, se usa la guardada, la por defecto o se prueban las regiones configuradas)
   * @param opts.fresh   ignorar la cache
   */
  async lookup(uid, { region = null, fresh = false } = {}) {
    const cleanUid = String(uid ?? '').trim();
    const cleanRegion = region ? String(region).trim().toLowerCase() : null;
    const rk = this.spec.resultKey;
    if (!this.spec.idRegex.test(cleanUid)) return { ok: false, kind: this.spec.invalidKind, code: this.spec.invalidKind, message: this.messages.invalid, [rk]: cleanUid, region: cleanRegion };
    if (!this.configured) {
      return { ok: false, kind: 'NOT_CONFIGURED', code: 'API_NOT_CONFIGURED', message: this.messages.notConfigured, [rk]: cleanUid, region: cleanRegion };
    }

    const key = `${cleanUid}|${cleanRegion || ''}`;
    if (!fresh) {
      const hit = this.cache.get(key);
      if (hit) return { ...hit, cached: true };
    }
    if (this.inflight.has(key)) return { ...(await this.inflight.get(key)) };

    const promise = this._resolve(cleanUid, cleanRegion).then((result) => {
      this.cache.put(key, result);
      return result;
    });
    this.inflight.set(key, promise);
    try {
      return { ...(await promise) };
    } finally {
      this.inflight.delete(key);
    }
  }

  /**
   * Health check: consulta cada proveedor habilitado con un identificador de prueba (FF_HEALTH_UID / CLAN_HEALTH_ID
   * o el indicado) para saber si responde. Un "no encontrado" cuenta como sano (la API contestó). Reincluye al
   * instante a los proveedores que ya se recuperaron.
   */
  async checkHealth({ id = this.cfg.healthUid, region = null } = {}) {
    const probeId = String(id || '').trim();
    if (!probeId || !this.spec.idRegex.test(probeId)) return { checked: 0, reason: 'sin_id_de_prueba' };
    let checked = 0;
    for (const p of this.providers) {
      if (!p.enabled || p.misconfigured) continue;
      const r = region || p.regions[0] || this.cfg.defaultRegion || (p.needsRegion ? null : null);
      if (p.needsRegion && !r) continue;
      checked += 1;
      try {
        const out = await this.sem.run(() => p.fetchPlayer(probeId, r));
        this.health.used(p);
        this.health.ok(p, out.latencyMs);
      } catch (err) {
        this.health.used(p);
        this._markError(p, err && err.kind ? err.kind : 'API_DOWN', err);
      }
    }
    return { checked };
  }

  // ---------- regiones ----------

  _hint(uid) {
    const h = this.hints.get(uid);
    if (!h) return null;
    if (this.now() - h.at > HINT_TTL_MS) {
      this.hints.delete(uid);
      return null;
    }
    return h.region;
  }

  _setHint(uid, region) {
    this.hints.delete(uid);
    this.hints.set(uid, { region, at: this.now() });
    while (this.hints.size > HINT_MAX) this.hints.delete(this.hints.keys().next().value);
  }

  /** Lista ordenada de regiones a intentar (null = sin región). */
  _regionCandidates(uid, region) {
    if (region) return [region];
    const list = [];
    const add = (r) => { if (!list.includes(r)) list.push(r); };
    const hint = this._hint(uid);
    if (hint) add(hint);
    if (this.cfg.defaultRegion) add(this.cfg.defaultRegion);
    if (list.length === 0) add(null);
    for (const r of this.cfg.regions) add(r);
    return list.slice(0, MAX_REGION_PROBES);
  }

  // ---------- resolución ----------

  async _resolve(uid, region) {
    const candidates = this._regionCandidates(uid, region);
    const attempts = [];
    const ctx = { regionlessTried: new Set(), skipped: new Set() };
    const regionsTried = [];

    for (const candidate of candidates) {
      if (candidate) regionsTried.push(candidate);
      const before = attempts.length;
      const ok = await this._tryProviders(uid, candidate, attempts, ctx);
      if (ok) {
        const finalRegion = ok.data.region || candidate || null;
        if (finalRegion) this._setHint(uid, finalRegion);
        const merged = await this._complete(uid, candidate, ok, attempts, ctx);
        Object.freeze(merged.data); // los datos cacheados no deben poder modificarse desde fuera
        return { ok: true, [this.spec.resultKey]: uid, region: finalRegion, data: merged.data, provider: ok.provider, provenance: merged.provenance, cached: false, fetchedAt: this.now() };
      }
      // Si nadie pudo responder en esta región, probar otras no sirve: se corta para no saturar.
      const round = attempts.slice(before);
      if (round.length > 0 && round.every((a) => ['API_DOWN', 'RATE_LIMITED', 'INVALID_RESPONSE'].includes(a.kind))) break;
    }
    return this._failure(uid, region, attempts, ctx, regionsTried);
  }

  /** ¿Se superó el límite propio de consultas por minuto del proveedor? Registra el uso si no. */
  _localLimited(provider) {
    const max = provider.rateLimitPerMin;
    if (!max) return false;
    const t = this.now();
    const arr = (this.rl.get(provider) || []).filter((x) => t - x < 60000);
    if (arr.length >= max) { this.rl.set(provider, arr); return true; }
    arr.push(t);
    this.rl.set(provider, arr);
    return false;
  }

  /** Una consulta a un proveedor con reintentos acotados (solo fallos transitorios: timeout, red, 5xx) y backoff exponencial. */
  async _callWithRetries(provider, uid, region) {
    const retries = provider.retries ?? this.cfg.retries ?? (provider.spec ? 1 : 0);
    for (let attempt = 0; ; attempt += 1) {
      this.health.used(provider);
      try {
        return await this.sem.run(() => provider.fetchPlayer(uid, region));
      } catch (err) {
        const transient = err && err.kind === 'API_DOWN' && !err.auth;
        if (!transient || attempt >= retries) throw err;
        await this.sleep(Math.min(5000, (this.cfg.backoffMs ?? 300) * 2 ** attempt));
      }
    }
  }

  async _tryProviders(uid, region, attempts, ctx) {
    const plan = this.router.plan(this.providers, { region });
    for (const sk of plan.skipped) {
      ctx.skipped.add(sk.reason);
      if (sk.reason === 'region_unsupported') attempts.push({ provider: sk.provider.name, kind: 'REGION_ERROR', code: 'REGION_NOT_SUPPORTED', region, skippedOnly: true });
    }
    for (const provider of plan.pool) {
      // Una API sin {region} tiene la misma URL para cualquier región: se consulta una sola vez por búsqueda.
      if (!provider.needsRegion && ctx.regionlessTried.has(provider)) continue;
      if (this._localLimited(provider)) {
        attempts.push({ provider: provider.name, kind: 'RATE_LIMITED', code: 'API_RATE_LIMIT', region, local: true });
        continue;
      }
      try {
        const out = await this._callWithRetries(provider, uid, region);
        this.health.ok(provider, out.latencyMs);
        if (!provider.needsRegion) ctx.regionlessTried.add(provider);
        return { data: out.data, provider: provider.name, providerObj: provider };
      } catch (err) {
        const kind = err && err.kind ? err.kind : 'API_DOWN';
        this._markError(provider, kind, err);
        attempts.push({ provider: provider.name, kind, code: err && err.code ? err.code : kind, region });
        if (!provider.needsRegion) ctx.regionlessTried.add(provider);
        this.logger?.warn(`${this.spec.logLabel}: ${provider.name} → ${kind}${err && err.detail ? ` (${err.detail})` : ''}`);
      }
    }
    return null;
  }

  /**
   * Fusión segura entre proveedores: si el primero no entregó campos "núcleo", se consultan hasta `mergeMax`
   * proveedores más y SOLO se añaden los campos que faltan (nunca se pisa un dato ya obtenido ni se inventa).
   * `provenance` indica de qué proveedor salió cada campo.
   */
  async _complete(uid, region, first, attempts, ctx) {
    const data = { ...first.data };
    const provenance = {};
    for (const k of Object.keys(data)) provenance[k] = first.provider;
    const core = this.spec.coreFields || [];
    const missing = () => core.filter((f) => data[f] === undefined);
    if (!this.cfg.merge || !core.length || missing().length === 0) return { data, provenance };

    const plan = this.router.plan(this.providers, { region });
    let extra = 0;
    for (const provider of plan.pool) {
      if (extra >= (this.cfg.mergeMax ?? 2) || missing().length === 0) break;
      if (provider === first.providerObj || this.health.isOpen(provider)) continue;
      if (!provider.needsRegion && ctx.regionlessTried.has(provider)) continue;
      if (this._localLimited(provider)) continue;
      extra += 1;
      try {
        const out = await this._callWithRetries(provider, uid, region);
        this.health.ok(provider, out.latencyMs);
        if (!provider.needsRegion) ctx.regionlessTried.add(provider);
        for (const [k, v] of Object.entries(out.data)) {
          if (data[k] === undefined) { data[k] = v; provenance[k] = provider.name; }
        }
      } catch (err) {
        this._markError(provider, err && err.kind ? err.kind : 'API_DOWN', err);
        attempts.push({ provider: provider.name, kind: err && err.kind ? err.kind : 'API_DOWN', code: err && err.code, region, merge: true });
      }
    }
    return { data, provenance };
  }

  _markError(provider, kind, err) {
    this.health.fail(provider, kind, err, { retryAfterSec: err && err.retryAfterSec });
  }

  _failure(uid, region, attempts, ctx, regionsTried) {
    const pub = attempts.map((a) => ({ provider: a.provider, kind: a.kind, code: a.code }));
    const base = { ok: false, [this.spec.resultKey]: uid, region, attempts: pub, regionsTried };
    const real = attempts.filter((a) => !a.skippedOnly && !a.merge);
    const kinds = real.map((a) => a.kind);
    const hasNotFound = kinds.includes('NOT_FOUND');
    const hasRegionError = kinds.includes('REGION_ERROR');
    const hasDown = kinds.some((k) => ['API_DOWN', 'RATE_LIMITED', 'INVALID_RESPONSE'].includes(k));

    if (real.length === 0) {
      if (ctx.skipped.has('region_unsupported') && !ctx.skipped.has('no_region')) {
        return { ...base, kind: 'REGION_ERROR', code: 'REGION_NOT_SUPPORTED', message: `Ninguna API configurada atiende la región${region ? ` "${region}"` : ''}.` };
      }
      if (ctx.skipped.has('no_region') || ctx.skipped.has('region_unsupported')) {
        return { ...base, kind: 'REGION_ERROR', code: 'REGION_NOT_SUPPORTED', needRegion: true, message: this.messages.needRegion };
      }
      return { ...base, kind: 'NOT_CONFIGURED', code: 'API_NOT_CONFIGURED', message: this.messages.notConfigured };
    }
    if (hasNotFound) {
      const partial = hasDown;
      const where = regionsTried.length > 1 ? ` en las regiones probadas (${regionsTried.join(', ')})` : region ? ` en la región ${region}` : '';
      return {
        ...base,
        kind: 'NOT_FOUND',
        code: this.spec.notFoundCode || 'NOT_FOUND',
        partial,
        message: `${this.messages.notFound(where)}${partial ? ' Algunas APIs no respondieron, así que el resultado podría no ser definitivo.' : ''}`,
      };
    }
    if (hasRegionError && !hasDown) {
      return { ...base, kind: 'REGION_ERROR', code: 'REGION_NOT_SUPPORTED', message: `La región${region ? ` "${region}"` : ''} no es válida para esa consulta.` };
    }
    if (hasRegionError) {
      return { ...base, kind: 'REGION_ERROR', code: 'REGION_NOT_SUPPORTED', message: `La región${region ? ` "${region}"` : ''} no fue aceptada y otras APIs no respondieron.` };
    }
    const codes = real.map((a) => a.code);
    const all = (c) => codes.every((x) => x === c);
    const code = all('API_AUTH_ERROR') ? 'API_AUTH_ERROR' : all('API_RATE_LIMIT') ? 'API_RATE_LIMIT' : all('API_TIMEOUT') ? 'API_TIMEOUT' : all('API_INVALID_RESPONSE') ? 'API_INVALID_RESPONSE' : 'API_DOWN';
    return { ...base, kind: 'API_DOWN', code, message: this.messages.apiDown };
  }
}

ApiLookupService.ProviderManager = ApiLookupService;
module.exports = { ApiLookupService, ProviderManager: ApiLookupService, Semaphore };
