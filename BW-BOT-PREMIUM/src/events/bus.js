'use strict';

/** Nombres de los eventos internos del bot. Otros módulos pueden escucharlos con bus.on(EVENTS.x, fn). */
const EVENTS = Object.freeze({
  userRegistered: 'userRegistered',
  userLinked: 'userLinked',
  userUnlinked: 'userUnlinked',
  levelUp: 'levelUp',
  clanVerified: 'clanVerified',
  clanUnverified: 'clanUnverified',
  clanConfigChanged: 'clanConfigChanged',
  gdcStarted: 'gdcStarted',
  gdcReminder: 'gdcReminder',
  gdcFinished: 'gdcFinished',
  squadCreated: 'squadCreated',
  squadCompleted: 'squadCompleted',
  tournamentStarted: 'tournamentStarted',
  matchFinished: 'matchFinished',
  scrimFinished: 'scrimFinished',
  tournamentFinished: 'tournamentFinished',
  gameFinished: 'gameFinished',
  seasonClosed: 'seasonClosed',
  mediaRequested: 'mediaRequested',
  mediaCompleted: 'mediaCompleted',
  userJoined: 'userJoined',
  userLeft: 'userLeft',
});

/**
 * Bus de eventos síncrono y seguro: si un listener lanza un error (o rechaza una promesa),
 * se registra y NO afecta a quien emite ni a los demás listeners.
 */
class EventBus {
  constructor({ logger = null } = {}) {
    this.logger = logger;
    this.listeners = new Map();
  }

  on(event, fn) {
    if (!Object.values(EVENTS).includes(event)) throw new Error(`Evento desconocido: ${event}`);
    if (typeof fn !== 'function') throw new Error('El listener debe ser una función.');
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
    return () => this.off(event, fn);
  }

  off(event, fn) {
    this.listeners.get(event)?.delete(fn);
  }

  emit(event, payload) {
    if (!Object.values(EVENTS).includes(event)) throw new Error(`Evento desconocido: ${event}`);
    for (const fn of [...(this.listeners.get(event) || [])]) {
      try {
        const result = fn(payload);
        if (result && typeof result.catch === 'function') {
          result.catch((err) => this.logger?.error(`Error en listener async de ${event}`, err));
        }
      } catch (err) {
        this.logger?.error(`Error en listener de ${event}`, err);
      }
    }
  }

  listenerCount(event) {
    return this.listeners.get(event)?.size || 0;
  }
}

module.exports = { EventBus, EVENTS };
