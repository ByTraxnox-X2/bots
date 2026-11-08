'use strict';

// npm run ff-probe -- UID [REGION] [--raw]
// Prueba las APIs de Free Fire configuradas en .env con un UID real, sin iniciar el bot.
//  - Muestra qué APIs están configuradas (solo hosts, nunca claves) y el resultado normalizado.
//  - Con --raw imprime la ESTRUCTURA de cada respuesta (rutas de campos y tipos, sin valores),
//    útil para comprobar si el normalizador reconoce el formato de tu API.
const { loadConfig } = require('../src/config');
const { FreeFireService } = require('../src/providers/freefire/service');
const { flatten } = require('../src/providers/freefire/normalize');
const { parseUid, parseRegion } = require('../src/utils/validators');

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const raw = process.argv.includes('--raw');
  const uidCheck = parseUid(args[0]);
  if (!uidCheck.ok) {
    console.error(`${uidCheck.error}\nUso: npm run ff-probe -- UID [REGION] [--raw]`);
    process.exit(2);
  }
  let region = null;
  if (args[1]) {
    const r = parseRegion(args[1]);
    if (!r.ok) {
      console.error(r.error);
      process.exit(2);
    }
    region = r.value;
  }

  const config = loadConfig();
  const service = new FreeFireService({ config });
  console.log(`APIs configuradas: ${service.providers.length}`);
  for (const p of service.providers) {
    const flags = [p.needsRegion ? 'necesita región' : null, p.needsKey ? (p.misconfigured ? 'FALTA FF_API_KEY' : 'usa clave') : null].filter(Boolean);
    console.log(`  - ${p.name}${flags.length ? ` (${flags.join(', ')})` : ''}`);
  }
  if (!service.configured) {
    console.error('\nNo hay ninguna API utilizable. Define FF_API_URLS (y FF_API_KEY si hace falta) en .env.');
    process.exit(1);
  }

  if (raw) {
    for (const p of service.providers) {
      if (p.misconfigured) continue;
      const useRegion = region || config.freefire.defaultRegion || config.freefire.regions[0] || null;
      if (p.needsRegion && !useRegion) {
        console.log(`\n[${p.name}] omitida: necesita región (pásala como segundo argumento).`);
        continue;
      }
      try {
        const { status, text } = await p.fetchRaw(uidCheck.value, useRegion);
        console.log(`\n[${p.name}] HTTP ${status}`);
        let json;
        try {
          json = JSON.parse(text);
        } catch {
          console.log('  (la respuesta no es JSON)');
          continue;
        }
        const seen = new Set();
        for (const e of flatten(json)) {
          const line = `  ${[...e.path, e.key].join('.')}: ${typeof e.value}`;
          if (!seen.has(line)) {
            seen.add(line);
            console.log(line);
          }
        }
      } catch (err) {
        console.log(`\n[${p.name}] error: ${err.kind || 'ERROR'} ${err.detail || err.message}`);
      }
    }
  }

  const result = await service.lookup(uidCheck.value, { region, fresh: true });
  console.log('\nResultado normalizado:');
  console.log(JSON.stringify(result, null, 2));
  console.log('\nEstado de las APIs:');
  console.log(JSON.stringify(service.status(), null, 2));
  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
