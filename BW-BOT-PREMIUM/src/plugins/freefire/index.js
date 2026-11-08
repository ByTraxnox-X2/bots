'use strict';

const { UserError } = require('../../services/users');
const { looksLikeUid } = require('../../utils/validators');
const { parseUidAndRegion } = require('../users/linking');
const { playerLines } = require('./format');

/** Interpreta "UID [REGION] [full]" (la palabra full puede ir en cualquier posición). Sin UID usa el vinculado. */
function parseArgs(ctx, forceFull) {
  let full = forceFull;
  const rest = [];
  for (const a of ctx.args) {
    if (a.toLowerCase() === 'full') full = true;
    else rest.push(a);
  }
  let uidText = rest[0];
  let regionText = rest[1];
  if (!uidText) {
    if (ctx.user?.ffUid) {
      uidText = ctx.user.ffUid;
      regionText = ctx.user.ffRegion || undefined;
    } else {
      throw new UserError('USAGE', `Uso: *${ctx.prefix}${ctx.command.usage}*\nTambién puedes vincular tu UID con *${ctx.prefix}vincular* y usar *${ctx.prefix}${ctx.command.name}* sin argumentos.`);
    }
  } else if (!looksLikeUid(uidText)) {
    // Deja que el validador dé el mensaje correcto (solo números, 5-15 dígitos).
  }
  return { ...parseUidAndRegion(uidText, regionText, ctx.config), full };
}

async function run(ctx, forceFull) {
  const { uid, region, full } = parseArgs(ctx, forceFull);
  const res = await ctx.services.ff.lookup(uid, { region });
  if (!res.ok) {
    const icon = res.kind === 'NOT_FOUND' ? '🔎' : '⚠️';
    throw new UserError('FF_' + res.kind, `${icon} ${res.message}`);
  }
  const lines = [`🎮 *Free Fire${full ? ' — ficha completa' : ''}*`, ...playerLines(res.data, { full })];
  if (!res.data.uid) lines.splice(1, 0, `🆔 UID: ${uid}`);
  lines.push('', `_Fuente: ${res.provider}${res.cached ? ' (en cache)' : ''}_`);
  return lines.join('\n');
}

function build() {
  return [
    {
      name: 'ff',
      aliases: ['freefire'],
      description: 'Consulta un jugador de Free Fire por UID usando las APIs configuradas. Sin UID usa el que tengas vinculado. Con "full" muestra más datos.',
      usage: 'ff [UID] [REGION] [full]',
      example: 'ff 123456789 sa',
      category: 'freefire',
      permissions: 'USER',
      cooldown: 8,
      handler: (ctx) => run(ctx, false),
    },
    {
      name: 'fffull',
      aliases: [],
      description: 'Ficha completa de un jugador de Free Fire (todos los datos que entregue la API).',
      usage: 'fffull [UID] [REGION]',
      example: 'fffull 123456789 sa',
      category: 'freefire',
      permissions: 'USER',
      cooldown: 8,
      handler: (ctx) => run(ctx, true),
    },
  ];
}

module.exports = { name: 'freefire', build };
