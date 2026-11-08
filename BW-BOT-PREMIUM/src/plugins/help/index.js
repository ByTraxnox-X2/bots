'use strict';

const { CATEGORIES } = require('../../commands/registry');
const { hasRole } = require('../../middleware/permissions');
const nav = require('../nav');

const CATEGORY_LABELS = {
  general: '📌 General',
  usuario: '👤 Usuario',
  freefire: '🎮 Free Fire',
  clanes: '🛡️ Clanes',
  gdc: '⚔️ GDC',
  equipos: '👥 Equipos',
  torneos: '🏆 Torneos',
  scrims: '🎯 Scrims',
  juegos: '🎲 Juegos',
  economia: '🪙 Economía',
  social: '💬 Social',
  ranking: '📊 Ranking',
  mercado: '🛒 Mercado',
  tools: '🧰 Herramientas',
  play: '🎵 Play',
  moderacion: '🔨 Moderación',
  admin: '🛠️ Admin',
  owner: '👑 Owner',
};

const label = (c) => CATEGORY_LABELS[c] || c;

function build() {
  return [
    {
      name: 'help',
      aliases: ['ayuda', 'comandos'],
      description: 'Lista las categorías de comandos, los comandos de una categoría o el detalle de un comando.',
      usage: 'help [categoría | comando]',
      example: 'help perfil',
      category: 'general',
      permissions: 'USER',
      cooldown: 0, // navegación: los botones vuelven a abrirlo; el límite por usuario sigue aplicando
      async handler(ctx) {
        const { registry } = ctx;
        const p = ctx.prefix;
        const role = (await ctx.getRole()).role;
        // El menú solo muestra lo que la persona puede usar; la validación real está en el dispatcher.
        const visible = registry.list().filter((d) => hasRole(role, d.permissions));
        const query = (ctx.args[0] || '').toLowerCase().replace(p, '');

        if (!query) {
          const byCat = {};
          for (const d of visible) (byCat[d.category] ||= []).push(d);
          const lines = ['📖 *BW BOT PREMIUM — Ayuda*', ''];
          for (const c of CATEGORIES) {
            if (byCat[c]) lines.push(`${label(c)} — ${byCat[c].length} comando${byCat[c].length === 1 ? '' : 's'}  → *${p}help ${c}*`);
          }
          lines.push('', `Detalle de un comando: *${p}help comando*`);
          const actions = CATEGORIES.filter((c) => byCat[c]).slice(0, 14).map((c) => ({ label: label(c), command: `${p}help ${c}` }));
          return { text: lines.join('\n'), actions };
        }

        if (CATEGORIES.includes(query)) {
          const list = visible.filter((d) => d.category === query);
          if (list.length === 0) return `No hay comandos disponibles para ti en la categoría *${query}*.`;
          return { text: [`${label(query)}`, '', ...list.map((d) => `• *${p}${d.name}* — ${d.description.split('. ')[0].replace(/\.$/, '')}`)].join('\n'), actions: nav.categoryActions(ctx, query, visible) };
        }

        const def = registry.get(query);
        if (def && hasRole(role, def.permissions)) {
          return [
            `📘 *${p}${def.name}*`,
            def.description,
            '',
            `Uso: ${p}${def.usage}`,
            `Ejemplo: ${p}${def.example}`,
            def.aliases.length ? `Alias: ${def.aliases.map((a) => p + a).join(', ')}` : null,
            `Permiso: ${def.permissions}`,
            `Espera entre usos: ${def.cooldown} s`,
            def.scope !== 'any' ? `Solo en: ${def.scope === 'group' ? 'grupos' : 'chat privado'}` : null,
            ...(def.subcommands.length
              ? ['', 'Subcomandos:', ...def.subcommands.filter((sc) => hasRole(role, sc.permissions)).map((sc) => `• ${p}${sc.usage} — ${sc.description.split('. ')[0].replace(/\.$/, '')}`)]
              : []),
          ]
            .filter((l) => l !== null)
            .join('\n');
        }
        return `No encontré la categoría ni el comando "${query}". Usa *${p}help* para ver la lista.`;
      },
    },
  ];
}

module.exports = { name: 'help', build, CATEGORY_LABELS };
