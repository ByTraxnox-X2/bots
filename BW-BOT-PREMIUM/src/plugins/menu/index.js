'use strict';

const jid = require('../../whatsapp/jid');
const { CATEGORIES } = require('../../commands/registry');
const { hasRole } = require('../../middleware/permissions');
const { progress } = require('../../services/users');
const { plain } = require('../../utils/text');
const { formatNumber } = require('../../utils/validators');
const { clanLines, NO_CLAN_TEXT } = require('../clans/format');
const { CATEGORY_LABELS } = require('../help');
const nav = require('../nav');

const INLINE_MAX = 8; // categorías con más comandos que esto se muestran solo con su conteo

const label = (c) => CATEGORY_LABELS[c] || c;

function userBlock(ctx, role) {
  const u = ctx.user;
  if (!u) return [`👤 *Tú*`, `⚠️ No estás registrado. Usa *${ctx.prefix}registro* para crear tu perfil.`, `Rol: ${role}`];
  const p = progress(u);
  return ['👤 *Tú*', `${plain(u.name)} · nivel ${p.level} · ${formatNumber(u.coins)} monedas`, `Rol: ${role}`];
}

function clanBlock(ctx) {
  if (!ctx.isGroup) return ['⚔️ *Clan*', `Los comandos de clan se usan en el grupo del clan. Consulta cualquier clan con *${ctx.prefix}clan IDCLAN*.`];
  const { clans, gdc } = ctx.services;
  const clan = clans.clanOfGroup(ctx.chatJid);
  if (!clan) {
    return ['⚔️ *Clan del grupo*', NO_CLAN_TEXT];
  }
  const cfg = clan.config;
  const lines = ['⚔️ *Clan del grupo*', ...clanLines(clan)];
  lines.push(`⚙️ GDC ${cfg.gdcEnabled ? `activada a las ${cfg.gdcTime} (${ctx.config.timezone}), aviso ${cfg.reminderMinutes} min antes` : 'desactivada'} · Honor ${cfg.honorEnabled ? `activado (requerido ${cfg.honorRequired})` : 'desactivado'}`);
  // El estado real de la GDC lo aporta su módulo (si está instalado); aquí nunca se inventa.
  const extra = typeof gdc?.menuLines === 'function' ? gdc.menuLines(clan, ctx) : [];
  if (Array.isArray(extra)) lines.push(...extra);
  return lines;
}

function build() {
  return [
    {
      name: 'menu',
      aliases: ['inicio'],
      description: 'Menú del bot según tu usuario, el grupo, su clan y tus permisos. Con una categoría lista sus comandos.',
      usage: 'menu [categoría]',
      example: 'menu clanes',
      category: 'general',
      permissions: 'USER',
      cooldown: 0, // navegación: los botones vuelven a abrirlo; el límite por usuario sigue aplicando
      async handler(ctx) {
        const p = ctx.prefix;
        const role = (await ctx.getRole()).role;
        const visible = ctx.registry.list().filter((d) => hasRole(role, d.permissions));
        const byCat = {};
        for (const d of visible) (byCat[d.category] ||= []).push(d);

        const query = (ctx.args[0] || '').toLowerCase();
        if (query) {
          const section = nav.sectionById(query);
          const cats = section ? section.cats.filter((c) => byCat[c]) : CATEGORIES.includes(query) && byCat[query] ? [query] : [];
          const sectionHidden = section && section.id === 'gdc' && !nav.visibleSections(ctx, visible).some((s) => s.id === 'gdc');
          if (!cats.length || sectionHidden) {
            return `No hay una categoría "${query}" disponible para ti. Usa *${p}menu* para ver las categorías.`;
          }
          const rows = cats.flatMap((c) => byCat[c]).map((d) => {
            const subs = d.subcommands.filter((sc) => hasRole(role, sc.permissions));
            const head = `• *${p}${d.usage}*\n   ${d.description.split('. ')[0].replace(/\.$/, '')}`;
            return subs.length ? `${head}\n   Subcomandos: ${subs.map((sc) => sc.name).join(', ')} → *${p}${d.name} ayuda*` : head;
          });
          const head = section ? section.label : label(query);
          const extra = [];
          if (section && section.id === 'gdc') extra.push(...clanBlock(ctx), '');
          if (section && section.id === 'perfil') extra.push(...userBlock(ctx, role), '');
          const actions = section ? nav.sectionActions(ctx, section, visible) : nav.categoryActions(ctx, query, visible).map((a) => (/AYUDA/.test(a.label) ? { label: '⬅️ MENÚ', command: `${p}menu` } : a));
          return { text: [head, '', ...extra, ...rows].join('\n'), actions };
        }

        const tag = jid.mentionTag(ctx.sender);
        const lines = ['📋 *BW BOT PREMIUM — MENÚ*', `Hola ${tag} 👋`, ''];
        lines.push(...userBlock(ctx, role), '');
        lines.push(...clanBlock(ctx), '');
        lines.push('📚 *Comandos disponibles para ti*');
        for (const c of CATEGORIES) {
          const list = byCat[c];
          if (!list) continue;
          if (list.length <= INLINE_MAX) lines.push(`${label(c)}: ${list.map((d) => p + d.name).join(' ')}`);
          else lines.push(`${label(c)}: ${list.length} comandos → *${p}menu ${c}*`);
        }
        lines.push('', `Detalle de un comando: *${p}help comando*`, `📲 Elige una sección:`);
        return { text: lines.join('\n'), mentions: [ctx.sender], actions: nav.mainActions(ctx, visible) };
      },
    },
  ];
}

module.exports = { name: 'menu', build };
