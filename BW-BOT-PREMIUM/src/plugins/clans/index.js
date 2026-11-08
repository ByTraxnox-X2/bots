'use strict';

const jid = require('../../whatsapp/jid');
const { UserError } = require('../../services/users');
const { CONFIG_KEYS } = require('../../services/clans');
const { plain, dateOnly } = require('../../utils/text');
const { formatNumber, parseInteger, parseRegion } = require('../../utils/validators');
const { CLAN_ID_RE } = require('../../providers/clans/service');
const { clanLines, snapshotNote, roleText, NO_CLAN_TEXT } = require('./format');

const MEMBERS_PER_PAGE = 15;

function parseClanId(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return { ok: false, error: 'Debes indicar el ID del clan.' };
  if (!/^\d+$/.test(raw)) return { ok: false, error: 'El ID del clan solo puede contener números.' };
  if (!CLAN_ID_RE.test(raw)) return { ok: false, error: 'El ID del clan debe tener entre 3 y 15 dígitos.' };
  return { ok: true, value: raw };
}

function idAndRegion(idText, regionText, cfg) {
  const id = parseClanId(idText);
  if (!id.ok) throw new UserError('INVALID_ID', id.error);
  let region = null;
  if (regionText) {
    const r = parseRegion(regionText, cfg.clan.regions);
    if (!r.ok) throw new UserError('INVALID_REGION', r.error);
    region = r.value;
  }
  return { id: id.value, region };
}

/** Clan del grupo o error con la explicación estándar de "clan no verificado". */
function requireGroupClan(ctx) {
  const clan = ctx.services.clans.clanOfGroup(ctx.chatJid);
  if (!clan) throw new UserError('NO_CLAN', NO_CLAN_TEXT);
  return clan;
}

/** Vuelve a consultar la API si la ficha guardada es vieja. Si falla se conserva la anterior (sin inventar nada). */
async function refreshIfStale({ clans, clanApi, config }, clan) {
  if (!clanApi.configured) return clan;
  if (clans.snapshotAgeMs(clan) < config.clan.refreshHours * 3600 * 1000) return clan;
  try {
    const res = await clanApi.lookup(clan.id, { region: clan.region });
    if (res.ok) clans.updateSnapshot(clan.id, res);
  } catch (err) {
    clans.logger?.warn('No se pudo refrescar el clan', err);
  }
  return clan;
}

function apiFailure(res) {
  const icon = res.kind === 'NOT_FOUND' ? '🔎' : '⚠️';
  return new UserError(`CLAN_${res.kind}`, `${icon} ${res.message}`);
}

function build() {
  return [
    {
      name: 'verificarclan',
      aliases: ['verifyclan'],
      description: 'Asocia este grupo a un clan de Free Fire comprobando su ID en las APIs configuradas. No hace falta indicar región.',
      usage: 'verificarclan IDCLAN [REGION]',
      example: 'verificarclan 1234567',
      category: 'clanes',
      permissions: 'ADMIN',
      cooldown: 15,
      scope: 'group',
      async handler(ctx) {
        const { clans, clanApi, config, bus } = ctx.services;
        if (!ctx.args[0]) throw new UserError('USAGE', `Uso: *${ctx.prefix}verificarclan IDCLAN*\nEjemplo: ${ctx.prefix}verificarclan 1234567`);
        const { id, region } = idAndRegion(ctx.args[0], ctx.args[1], config);
        clans.checkVerifiable(ctx.chatJid, id);

        const res = await clanApi.lookup(id, { region });
        if (!res.ok) {
          if (res.kind === 'NOT_FOUND' && !res.partial) throw new UserError('CLAN_NOT_FOUND', `❌ ${res.message}`);
          if (res.kind === 'REGION_ERROR') throw new UserError('CLAN_REGION', `❌ ${res.message}`);
          // Verificar exige una confirmación real: sin API disponible no se verifica nada.
          throw new UserError('CLAN_UNVERIFIABLE', `⚠️ No pude verificar el clan.\n${res.message}`);
        }
        const { clan, restored } = clans.verify({ groupJid: ctx.chatJid, clanId: id, by: ctx.sender, res });
        const lines = [`✅ *Clan verificado*${restored ? ' (se restauró su configuración anterior)' : ''}`, '', ...clanLines(clan), '', `Usa *${ctx.prefix}menu* para ver las funciones del grupo.`];
        return lines.join('\n');
      },
    },
    {
      name: 'desverificarclan',
      aliases: ['unverifyclan'],
      description: 'Quita la verificación del clan de este grupo. La configuración, reglas e historial se conservan por si se vuelve a verificar.',
      usage: 'desverificarclan',
      example: 'desverificarclan',
      category: 'clanes',
      permissions: 'ADMIN',
      cooldown: 10,
      scope: 'group',
      async handler(ctx) {
        const clan = ctx.services.clans.unverify(ctx.chatJid, ctx.sender);
        return `🔓 Se quitó la verificación del clan *${plain(clan.name || clan.id)}* (ID ${clan.id}) en este grupo.`;
      },
    },
    {
      name: 'clan',
      aliases: ['claninfo', 'clanperfil'],
      description: 'Muestra el clan verificado de este grupo. Con un ID consulta cualquier clan en las APIs configuradas.',
      usage: 'clan [IDCLAN] [REGION]',
      example: 'clan',
      category: 'clanes',
      permissions: 'USER',
      cooldown: 5,
      async handler(ctx) {
        const { clans, clanApi, config } = ctx.services;
        if (ctx.args[0]) {
          const { id, region } = idAndRegion(ctx.args[0], ctx.args[1], config);
          const res = await clanApi.lookup(id, { region });
          if (!res.ok) throw apiFailure(res);
          const view = { id, region: res.region, name: res.data.name, description: '', snapshot: { data: res.data } };
          return ['⚔️ *Consulta de clan*', ...clanLines(view, { full: true }), '', `_Fuente: ${res.provider}${res.cached ? ' (en cache)' : ''}_`].join('\n');
        }
        if (!ctx.isGroup) throw new UserError('USAGE', `Úsalo en un grupo con clan verificado, o indica un ID: *${ctx.prefix}clan IDCLAN*`);
        const clan = await refreshIfStale(ctx.services, requireGroupClan(ctx));
        return [...clanLines(clan, { full: true }), `📅 Verificado: ${dateOnly(clan.verifiedAt)}`, '', snapshotNote(clan)].filter((l) => l !== null).join('\n');
      },
    },
    {
      name: 'clanmiembros',
      aliases: ['miembrosclan'],
      description: 'Lista los miembros del clan según la API (solo si la API configurada entrega la lista).',
      usage: 'clanmiembros [pagina]',
      example: 'clanmiembros 2',
      category: 'clanes',
      permissions: 'USER',
      cooldown: 5,
      scope: 'group',
      async handler(ctx) {
        const clan = await refreshIfStale(ctx.services, requireGroupClan(ctx));
        const members = clan.snapshot?.data?.members;
        if (!members || members.length === 0) {
          return 'ℹ️ La API configurada no entrega la lista de miembros del clan, así que no puedo mostrarla.';
        }
        const pages = Math.ceil(members.length / MEMBERS_PER_PAGE);
        let page = 1;
        if (ctx.args[0]) {
          const p = parseInteger(ctx.args[0], { min: 1, max: pages, label: 'La página' });
          if (!p.ok) throw new UserError('BAD_PAGE', p.error);
          page = p.value;
        }
        const slice = members.slice((page - 1) * MEMBERS_PER_PAGE, page * MEMBERS_PER_PAGE);
        const rows = slice.map((m, i) => {
          const n = (page - 1) * MEMBERS_PER_PAGE + i + 1;
          const parts = [m.nickname !== undefined ? plain(m.nickname) : `UID ${m.uid}`];
          if (m.level !== undefined) parts.push(`nivel ${m.level}`);
          if (m.role !== undefined) parts.push(roleText(m.role));
          return `${n}. ${parts.join(' · ')}`;
        });
        return [`👥 *Miembros de ${plain(clan.name || clan.id)}* (${members.length})`, '', ...rows, '', pages > 1 ? `Página ${page}/${pages} · *${ctx.prefix}clanmiembros ${Math.min(page + 1, pages)}*` : '', snapshotNote(clan)]
          .filter((l) => l !== null)
          .join('\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
      },
    },
    {
      name: 'clanlider',
      aliases: ['lider'],
      description: 'Muestra el líder del clan según la API (solo si la API configurada lo entrega).',
      usage: 'clanlider',
      example: 'clanlider',
      category: 'clanes',
      permissions: 'USER',
      cooldown: 5,
      scope: 'group',
      async handler(ctx) {
        const clan = await refreshIfStale(ctx.services, requireGroupClan(ctx));
        const leader = clan.snapshot?.data?.leader;
        if (!leader) return 'ℹ️ La API configurada no entrega el líder del clan, así que no puedo mostrarlo.';
        const lines = [`👑 *Líder de ${plain(clan.name || clan.id)}*`];
        if (leader.nickname !== undefined) lines.push(`👤 Nick: ${plain(leader.nickname)}`);
        if (leader.uid !== undefined) lines.push(`🆔 UID: ${leader.uid}`);
        if (leader.level !== undefined) lines.push(`⭐ Nivel: ${formatNumber(leader.level)}`);
        return lines.join('\n');
      },
    },
    {
      name: 'clanstats',
      aliases: ['clanestadisticas', 'clannivel', 'clanxp'],
      description: 'Estadísticas del clan que entrega la API: nivel, puntuación, miembros y fecha de creación (solo los datos disponibles).',
      usage: 'clanstats',
      example: 'clanstats',
      category: 'clanes',
      permissions: 'USER',
      cooldown: 5,
      scope: 'group',
      async handler(ctx) {
        const clan = await refreshIfStale(ctx.services, requireGroupClan(ctx));
        const d = clan.snapshot?.data || {};
        const lines = [`📊 *Estadísticas de ${plain(clan.name || clan.id)}*`];
        if (d.level !== undefined) lines.push(`⭐ Nivel: ${formatNumber(d.level)}`);
        if (d.score !== undefined) lines.push(`🏆 Puntuación: ${formatNumber(d.score)}`);
        if (d.memberCount !== undefined) lines.push(`👥 Miembros: ${formatNumber(d.memberCount)}${d.capacity !== undefined ? `/${formatNumber(d.capacity)}` : ''}`);
        if (d.createdAt) lines.push(`📅 Creado: ${dateOnly(d.createdAt)}`);
        if (lines.length === 1) return 'ℹ️ La API configurada no entregó estadísticas de este clan.';
        const note = snapshotNote(clan);
        if (note) lines.push('', note);
        return lines.join('\n');
      },
    },
    {
      name: 'clanconfig',
      aliases: ['configclan'],
      description: 'Muestra la configuración del clan de este grupo (GDC, hora, recordatorio, honor). Los administradores la cambian con setclan.',
      usage: 'clanconfig',
      example: 'clanconfig',
      category: 'clanes',
      permissions: 'USER',
      cooldown: 5,
      scope: 'group',
      async handler(ctx) {
        const clan = requireGroupClan(ctx);
        const rows = ctx.services.clans.configLines(clan).map((l) => `• ${l.label}: *${l.shown}*  (${ctx.prefix}setclan ${l.alias} …)`);
        return [`⚙️ *Configuración de ${plain(clan.name || clan.id)}*`, '', ...rows, '', '🏷️ Placas obligatorias y escuadras de 4 jugadores: fijas.', `Zona horaria: ${ctx.config.timezone}`].join('\n');
      },
    },
    {
      name: 'setclan',
      aliases: ['clanset'],
      description: 'Cambia una opción del clan de este grupo: gdc, hora, recordatorio, honor, honorrequerido.',
      usage: 'setclan opción valor',
      example: 'setclan honorrequerido 100',
      category: 'clanes',
      permissions: 'ADMIN',
      cooldown: 3,
      scope: 'group',
      async handler(ctx) {
        const clan = requireGroupClan(ctx);
        if (ctx.args.length < 2) {
          const help = Object.entries(CONFIG_KEYS).map(([alias, d]) => `• ${alias}: ${d.help}`);
          throw new UserError('USAGE', [`Uso: *${ctx.prefix}setclan opción valor*`, '', ...help].join('\n'));
        }
        const r = ctx.services.clans.setConfig(clan, ctx.args[0], ctx.args.slice(1).join(' '), ctx.sender);
        return `✅ ${r.label}: *${r.shown}*`;
      },
    },
    {
      name: 'clanreglas',
      aliases: ['reglasclan'],
      description: 'Muestra las reglas del clan de este grupo. Los administradores las cambian con setclanreglas.',
      usage: 'clanreglas',
      example: 'clanreglas',
      category: 'clanes',
      permissions: 'USER',
      cooldown: 5,
      scope: 'group',
      async handler(ctx) {
        const clan = requireGroupClan(ctx);
        if (!clan.rules) return `📖 El clan aún no tiene reglas.\nUn administrador puede definirlas con *${ctx.prefix}setclanreglas texto*.`;
        return `📖 *Reglas de ${plain(clan.name || clan.id)}*\n\n${clan.rules}`;
      },
    },
    {
      name: 'setclanreglas',
      aliases: [],
      description: 'Define las reglas del clan de este grupo (hasta 600 caracteres). Con "borrar" las elimina.',
      usage: 'setclanreglas texto | borrar',
      example: 'setclanreglas Respeto y puntualidad en la GDC',
      category: 'clanes',
      permissions: 'ADMIN',
      cooldown: 5,
      scope: 'group',
      async handler(ctx) {
        const clan = requireGroupClan(ctx);
        // Se usa el texto original (con saltos de línea) y no los argumentos ya separados.
        const raw = ctx.text.trim().slice(ctx.prefix.length).replace(/^\S+\s*/, '');
        if (!raw) throw new UserError('USAGE', `Uso: *${ctx.prefix}setclanreglas texto* (o *borrar*)`);
        if (raw.length > 600) throw new UserError('TOO_LONG', 'Las reglas pueden tener como máximo 600 caracteres.');
        const clean = ctx.services.clans.setRules(clan, raw.toLowerCase() === 'borrar' ? '' : raw, ctx.sender);
        return clean ? '✅ Reglas actualizadas.' : '🗑️ Reglas borradas.';
      },
    },
    {
      name: 'clandesc',
      aliases: ['descclan'],
      description: 'Muestra la descripción del clan (la definida por los administradores o, si no hay, la de la API).',
      usage: 'clandesc',
      example: 'clandesc',
      category: 'clanes',
      permissions: 'USER',
      cooldown: 5,
      scope: 'group',
      async handler(ctx) {
        const clan = requireGroupClan(ctx);
        const desc = clan.description || clan.snapshot?.data?.description;
        if (!desc) return `ℹ️ El clan no tiene descripción.\nUn administrador puede definirla con *${ctx.prefix}setclandesc texto*.`;
        return `📝 *${plain(clan.name || clan.id)}*\n${plain(desc)}`;
      },
    },
    {
      name: 'setclandesc',
      aliases: [],
      description: 'Define la descripción del clan de este grupo (hasta 200 caracteres). Con "borrar" la elimina.',
      usage: 'setclandesc texto | borrar',
      example: 'setclandesc Clan competitivo de Ecuador',
      category: 'clanes',
      permissions: 'ADMIN',
      cooldown: 5,
      scope: 'group',
      async handler(ctx) {
        const clan = requireGroupClan(ctx);
        const raw = ctx.argText;
        if (!raw) throw new UserError('USAGE', `Uso: *${ctx.prefix}setclandesc texto* (o *borrar*)`);
        if (raw.length > 200) throw new UserError('TOO_LONG', 'La descripción puede tener como máximo 200 caracteres.');
        const clean = ctx.services.clans.setDescription(clan, raw.toLowerCase() === 'borrar' ? '' : raw, ctx.sender);
        return clean ? '✅ Descripción actualizada.' : '🗑️ Descripción borrada.';
      },
    },
    {
      name: 'clanhistorial',
      aliases: ['clanlog'],
      description: 'Historial de cambios del clan de este grupo (verificación, configuración, reglas). Solo administradores.',
      usage: 'clanhistorial [cantidad]',
      example: 'clanhistorial 5',
      category: 'clanes',
      permissions: 'ADMIN',
      cooldown: 5,
      scope: 'group',
      async handler(ctx) {
        const clan = requireGroupClan(ctx);
        let n = 10;
        if (ctx.args[0]) {
          const p = parseInteger(ctx.args[0], { min: 1, max: 30, label: 'La cantidad' });
          if (!p.ok) throw new UserError('BAD_NUMBER', p.error);
          n = p.value;
        }
        const entries = ctx.services.clans.history(clan, n);
        if (entries.length === 0) return 'No hay movimientos registrados.';
        const rows = entries.map((e) => `• ${e.at.slice(0, 16).replace('T', ' ')} UTC — ${e.action}${e.detail ? `: ${plain(e.detail)}` : ''}${e.by ? ` (${jid.mentionTag(e.by)})` : ''}`);
        return [`🗂️ *Historial de ${plain(clan.name || clan.id)}*`, '', ...rows].join('\n');
      },
    },
    {
      name: 'topclanes',
      aliases: ['clantop', 'clanranking'],
      description: 'Ranking de los clanes verificados en este bot, por nivel (según los datos de la API).',
      usage: 'topclanes',
      example: 'topclanes',
      category: 'clanes',
      permissions: 'USER',
      cooldown: 10,
      async handler(ctx) {
        const list = ctx.services.clans.ranking().slice(0, 10);
        if (list.length === 0) return 'ℹ️ Todavía no hay clanes verificados con nivel conocido para armar un ranking.';
        const medals = ['🥇', '🥈', '🥉'];
        const rows = list.map((c, i) => `${medals[i] || `${i + 1}.`} ${plain(c.name)} — nivel ${formatNumber(c.level)}${c.score !== undefined ? ` · ${formatNumber(c.score)} pts` : ''}${c.memberCount !== undefined ? ` · ${c.memberCount} miembros` : ''}`);
        return ['🏆 *Top clanes verificados*', '', ...rows].join('\n');
      },
    },
    {
      name: 'clancomparar',
      aliases: ['clanversus', 'clancompare'],
      description: 'Compara dos clanes con los datos de la API. Con un solo ID compara el clan de este grupo contra ese.',
      usage: 'clancomparar ID1 [ID2]',
      example: 'clancomparar 1234567 7654321',
      category: 'clanes',
      permissions: 'USER',
      cooldown: 10,
      async handler(ctx) {
        const { clans, clanApi, config } = ctx.services;
        let idA;
        let idB;
        if (ctx.args.length >= 2) {
          idA = idAndRegion(ctx.args[0], null, config).id;
          idB = idAndRegion(ctx.args[1], null, config).id;
        } else if (ctx.args.length === 1) {
          const mine = ctx.isGroup ? clans.clanOfGroup(ctx.chatJid) : null;
          if (!mine) throw new UserError('USAGE', `Indica dos IDs: *${ctx.prefix}clancomparar ID1 ID2* (o usa el comando en un grupo con clan verificado).`);
          idA = mine.id;
          idB = idAndRegion(ctx.args[0], null, config).id;
        } else {
          throw new UserError('USAGE', `Uso: *${ctx.prefix}clancomparar ID1 [ID2]*`);
        }
        if (idA === idB) throw new UserError('SAME', 'Indica dos clanes distintos.');
        const [a, b] = await Promise.all([clanApi.lookup(idA), clanApi.lookup(idB)]);
        if (!a.ok) throw apiFailure(a);
        if (!b.ok) throw apiFailure(b);
        const da = a.data;
        const db = b.data;
        const rows = [];
        const cmp = (label, x, y, fmt = formatNumber) => {
          if (x === undefined || y === undefined) return;
          rows.push(`${label}: ${fmt(x)}  vs  ${fmt(y)}${x === y ? '' : x > y ? '  ◀' : '  ▶'}`);
        };
        cmp('⭐ Nivel', da.level, db.level);
        cmp('🏆 Puntuación', da.score, db.score);
        cmp('👥 Miembros', da.memberCount, db.memberCount);
        const head = [`⚔️ *Comparación de clanes*`, `A: ${plain(da.name || idA)} (${idA})`, `B: ${plain(db.name || idB)} (${idB})`, ''];
        if (rows.length === 0) return [...head, 'Las APIs no entregaron datos comparables de ambos clanes.'].join('\n');
        return [...head, ...rows].join('\n');
      },
    },
  ];
}

module.exports = { name: 'clans', build, parseClanId, requireGroupClan, refreshIfStale };
