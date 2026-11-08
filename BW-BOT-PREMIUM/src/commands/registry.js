'use strict';

const { ROLES } = require('../middleware/permissions');

const CATEGORIES = Object.freeze([
  'general',
  'usuario',
  'freefire',
  'clanes',
  'gdc',
  'equipos',
  'torneos',
  'scrims',
  'juegos',
  'economia',
  'social',
  'ranking',
  'mercado',
  'tools',
  'play',
  'moderacion',
  'admin',
  'owner',
]);

const SCOPES = Object.freeze(['any', 'group', 'private']);
const NAME_RE = /^[a-z0-9]{1,30}$/;

/**
 * Valida una definición de comando. Devuelve la lista de errores (vacía si es válida).
 * Cada comando debe declarar: name, aliases, description, usage, example, category,
 * permissions, cooldown y handler.
 */
function validateDefinition(def) {
  const errors = [];
  const label = def && def.name ? `Comando "${def.name}"` : 'Comando sin nombre';
  if (!def || typeof def !== 'object') return ['La definición del comando debe ser un objeto.'];

  if (typeof def.name !== 'string' || !NAME_RE.test(def.name)) {
    errors.push(`${label}: el nombre debe ser minúsculas/números (1-30), sin prefijo ni espacios.`);
  }
  if (def.aliases !== undefined && !Array.isArray(def.aliases)) {
    errors.push(`${label}: aliases debe ser una lista.`);
  } else {
    for (const a of def.aliases || []) {
      if (typeof a !== 'string' || !NAME_RE.test(a)) errors.push(`${label}: alias inválido "${a}".`);
      if (a === def.name) errors.push(`${label}: el alias "${a}" repite el nombre del comando.`);
    }
    if (new Set(def.aliases || []).size !== (def.aliases || []).length) {
      errors.push(`${label}: aliases repetidos.`);
    }
  }
  for (const field of ['description', 'usage', 'example']) {
    if (typeof def[field] !== 'string' || def[field].trim().length < 3) {
      errors.push(`${label}: falta ${field}.`);
    }
  }
  if (!CATEGORIES.includes(def.category)) {
    errors.push(`${label}: categoría inválida "${def.category}". Usa: ${CATEGORIES.join(', ')}.`);
  }
  if (!ROLES.includes(def.permissions)) {
    errors.push(`${label}: permissions inválido "${def.permissions}". Usa: ${ROLES.join(', ')}.`);
  }
  if (!Number.isFinite(def.cooldown) || def.cooldown < 0 || def.cooldown > 86400) {
    errors.push(`${label}: cooldown debe ser un número de segundos entre 0 y 86400.`);
  }
  if (typeof def.handler !== 'function') {
    errors.push(`${label}: falta el handler (función).`);
  }
  if (def.scope !== undefined && !SCOPES.includes(def.scope)) {
    errors.push(`${label}: scope inválido "${def.scope}". Usa: ${SCOPES.join(', ')}.`);
  }
  if (def.requiresRegistration !== undefined && typeof def.requiresRegistration !== 'boolean') {
    errors.push(`${label}: requiresRegistration debe ser booleano.`);
  }
  if (def.subcommands !== undefined) errors.push(...validateSubcommands(def, label));
  return errors;
}

/**
 * Subcomandos (p. ej. ".gdc crear"). Cada uno declara SU PROPIO permiso y handler: el dispatcher los valida
 * antes de ejecutar, igual que un comando normal, así que un subcomando nunca queda sin implementar ni sin permiso.
 *  - permissions: rol mínimo del subcomando
 *  - permissionsWithArgs: rol mínimo cuando se escriben argumentos (p. ej. ".gdc honor" lo ve cualquiera, ".gdc honor 100" solo ADMIN)
 */
function validateSubcommands(def, label) {
  const errors = [];
  if (!Array.isArray(def.subcommands) || def.subcommands.length === 0) {
    return [`${label}: subcommands debe ser una lista no vacía.`];
  }
  const seen = new Set();
  for (const sub of def.subcommands) {
    const sl = `${label} → subcomando "${sub && sub.name}"`;
    if (!sub || typeof sub !== 'object') {
      errors.push(`${label}: subcomando inválido.`);
      continue;
    }
    if (typeof sub.name !== 'string' || !NAME_RE.test(sub.name)) errors.push(`${sl}: nombre inválido.`);
    for (const a of sub.aliases || []) if (typeof a !== 'string' || !NAME_RE.test(a)) errors.push(`${sl}: alias inválido "${a}".`);
    for (const k of [sub.name, ...(sub.aliases || [])]) {
      if (seen.has(k)) errors.push(`${sl}: "${k}" está repetido dentro del comando.`);
      seen.add(k);
    }
    for (const field of ['description', 'usage']) {
      if (typeof sub[field] !== 'string' || sub[field].trim().length < 3) errors.push(`${sl}: falta ${field}.`);
    }
    if (!ROLES.includes(sub.permissions)) errors.push(`${sl}: permissions inválido.`);
    else if (ROLES.includes(def.permissions) && ROLES.indexOf(sub.permissions) < ROLES.indexOf(def.permissions)) {
      errors.push(`${sl}: no puede exigir menos permiso que el comando principal (${def.permissions}).`);
    }
    if (sub.permissionsWithArgs !== undefined) {
      if (!ROLES.includes(sub.permissionsWithArgs)) errors.push(`${sl}: permissionsWithArgs inválido.`);
      else if (ROLES.includes(sub.permissions) && ROLES.indexOf(sub.permissionsWithArgs) < ROLES.indexOf(sub.permissions)) {
        errors.push(`${sl}: permissionsWithArgs no puede ser menor que permissions.`);
      }
    }
    if (typeof sub.handler !== 'function') errors.push(`${sl}: falta el handler (función).`);
    if (sub.scope !== undefined && !SCOPES.includes(sub.scope)) errors.push(`${sl}: scope inválido.`);
    if (sub.requiresRegistration !== undefined && typeof sub.requiresRegistration !== 'boolean') errors.push(`${sl}: requiresRegistration debe ser booleano.`);
  }
  return errors;
}

/**
 * Registro central de comandos. Es la única fuente de verdad: el dispatcher, .help,
 * COMMANDS.md y los scripts de verificación leen de aquí.
 */
class CommandRegistry {
  constructor() {
    this.commands = new Map(); // name -> def
    this.index = new Map(); // name | alias -> name
  }

  register(def) {
    const errors = validateDefinition(def);
    if (errors.length) throw new Error(errors.join(' '));

    const keys = [def.name, ...(def.aliases || [])];
    for (const key of keys) {
      if (this.index.has(key)) {
        throw new Error(`Conflicto: "${key}" (comando "${def.name}") ya está registrado por "${this.index.get(key)}".`);
      }
    }
    const normalized = Object.freeze({
      name: def.name,
      aliases: Object.freeze([...(def.aliases || [])]),
      description: def.description.trim(),
      usage: def.usage.trim(),
      example: def.example.trim(),
      category: def.category,
      permissions: def.permissions,
      cooldown: def.cooldown,
      scope: def.scope || 'any',
      requiresRegistration: def.requiresRegistration === true,
      handler: def.handler,
      subcommands: Object.freeze(
        (def.subcommands || []).map((sub) =>
          Object.freeze({
            name: sub.name,
            aliases: Object.freeze([...(sub.aliases || [])]),
            description: sub.description.trim(),
            usage: sub.usage.trim(),
            permissions: sub.permissions,
            permissionsWithArgs: sub.permissionsWithArgs || null,
            scope: sub.scope || def.scope || 'any',
            requiresRegistration: sub.requiresRegistration === undefined ? def.requiresRegistration === true : sub.requiresRegistration,
            handler: sub.handler,
          })
        )
      ),
    });
    this.commands.set(normalized.name, normalized);
    for (const key of keys) this.index.set(key, normalized.name);
    return normalized;
  }

  registerAll(defs) {
    for (const def of defs) this.register(def);
    return this;
  }

  /** Busca un subcomando por nombre o alias dentro de un comando ya registrado. */
  static findSub(def, word) {
    const w = String(word || '').toLowerCase();
    if (!w || !def || !def.subcommands.length) return null;
    return def.subcommands.find((s) => s.name === w || s.aliases.includes(w)) || null;
  }

  /** Busca por nombre o alias (sin prefijo, sin importar mayúsculas). */
  get(nameOrAlias) {
    const name = this.index.get(String(nameOrAlias || '').toLowerCase());
    return name ? this.commands.get(name) : null;
  }

  has(nameOrAlias) {
    return this.get(nameOrAlias) !== null;
  }

  list() {
    return [...this.commands.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  byCategory() {
    const out = {};
    for (const def of this.list()) (out[def.category] ||= []).push(def);
    return out;
  }

  get size() {
    return this.commands.size;
  }
}

module.exports = { CommandRegistry, validateDefinition, CATEGORIES, SCOPES };
