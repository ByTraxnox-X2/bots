'use strict';

const { TeamService } = require('./teams');
const { MatchService } = require('./matches');
const { GameService } = require('./games');
const { TournamentService } = require('./tournaments');
const { ScrimService } = require('./scrims');
const { EloService } = require('./elo');
const { GroupService } = require('./groups');
const { AdminService } = require('./admin');
const { SocialService } = require('./social');
const { MediaService } = require('../media/service');
const { InteractionService } = require('./interactions');
const { GAME_MODULES } = require('../plugins/juegos');

/**
 * Servicios de las fases 5-9. Se construyen aquí para que app.js y los tests usen exactamente el mismo cableado.
 * Cada fase añade los suyos a este objeto.
 */
function buildExtras({ db, config, bus, logger, users, clans, scheduler, wa, permissions, now = () => Date.now(), sleep, mediaOptions = {} }) {
  const teams = new TeamService({ db, users, config, bus, logger, now });
  const matches = new MatchService({ db, teams, users, scheduler, bus, config, logger, now }).register();
  const games = new GameService({ db, users, scheduler, wa, bus, config, logger, now });
  for (const mod of GAME_MODULES) games.addModule(mod);
  games.register();
  const tournaments = new TournamentService({ db, teams, matches, users, scheduler, wa, bus, config, logger, now }).register();
  const scrims = new ScrimService({ db, teams, matches, scheduler, wa, bus, config, logger, now }).register();
  const elo = new EloService({ db, teams, matches, users, clans, games, bus, config, logger, now }).register();
  const groups = new GroupService({ db, wa, bus, users, config, logger, now });
  const admin = new AdminService({ db, wa, config, logger, now, sleep });
  const social = new SocialService({ db, users, teams, matches, tournaments, scrims, elo, games, bus, config, logger, now });
  const media = new MediaService({ config, db, logger, now, ...mediaOptions });
  const interactions = new InteractionService({ config, now });
  return { teams, matches, games, tournaments, scrims, elo, groups, admin, social, media, interactions };
}

module.exports = { buildExtras };
