'use strict';

const jid = require('../../whatsapp/jid');
const { UserError, progress } = require('../../services/users');
const { plain, bar, ago, dateOnly } = require('../../utils/text');
const { formatNumber, looksLikeUid } = require('../../utils/validators');
const { parseUidAndRegion, linkUid } = require('./linking');
const { playerLines } = require('../freefire/format');

const SNAPSHOT_MAX_AGE_MS = 6 * 3600 * 1000;

function requireUser(ctx) {
  if (!ctx.user) throw new UserError('NOT_REGISTERED', `Aún no estás registrado. Usa *${ctx.prefix}registro* para crear tu perfil.`);
  return ctx.user;
}

/** Refresca la ficha de Free Fire guardada si no existe o es vieja. Si la API falla, se conserva la anterior. */
async function refreshSnapshot({ users, ff }, user) {
  if (!user.ffUid || !ff.configured) return;
  const age = user.ffSnapshot?.fetchedAt ? Date.now() - Date.parse(user.ffSnapshot.fetchedAt) : Infinity;
  if (age < SNAPSHOT_MAX_AGE_MS) return;
  const res = await ff.lookup(user.ffUid, { region: user.ffRegion });
  if (res.ok) {
    users.updateSnapshot([user.jid], {
      region: res.region,
      snapshot: { fetchedAt: new Date(res.fetchedAt || Date.now()).toISOString(), provider: res.provider, data: { ...res.data } },
    });
  }
}

function profileText(user, { prefix }) {
  const p = progress(user);
  const lines = [
    `👤 *${plain(user.name)}*`,
    `📱 ${user.number ? `+${user.number}` : 'Cuenta de WhatsApp'}`,
    `⭐ Nivel ${p.level} · ${formatNumber(user.xp)} XP`,
    p.atMax ? `${bar(100)} nivel máximo` : `${bar(p.percent)} ${p.percent}% (faltan ${formatNumber(p.remaining)} XP)`,
    `🪙 Monedas: ${formatNumber(user.coins)}`,
    `📅 Registrado: ${dateOnly(user.registeredAt)}`,
    `💬 Comandos usados: ${formatNumber(user.activity.commands)}`,
  ];
  lines.push('');
  if (!user.ffUid) {
    lines.push(`🎮 Free Fire: sin vincular. Usa *${prefix}vincular UID*.`);
  } else {
    lines.push(`🎮 *Free Fire* — UID ${user.ffUid}${user.ffRegion ? ` (${user.ffRegion.toUpperCase()})` : ''} ${user.ffVerified ? '✅ verificado' : '⚠️ sin verificar'}`);
    const snap = user.ffSnapshot;
    if (snap?.data) {
      // El UID ya se mostró arriba; el resto son solo los datos que la API entregó.
      const rows = playerLines(snap.data).filter((l) => !l.startsWith('🆔'));
      lines.push(...rows);
      if (snap.fetchedAt) lines.push(`_Datos de la API ${ago(Date.now() - Date.parse(snap.fetchedAt))}_`);
    } else {
      lines.push('No hay datos de la API todavía.');
    }
  }
  return lines.join('\n');
}

function build() {
  return [
    {
      name: 'registro',
      aliases: ['registrar', 'register'],
      description: 'Crea tu perfil en el bot y recibe tu recompensa de bienvenida. Opcionalmente vincula tu UID de Free Fire.',
      usage: 'registro [UID] [REGION]',
      example: 'registro 123456789 sa',
      category: 'usuario',
      permissions: 'USER',
      cooldown: 5,
      async handler(ctx) {
        const { users, ff, config } = ctx.services;
        // Se valida todo ANTES de registrar, para no dejar un registro a medias por un UID mal escrito.
        const wanted = ctx.args[0] ? parseUidAndRegion(ctx.args[0], ctx.args[1], config) : null;

        const result = users.register({ identities: ctx.senderJids, name: ctx.pushName });
        const lines = [];
        if (result.created) {
          lines.push(`✅ ¡Registro completado, *${plain(result.user.name)}*!`);
          if (result.reward) lines.push(`🎁 Recompensa: ${formatNumber(result.reward.coins)} monedas y ${formatNumber(result.reward.xp)} XP.`);
          lines.push(`Usa *${ctx.prefix}perfil* para ver tu perfil y *${ctx.prefix}help* para ver los comandos.`);
        } else {
          lines.push(`Ya estás registrado como *${plain(result.user.name)}*. Usa *${ctx.prefix}perfil* para ver tu perfil.`);
        }
        if (wanted) {
          try {
            lines.push('', await linkUid({ users, ff, config, identities: ctx.senderJids, uid: wanted.uid, region: wanted.region }));
          } catch (err) {
            if (!(err instanceof UserError)) throw err;
            lines.push('', err.message, `Puedes intentarlo de nuevo con *${ctx.prefix}vincular UID*.`);
          }
        } else if (result.created) {
          lines.push(`🎮 Vincula tu Free Fire con *${ctx.prefix}vincular UID*.`);
        }
        return lines.join('\n');
      },
    },
    {
      name: 'vincular',
      aliases: ['link'],
      description: 'Vincula tu UID de Free Fire a tu perfil. Si las APIs lo confirman queda verificado.',
      usage: 'vincular UID [REGION]',
      example: 'vincular 123456789 sa',
      category: 'usuario',
      permissions: 'USER',
      cooldown: 10,
      requiresRegistration: true,
      async handler(ctx) {
        if (!ctx.args[0]) throw new UserError('USAGE', `Uso: *${ctx.prefix}vincular UID [REGION]*\nEjemplo: ${ctx.prefix}vincular 123456789 sa`);
        const { users, ff, config } = ctx.services;
        const { uid, region } = parseUidAndRegion(ctx.args[0], ctx.args[1], config);
        return linkUid({ users, ff, config, identities: ctx.senderJids, uid, region });
      },
    },
    {
      name: 'desvincular',
      aliases: ['unlink'],
      description: 'Quita el UID de Free Fire vinculado a tu perfil.',
      usage: 'desvincular',
      example: 'desvincular',
      category: 'usuario',
      permissions: 'USER',
      cooldown: 5,
      requiresRegistration: true,
      async handler(ctx) {
        const uid = ctx.services.users.unlinkFreeFire(ctx.senderJids);
        return `🔓 Se desvinculó el UID *${uid}* de tu perfil.`;
      },
    },
    {
      name: 'perfil',
      aliases: ['miperfil', 'profile'],
      description: 'Muestra tu perfil o el de otra persona (menciónala o responde a su mensaje). Con un UID consulta ese jugador de Free Fire.',
      usage: 'perfil [@usuario | UID [REGION]]',
      example: 'perfil @usuario',
      category: 'usuario',
      permissions: 'USER',
      cooldown: 5,
      async handler(ctx) {
        const { users, ff } = ctx.services;

        // .perfil UID → ficha de Free Fire de ese UID
        if (ctx.args[0] && looksLikeUid(ctx.args[0]) && ctx.mentions.length === 0) {
          const { uid, region } = parseUidAndRegion(ctx.args[0], ctx.args[1], ctx.config);
          const res = await ff.lookup(uid, { region });
          if (!res.ok) throw new UserError('FF_' + res.kind, `❌ ${res.message}`);
          return ['🎮 *Perfil de Free Fire*', ...playerLines(res.data)].join('\n');
        }

        const targetJid = ctx.mentions[0] || ctx.quotedSender || null;
        let target = ctx.user;
        if (targetJid) {
          target = users.find([targetJid]);
          if (!target) throw new UserError('TARGET_NOT_REGISTERED', `${jid.mentionTag(targetJid)} no está registrado en el bot.`);
        } else {
          requireUser(ctx);
        }
        try {
          await refreshSnapshot({ users, ff }, target);
        } catch (err) {
          ctx.services.logger?.warn('No se pudo refrescar la ficha de Free Fire', err);
        }
        let text = profileText(target, { prefix: ctx.prefix });
        // Parte social (título equipado, insignias, amigos y logros): solo si el servicio existe y hay algo real que mostrar.
        try {
          const social = ctx.services.social;
          if (social) {
            const title = social.equippedTitle(target);
            const badges = social.badges(target).map((b) => b.icon).join(' ');
            const st = social.stats(target);
            const extra = [title ? `🎖️ Título: ${plain(title)}` : null, badges ? `🏅 Insignias: ${badges}` : null, `🤝 Amigos: ${st.friends} · 🏆 Logros: ${st.achievements}/${st.achievementsTotal}`].filter(Boolean);
            text += `\n\n${extra.join('\n')}`;
          }
        } catch (err) {
          ctx.services.logger?.warn('No se pudo añadir la parte social al perfil', err);
        }
        return { text, mentions: targetJid ? [targetJid] : [], actions: targetJid ? null : [{ label: '🪙 Balance', command: `${ctx.prefix}balance` }, { label: '⭐ Nivel', command: `${ctx.prefix}nivel` }, { label: '🏅 Logros', command: `${ctx.prefix}logros` }, { label: '📋 MENÚ', command: `${ctx.prefix}menu` }] };
      },
    },
    {
      name: 'balance',
      aliases: ['monedas', 'saldo'],
      description: 'Muestra tus monedas virtuales (no tienen valor real).',
      usage: 'balance',
      example: 'balance',
      category: 'economia',
      permissions: 'USER',
      cooldown: 3,
      requiresRegistration: true,
      async handler(ctx) {
        const u = requireUser(ctx);
        return { text: `🪙 *Balance de ${plain(u.name)}*\nMonedas: ${formatNumber(u.coins)}\nNivel: ${progress(u).level}`, actions: [{ label: '🏆 Ranking de monedas', command: `${ctx.prefix}ranking monedas` }, { label: '👤 Perfil', command: `${ctx.prefix}perfil` }, { label: '📋 MENÚ', command: `${ctx.prefix}menu` }] };
      },
    },
    {
      name: 'nivel',
      aliases: ['xp', 'level'],
      description: 'Muestra tu nivel, tu XP y lo que falta para subir.',
      usage: 'nivel',
      example: 'nivel',
      category: 'usuario',
      permissions: 'USER',
      cooldown: 3,
      requiresRegistration: true,
      async handler(ctx) {
        const p = progress(requireUser(ctx));
        const lines = [`⭐ *Nivel ${p.level}*`, `✨ XP total: ${formatNumber(p.xp)}`];
        if (p.atMax) lines.push(`${bar(100)} ¡Nivel máximo!`);
        else lines.push(`${bar(p.percent)} ${p.percent}%`, `Faltan ${formatNumber(p.remaining)} XP para el nivel ${p.level + 1}.`);
        return lines.join('\n');
      },
    },
  ];
}

module.exports = { name: 'users', build, profileText };
