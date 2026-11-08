'use strict';

const { CATEGORIES } = require('./registry');

const SCOPE_TEXT = { any: 'grupo y privado', group: 'solo grupos', private: 'solo privado' };
const esc = (t) => String(t).replace(/\|/g, '\\|');

/** Genera COMMANDS.md a partir del registro central (única fuente de verdad). Es determinista. */
function generateCommandsDoc(registry, prefix = '.') {
  const out = [];
  out.push('# Comandos de BW BOT PREMIUM', '');
  out.push('> Archivo generado automáticamente desde el registro de comandos (`npm run docs:commands`).');
  out.push('> No lo edites a mano: `npm run check` falla si no coincide con el código.', '');
  out.push(`Prefijo por defecto: \`${prefix}\` (configurable con \`BOT_PREFIX\`). Total de comandos: **${registry.size}**.`, '');
  out.push('Roles de menor a mayor: USER < MOD < ADMIN < SUPERADMIN < OWNER. Un rol superior puede usar los comandos de los inferiores.', '');
  const byCat = registry.byCategory();
  for (const cat of CATEGORIES) {
    const list = byCat[cat];
    if (!list) continue;
    out.push(`## ${cat}`, '');
    out.push('| Comando | Alias | Permiso | Espera | Alcance | Descripción | Uso | Ejemplo |');
    out.push('|---|---|---|---|---|---|---|---|');
    for (const d of list) {
      out.push(
        `| \`${prefix}${d.name}\` | ${d.aliases.length ? d.aliases.map((a) => `\`${prefix}${a}\``).join(' ') : '—'} | ${d.permissions} | ${d.cooldown} s | ${SCOPE_TEXT[d.scope]}${d.requiresRegistration ? ', requiere registro' : ''} | ${esc(d.description)} | \`${prefix}${esc(d.usage)}\` | \`${prefix}${esc(d.example)}\` |`
      );
    }
    out.push('');
    for (const d of list.filter((x) => x.subcommands.length)) {
      out.push(`### Subcomandos de \`${prefix}${d.name}\``, '');
      out.push('| Subcomando | Alias | Permiso | Con argumentos | Descripción | Uso |');
      out.push('|---|---|---|---|---|---|');
      for (const sub of d.subcommands) {
        out.push(
          `| \`${prefix}${d.name} ${sub.name}\` | ${sub.aliases.length ? sub.aliases.map((a) => `\`${a}\``).join(' ') : '—'} | ${sub.permissions}${sub.requiresRegistration ? ' + registro' : ''} | ${sub.permissionsWithArgs || '—'} | ${esc(sub.description)} | \`${prefix}${esc(sub.usage)}\` |`
        );
      }
      out.push('');
    }
  }
  return out.join('\n');
}

module.exports = { generateCommandsDoc };
