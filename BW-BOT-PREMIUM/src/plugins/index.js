'use strict';

/**
 * Plugins de comandos. Cada plugin exporta { name, build() } y build() devuelve las definiciones
 * de comandos. Todos se registran en el registro central; si alguna definición es inválida o hay
 * conflicto de nombres/alias, el arranque falla con un mensaje claro (mejor eso que comandos rotos).
 * Las fases siguientes añaden aquí sus plugins (clanes, GDC, equipos, torneos…).
 */
const PLUGINS = [require('./users'), require('./freefire'), require('./clans'), require('./gdc'), require('./equipos'), require('./juegos'), require('./torneos'), require('./competitivo'), require('./moderacion'), require('./owner'), require('./social'), require('./media'), require('./tools'), require('./help'), require('./menu')];

function registerPlugins(registry) {
  for (const plugin of PLUGINS) {
    try {
      registry.registerAll(plugin.build());
    } catch (err) {
      throw new Error(`Plugin "${plugin.name}": ${err.message}`);
    }
  }
  return registry;
}

module.exports = { registerPlugins, PLUGINS };
