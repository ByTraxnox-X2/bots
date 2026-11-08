'use strict';

const { UserError } = require('../../services/users');
const { parseMode } = require('../../services/teams');
const { plain } = require('../../utils/text');
const { formatNumber } = require('../../utils/validators');
const { targetJid } = require('../shared');

const E = (ctx) => ctx.services.elo;
const usage = (ctx, text) => new UserError('USAGE', `Uso: *${ctx.prefix}${text}*`);
const MEDALS = ['🥇', '🥈', '🥉'];
const place = (i) => MEDALS[i] || `${i + 1}.`;
const pname = (ctx, j) => plain(ctx.services.users.find([j])?.name || 'Jugador');
const tname = (ctx, id) => plain(ctx.services.teams.db.get('teams', id)?.name || id);
const pct = (w, n) => (n ? Math.round((w / n) * 100) : 0);
const sign = (n) => (n > 0 ? `+${n}` : String(n));
const RESULT_ICON = { win: '✅', loss: '❌', draw: '➖' };

/** Jugador objetivo: mención/cita, o el propio. Debe estar registrado. */
function playerArg(ctx, { required = false } = {}) {
  const t = targetJid(ctx);
  const u = t ? ctx.services.users.find([t]) : ctx.user;
  if (t && !u) throw new UserError('TARGET_NOT_REGISTERED', 'Esa persona no está registrada en el bot.');
  if (!u && required) throw usage(ctx, 'comparar jugador @a [@b]');
  if (!u) throw new UserError('NOT_REGISTERED', `Primero regístrate con *${ctx.prefix}registro* o menciona a otra persona.`);
  return u;
}

function eloCard(ctx, u) {
  const r = E(ctx).player(u.jid);
  const pos = E(ctx).position(u.jid);
  const s = E(ctx).season();
  return [
    `📈 *ELO de ${plain(u.name)}* — ${formatNumber(r.elo)}${pos ? ` (#${pos})` : ' (sin clasificar)'}`,
    `Pico: ${formatNumber(r.peak)} · Partidas: ${r.matches} · ${r.wins}V ${r.losses}D ${r.draws}E · ${pct(r.wins, r.matches)}% victorias`,
    `Temporada ${s.number}: ${r.season.matches} partidas · ${r.season.wins}V ${r.season.losses}D ${r.season.draws}E · ${sign(r.season.gain)} ELO`,
    r.matches === 0 ? 'Aún no tiene partidas puntuables: el ELO empieza en 1000 y cambia con resultados reales de partidas, scrims y torneos.' : null,
  ]
    .filter(Boolean)
    .join('\n');
}

function topList(ctx, title, rows) {
  if (!rows.length) return `ℹ️ Todavía no hay datos para ${title.toLowerCase()}.`;
  return [`🏆 *${title}*`, '', ...rows.map((r, i) => `${place(i)} ${r}`)].join('\n');
}

// ---------- .elo ----------

const eloSubs = [
  {
    name: 'historial',
    aliases: ['history'],
    description: 'Últimos cambios de ELO de un jugador (resultado, rival, variación y ELO resultante).',
    usage: 'elo historial [@usuario]',
    permissions: 'USER',
    async handler(ctx) {
      const u = playerArg(ctx);
      const r = E(ctx).player(u.jid);
      if (!r.history.length) return `ℹ️ ${plain(u.name)} todavía no tiene partidas en su historial de ELO.`;
      const rows = r.history
        .slice(-10)
        .reverse()
        .map((h) => `${RESULT_ICON[h.result]} ${h.at.slice(0, 10)} vs ${tname(ctx, h.opp)} — ${h.rated ? sign(h.delta) : 'sin puntos (límite diario contra el mismo rival)'} → ${formatNumber(h.elo)} · ${h.match}`);
      return [`📜 *Historial de ELO de ${plain(u.name)}* (últimas ${rows.length})`, ...rows].join('\n');
    },
  },
];

// ---------- .ranking ----------

const rankingSubs = [
  {
    name: 'elo',
    aliases: ['jugadores'],
    description: 'Top de jugadores por ELO (solo jugadores registrados con partidas puntuables).',
    usage: 'ranking elo',
    permissions: 'USER',
    async handler(ctx) {
      const s = E(ctx).season();
      return topList(ctx, `Top ELO — temporada ${s.number}`, E(ctx).rankPlayers(10).map((p) => `${pname(ctx, p.jid)} — ${formatNumber(p.elo)} ELO · ${p.wins}V ${p.losses}D`));
    },
  },
  {
    name: 'victorias',
    aliases: ['wins'],
    description: 'Top de jugadores por victorias en partidas de equipo.',
    usage: 'ranking victorias',
    permissions: 'USER',
    async handler(ctx) {
      return topList(ctx, 'Top victorias', E(ctx).topUsers('victorias').map((u) => `${plain(u.name)} — ${u.value} victorias de ${u.matches} partidas`));
    },
  },
  {
    name: 'xp',
    description: 'Top de jugadores por experiencia (XP).',
    usage: 'ranking xp',
    permissions: 'USER',
    async handler(ctx) {
      return topList(ctx, 'Top XP', E(ctx).topUsers('xp').map((u) => `${plain(u.name)} — ${formatNumber(u.value)} XP`));
    },
  },
  {
    name: 'niveles',
    aliases: ['nivel', 'levels'],
    description: 'Top de jugadores por nivel (desempata por XP).',
    usage: 'ranking niveles',
    permissions: 'USER',
    async handler(ctx) {
      return topList(ctx, 'Top niveles', E(ctx).topUsers('niveles').map((u) => `${plain(u.name)} — nivel ${u.value} (${formatNumber(u.xp)} XP)`));
    },
  },
  {
    name: 'monedas',
    aliases: ['coins'],
    description: 'Top de jugadores por monedas virtuales.',
    usage: 'ranking monedas',
    permissions: 'USER',
    async handler(ctx) {
      return topList(ctx, 'Top monedas', E(ctx).topUsers('monedas').map((u) => `${plain(u.name)} — ${formatNumber(u.value)} 🪙`));
    },
  },
  {
    name: 'juegos',
    aliases: ['games'],
    description: 'Top de ganadores de juegos interactivos; con un juego concreto, solo de ese juego.',
    usage: 'ranking juegos [juego]',
    permissions: 'USER',
    async handler(ctx) {
      const type = ctx.args[0] ? ctx.args[0].toLowerCase() : null;
      if (type && !/^[a-z0-9]{2,20}$/.test(type)) throw new UserError('BAD_GAME', `Nombre de juego no válido. Mira la lista con *${ctx.prefix}juegos*.`);
      return topList(ctx, type ? `Top ${type}` : 'Top juegos', E(ctx).topGames(type).map((r) => `${plain(r.user.name)} — ${r.wins} victorias de ${r.played} partidas`));
    },
  },
  {
    name: 'equipos',
    aliases: ['teams'],
    description: 'Top de equipos por ELO; opcionalmente de una modalidad (2v2, 4v4 o 6v6).',
    usage: 'ranking equipos [modo]',
    permissions: 'USER',
    async handler(ctx) {
      const mode = ctx.args[0] ? parseMode(ctx.args[0]) : null;
      if (ctx.args[0] && !mode) throw new UserError('BAD_MODE', 'La modalidad debe ser 2v2, 4v4 o 6v6.');
      return topList(ctx, `Top equipos${mode ? ` ${mode}` : ''}`, E(ctx).rankTeams({ mode }).map((t) => `${plain(t.name)} (${t.mode}) — ${formatNumber(t.elo)} ELO · ${t.wins}V ${t.losses}D ${t.draws}E`));
    },
  },
  {
    name: 'clanes',
    aliases: ['clans'],
    description: 'Top de clanes por ELO medio de sus equipos con partidas jugadas.',
    usage: 'ranking clanes',
    permissions: 'USER',
    async handler(ctx) {
      return topList(ctx, 'Top clanes (ELO medio de sus equipos)', E(ctx).rankClans().map((c) => `${plain(c.name)} — ${formatNumber(c.elo)} ELO · ${c.teams} equipos · ${c.wins}V ${c.losses}D`));
    },
  },
];

// ---------- .comparar ----------

const compareSubs = [
  {
    name: 'jugador',
    aliases: ['jugadores', 'player'],
    description: 'Compara el ELO y las estadísticas de dos jugadores (@a y @b; con uno solo te compara contigo).',
    usage: 'comparar jugador @a [@b]',
    permissions: 'USER',
    async handler(ctx) {
      const found = ctx.mentions.map((j) => ctx.services.users.find([j])).filter(Boolean);
      if (ctx.mentions.length && found.length !== ctx.mentions.length) throw new UserError('TARGET_NOT_REGISTERED', 'Alguna de las personas no está registrada en el bot.');
      let [a, b] = found;
      if (!b) {
        b = a;
        a = ctx.user;
      }
      if (!a || !b) throw usage(ctx, 'comparar jugador @a [@b]');
      if (a.jid === b.jid) throw new UserError('SAME', 'Elige a dos personas distintas.');
      const ra = E(ctx).player(a.jid);
      const rb = E(ctx).player(b.jid);
      const line = (label, x, y) => `• ${label}: ${x} — ${y}`;
      return [
        `⚔️ *${plain(a.name)}* vs *${plain(b.name)}*`,
        line('ELO', formatNumber(ra.elo), formatNumber(rb.elo)),
        line('Pico', formatNumber(ra.peak), formatNumber(rb.peak)),
        line('Partidas', ra.matches, rb.matches),
        line('Victorias', `${ra.wins} (${pct(ra.wins, ra.matches)}%)`, `${rb.wins} (${pct(rb.wins, rb.matches)}%)`),
        line('Nivel', a.level, b.level),
        line('XP', formatNumber(a.xp), formatNumber(b.xp)),
        line('Monedas', formatNumber(a.coins), formatNumber(b.coins)),
        ra.elo === rb.elo ? '🤝 Igualados en ELO.' : `📈 Mayor ELO: ${plain(ra.elo > rb.elo ? a.name : b.name)} (${formatNumber(Math.abs(ra.elo - rb.elo))} de diferencia).`,
      ].join('\n');
    },
  },
  {
    name: 'perfil',
    aliases: ['perfiles', 'profile'],
    description: 'Compara los perfiles de dos jugadores: título, logros, medallas, insignias, amigos y estadísticas generales.',
    usage: 'comparar perfil @a [@b]',
    permissions: 'USER',
    async handler(ctx) {
      const found = ctx.mentions.map((j) => ctx.services.users.find([j])).filter(Boolean);
      if (ctx.mentions.length && found.length !== ctx.mentions.length) throw new UserError('TARGET_NOT_REGISTERED', 'Alguna de las personas no está registrada en el bot.');
      let [a, b] = found;
      if (!b) {
        b = a;
        a = ctx.user;
      }
      if (!a || !b) throw usage(ctx, 'comparar perfil @a [@b]');
      if (a.jid === b.jid) throw new UserError('SAME', 'Elige a dos personas distintas.');
      const social = ctx.services.social;
      const sa = social.stats(a);
      const sb = social.stats(b);
      const line = (label, x, y) => `• ${label}: ${x} — ${y}`;
      return [
        `🆚 *${plain(a.name)}* vs *${plain(b.name)}*`,
        line('Título', plain(social.equippedTitle(a) || '—'), plain(social.equippedTitle(b) || '—')),
        line('Nivel', a.level, b.level),
        line('Logros', `${sa.achievements}/${sa.achievementsTotal}`, `${sb.achievements}/${sb.achievementsTotal}`),
        line('Medallas', social.medals(a).length, social.medals(b).length),
        line('Insignias', social.badges(a).length, social.badges(b).length),
        line('Amigos', sa.friends, sb.friends),
        line('Torneos ganados', sa.champion, sb.champion),
        line('ELO', formatNumber(sa.elo.elo), formatNumber(sb.elo.elo)),
        line('Victorias en juegos', sa.games.wins, sb.games.wins),
      ].join('\n');
    },
  },
  {
    name: 'equipo',
    aliases: ['equipos', 'team'],
    description: 'Compara dos equipos (ELO, récord y enfrentamientos directos). Con uno solo lo compara con el tuyo.',
    usage: 'comparar equipo ID1 [ID2]',
    permissions: 'USER',
    async handler(ctx) {
      if (!ctx.args.length) throw usage(ctx, 'comparar equipo ID1 [ID2]');
      const teams = ctx.services.teams;
      let a;
      let b;
      if (ctx.args.length >= 2) {
        a = teams.require(ctx.args[0]);
        b = teams.require(ctx.args.slice(1).join(' '));
      } else {
        b = teams.require(ctx.args[0]);
        a = ctx.user ? teams.ownTeam(ctx.user, b.mode) : null;
        if (!a) throw usage(ctx, 'comparar equipo ID1 ID2');
      }
      if (a.id === b.id) throw new UserError('SAME', 'Elige dos equipos distintos.');
      const ra = E(ctx).team(a.id);
      const rb = E(ctx).team(b.id);
      const h2h = ctx.services.matches.headToHead(a.id, b.id);
      const line = (label, x, y) => `• ${label}: ${x} — ${y}`;
      return [
        `⚔️ *${plain(a.name)}* (${a.mode}) vs *${plain(b.name)}* (${b.mode})`,
        line('ELO', formatNumber(ra.elo), formatNumber(rb.elo)),
        line('Partidas', ra.matches, rb.matches),
        line('Récord', `${ra.wins}V ${ra.losses}D ${ra.draws}E`, `${rb.wins}V ${rb.losses}D ${rb.draws}E`),
        line('% victorias', `${pct(ra.wins, ra.matches)}%`, `${pct(rb.wins, rb.matches)}%`),
        line('Racha', a.stats.streak, b.stats.streak),
        h2h.played ? `🤼 Cara a cara: ${plain(a.name)} ${h2h[a.id]} — ${h2h[b.id]} ${plain(b.name)} (${h2h.played} partidas, ${h2h.draws} empates)` : '🤼 Todavía no se han enfrentado.',
      ].join('\n');
    },
  },
];

// ---------- .temporada ----------

const seasonSubs = [
  {
    name: 'historial',
    aliases: ['pasadas', 'history'],
    description: 'Temporadas cerradas con su podio de jugadores y equipos.',
    usage: 'temporada historial',
    permissions: 'USER',
    async handler(ctx) {
      const list = E(ctx).seasons().slice(-5).reverse();
      if (!list.length) return 'ℹ️ Todavía no se ha cerrado ninguna temporada.';
      return [
        '📚 *Temporadas cerradas*',
        ...list.map((s) => {
          const p = s.players.slice(0, 3).map((x, i) => `${MEDALS[i]} ${pname(ctx, x.jid)} (${formatNumber(x.elo)})`).join(' ');
          const t = s.teams[0] ? ` · Mejor equipo: ${plain(s.teams[0].name)} (${formatNumber(s.teams[0].elo)})` : '';
          return `• Temporada ${s.number} (${s.startedAt.slice(0, 10)} → ${s.closedAt.slice(0, 10)}): ${p || 'sin partidas puntuables'}${t}`;
        }),
      ].join('\n');
    },
  },
  {
    name: 'cerrar',
    aliases: ['close'],
    description: 'Cierra la temporada actual: guarda el podio, reparte monedas virtuales a los primeros, aplica el reinicio suave de ELO e inicia la siguiente.',
    usage: 'temporada cerrar',
    permissions: 'SUPERADMIN',
    async handler(ctx) {
      const s = E(ctx).closeSeason(ctx.user || { jid: ctx.sender });
      const podium = s.players.slice(0, 3).map((x, i) => `${MEDALS[i]} ${pname(ctx, x.jid)} (${formatNumber(x.elo)} ELO)`);
      return [
        `🏁 *Temporada ${s.number} cerrada.* Empieza la temporada ${s.number + 1} (el ELO se reinicia al ${ctx.config.elo.softResetPercent}% de distancia respecto a 1000).`,
        podium.length ? `Podio: ${podium.join(' · ')}` : 'No hubo partidas puntuables esta temporada.',
        s.rewards.length ? `Premios: ${s.rewards.map((r) => `${MEDALS[r.place - 1] || r.place} ${formatNumber(r.coins)} 🪙`).join(' · ')}` : null,
      ]
        .filter(Boolean)
        .join('\n');
    },
  },
];

function build() {
  return [
    {
      name: 'elo',
      aliases: ['rating'],
      description: 'Tu ELO competitivo (o el de otra persona mencionada): puntuación, pico, récord, posición y temporada.',
      usage: 'elo [@usuario]',
      example: 'elo',
      category: 'ranking',
      permissions: 'USER',
      cooldown: 3,
      subcommands: eloSubs,
      async handler(ctx) {
        return eloCard(ctx, playerArg(ctx));
      },
    },
    {
      name: 'ranking',
      aliases: ['top', 'tops'],
      description: 'Clasificaciones: ELO, victorias, XP, niveles, monedas, juegos, equipos y clanes.',
      usage: 'ranking [clasificación]',
      example: 'ranking elo',
      category: 'ranking',
      permissions: 'USER',
      cooldown: 4,
      subcommands: rankingSubs,
      async handler(ctx) {
        if (ctx.args.length) throw new UserError('UNKNOWN_SUB', `Clasificación desconocida "${plain(ctx.args[0])}". Usa *${ctx.prefix}help ranking*.`);
        return { text: ['🏆 *Clasificaciones disponibles*', ...rankingSubs.map((s) => `• ${ctx.prefix}${s.usage} — ${s.description}`)].join('\n'), actions: [...rankingSubs.slice(0, 10).map((s) => ({ label: `📊 ${s.name}`, command: `${ctx.prefix}ranking ${s.name}` })), { label: '📋 MENÚ', command: `${ctx.prefix}menu` }] };
      },
    },
    {
      name: 'rival',
      aliases: ['rivales'],
      description: 'Tus rivales según partidas reales: el equipo al que más te has enfrentado, tu verdugo y tu víctima favorita.',
      usage: 'rival [@usuario]',
      example: 'rival',
      category: 'ranking',
      permissions: 'USER',
      cooldown: 4,
      async handler(ctx) {
        const u = playerArg(ctx);
        const r = E(ctx).rivals(u.jid);
        if (!r.total) return `ℹ️ ${plain(u.name)} todavía no tiene rivales: aparecen tras jugar partidas contra otros equipos.`;
        const fmt = (x) => `${plain(x.team.name)} (${x.w}V-${x.l}D-${x.d}E en ${x.played})`;
        return [
          `🎯 *Rivales de ${plain(u.name)}*`,
          `• Más enfrentado: ${fmt(r.mostPlayed)}`,
          r.nemesis ? `• Némesis (más derrotas): ${fmt(r.nemesis)}` : '• Némesis: ningún equipo te ha ganado todavía.',
          r.victim ? `• Presa favorita (más victorias): ${fmt(r.victim)}` : null,
        ]
          .filter(Boolean)
          .join('\n');
      },
    },
    {
      name: 'comparar',
      aliases: ['compare', 'versus'],
      description: 'Compara jugadores, equipos o perfiles con sus datos reales de ELO, partidas y logros.',
      usage: 'comparar jugador|equipo|perfil ...',
      example: 'comparar equipo EQ-0001 EQ-0002',
      category: 'ranking',
      permissions: 'USER',
      cooldown: 4,
      subcommands: compareSubs,
      async handler(ctx) {
        throw new UserError('USAGE', `Uso: *${ctx.prefix}comparar jugador @a [@b]* o *${ctx.prefix}comparar equipo ID1 [ID2]* o *${ctx.prefix}comparar perfil @a [@b]*`);
      },
    },
    {
      name: 'temporada',
      aliases: ['season'],
      description: 'Temporada competitiva actual (ELO), temporadas pasadas y cierre de temporada (SUPERADMIN).',
      usage: 'temporada',
      example: 'temporada',
      category: 'ranking',
      permissions: 'USER',
      cooldown: 4,
      subcommands: seasonSubs,
      async handler(ctx) {
        if (ctx.args.length) throw new UserError('UNKNOWN_SUB', `Subcomando desconocido "${plain(ctx.args[0])}". Usa *${ctx.prefix}help temporada*.`);
        const s = E(ctx).season();
        const top = E(ctx).rankPlayers(3, { seasonOnly: true });
        const rewards = ctx.config.elo.seasonRewards;
        return [
          `📅 *Temporada ${s.number}* — desde ${s.startedAt.slice(0, 10)}`,
          top.length ? `Líderes: ${top.map((p, i) => `${MEDALS[i]} ${pname(ctx, p.jid)} (${formatNumber(p.elo)})`).join(' ')}` : 'Aún no hay partidas puntuables esta temporada.',
          rewards.length ? `Premios al cierre (monedas virtuales): ${rewards.map((c, i) => `${MEDALS[i] || i + 1} ${formatNumber(c)}`).join(' · ')}` : null,
        ]
          .filter(Boolean)
          .join('\n');
      },
    },
  ];
}

module.exports = { name: 'competitivo', build };
