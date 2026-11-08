'use strict';

const crypto = require('node:crypto');
const jid = require('../whatsapp/jid');
const time = require('../utils/time');
const { EVENTS } = require('../events/bus');
const { nextId, audit, fail } = require('./common');

const COLLECTION = 'games';
const JOB_TIMER = 'game.timer';
const TIMER_GRACE_MS = 120000;
const KEEP_FINISHED = 100;

const LIVE = new Set(['lobby', 'active']);

/**
 * Motor de juegos interactivos. Reglas generales:
 *  - las sesiones se guardan en la base de datos (colección games) y sobreviven a reinicios;
 *  - los temporizadores son trabajos del scheduler persistente (id único por turno → un temporizador viejo nunca actúa);
 *  - las apuestas se descuentan al entrar (escrow) y se pagan/devuelven al terminar o cancelar: nunca se pierden monedas;
 *  - los premios sin apuesta tienen un tope diario por jugador (GAME_DAILY_COIN_CAP) para evitar el farmeo;
 *  - los mensajes que genera un temporizador se guardan en `outbox` hasta enviarse (si falla el envío, se reintenta).
 */
class GameService {
  constructor({ db, users, scheduler, wa = null, bus = null, config, logger = null, now = () => Date.now(), randInt = (n) => crypto.randomInt(n) }) {
    this.db = db;
    this.users = users;
    this.scheduler = scheduler;
    this.wa = wa;
    this.bus = bus;
    this.config = config;
    this.cfg = config.games;
    this.logger = logger;
    this.now = now;
    this.randInt = randInt;
    this.modules = {};
  }

  /** Cada juego con sesión registra su módulo: { type, onTimer(svc, session) → mensaje | null }. */
  addModule(mod) {
    this.modules[mod.type] = mod;
    return this;
  }

  register() {
    this.scheduler?.register(JOB_TIMER, (job) => this.onTimer(job));
    return this;
  }

  _iso() {
    return new Date(this.now()).toISOString();
  }

  // ---------- aleatoriedad ----------

  pick(list) {
    return list[this.randInt(list.length)];
  }

  shuffle(list) {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
      const j = this.randInt(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---------- sesiones ----------

  get(id) {
    return this.db.get(COLLECTION, id) || null;
  }

  all() {
    return this.db.values(COLLECTION);
  }

  activeInChat(chatJid) {
    return this.all().find((s) => s.chatJid === chatJid && LIVE.has(s.status)) || null;
  }

  /** Sesión viva de un tipo en el chat. */
  activeOf(chatJid, type) {
    const s = this.activeInChat(chatJid);
    return s && s.type === type ? s : null;
  }

  create({ type, chatJid, host, status = 'active', data = {} }) {
    const busy = this.activeInChat(chatJid);
    if (busy) throw fail('GAME_BUSY', `Ya hay un juego en curso en este chat (${busy.type}). Espera a que termine o pide a un administrador *.juegos cancelar*.`);
    const id = nextId(this.db, 'game', 'G');
    const s = {
      id,
      type,
      chatJid,
      host: host || null,
      status,
      players: host ? [host] : [],
      bets: {},
      data,
      timer: 0,
      deadline: null,
      outbox: null,
      createdAt: this._iso(),
      finishedAt: null,
      result: null,
    };
    this.db.set(COLLECTION, id, s);
    this._prune();
    audit(this.db, { scope: 'juego', ref: id, actor: host, action: 'crear', detail: type, at: this.now() });
    return s;
  }

  _prune() {
    const done = this.all().filter((s) => !LIVE.has(s.status));
    const extra = done.length - KEEP_FINISHED;
    if (extra > 0) {
      done.sort((a, b) => String(a.finishedAt).localeCompare(String(b.finishedAt)));
      for (const s of done.slice(0, extra)) this.db.delete(COLLECTION, s.id);
    }
  }

  /** Programa (o reprograma) el temporizador de una sesión. El anterior queda cancelado. */
  setTimer(s, seconds) {
    this.scheduler.cancelWhere((j) => j.type === JOB_TIMER && j.payload.gameId === s.id);
    s.timer += 1;
    s.deadline = this.now() + Math.round(seconds * 1000);
    this.scheduler.schedule({ id: `GAME_${s.id}_${s.timer}`, type: JOB_TIMER, runAt: s.deadline, payload: { gameId: s.id, token: s.timer }, graceMs: TIMER_GRACE_MS });
    this.db.touch();
  }

  async onTimer(job) {
    const s = this.get(job.payload.gameId);
    if (!s) return;
    if (s.outbox) return this.flush(s); // un envío anterior falló: solo se reintenta
    if (!LIVE.has(s.status) || s.timer !== job.payload.token) return; // temporizador viejo
    const mod = this.modules[s.type];
    if (!mod) return;
    const msg = await mod.onTimer(this, s);
    if (msg) {
      s.outbox = { text: msg.text, mentions: msg.mentions || [] };
      this.db.touch();
    }
    await this.flush(s);
  }

  async flush(s) {
    if (!s.outbox || !this.wa) return;
    const { text, mentions } = s.outbox;
    await this.wa.sendText(s.chatJid, text, { mentions }); // si falla lanza y el scheduler reintenta
    s.outbox = null;
    this.db.touch();
  }

  /** Marca la sesión como terminada (los pagos los hace el juego antes con settle/refund). */
  finish(s, { winners = [], summary = '' } = {}) {
    if (!LIVE.has(s.status)) return;
    s.status = 'finished';
    s.finishedAt = this._iso();
    s.deadline = null;
    s.result = { winners, summary: String(summary).slice(0, 200) };
    this.scheduler?.cancelWhere((j) => j.type === JOB_TIMER && j.payload.gameId === s.id);
    for (const p of s.players) this.recordStat(p, s.type, winners.includes(p));
    this.db.touch();
    audit(this.db, { scope: 'juego', ref: s.id, actor: null, action: 'finalizar', detail: `${s.type}: ${winners.length} ganador(es)`, at: this.now() });
    this.bus?.emit(EVENTS.gameFinished, { session: s });
  }

  /** Cancela devolviendo todas las apuestas. */
  cancel(s, reason, by = null) {
    if (!LIVE.has(s.status)) return false;
    this.refund(s);
    s.status = 'cancelled';
    s.finishedAt = this._iso();
    s.deadline = null;
    s.result = { winners: [], summary: String(reason).slice(0, 200) };
    this.scheduler?.cancelWhere((j) => j.type === JOB_TIMER && j.payload.gameId === s.id);
    this.db.touch();
    audit(this.db, { scope: 'juego', ref: s.id, actor: by, action: 'cancelar', detail: `${s.type}: ${reason}`, at: this.now() });
    return true;
  }

  /** Al arrancar: cancela sesiones que ya no se pueden retomar (pasaron mucho de su plazo) y repone el temporizador del resto. */
  syncAll() {
    let cancelled = 0;
    let rearmed = 0;
    for (const s of this.all()) {
      if (!LIVE.has(s.status)) continue;
      if (s.deadline && this.now() - s.deadline > TIMER_GRACE_MS) {
        this.cancel(s, 'reinicio del bot');
        cancelled++;
      } else if (s.deadline) {
        const r = this.scheduler?.schedule({ id: `GAME_${s.id}_${s.timer}`, type: JOB_TIMER, runAt: s.deadline, payload: { gameId: s.id, token: s.timer }, graceMs: TIMER_GRACE_MS });
        if (r?.created) rearmed++;
      }
    }
    return { cancelled, rearmed };
  }

  // ---------- apuestas ----------

  parseBet(raw) {
    if (raw === undefined || raw === null || raw === '') return 0;
    if (!/^\d+$/.test(String(raw))) throw fail('BAD_BET', 'La apuesta debe ser un número entero de monedas.');
    const n = Number(raw);
    if (n < 1 || n > this.cfg.maxBet) throw fail('BAD_BET', `La apuesta debe estar entre 1 y ${this.cfg.maxBet} monedas.`);
    return n;
  }

  /** Descuenta la apuesta y la guarda en la sesión. */
  escrow(s, user, amount) {
    if (amount <= 0) return;
    this.users.spendCoins([user.jid], amount, `apuesta ${s.type}`);
    s.bets[user.jid] = (s.bets[user.jid] || 0) + amount;
    this.db.touch();
  }

  pot(s) {
    return Object.values(s.bets).reduce((a, b) => a + b, 0);
  }

  refund(s) {
    for (const [j, amt] of Object.entries(s.bets)) {
      if (amt > 0 && this.users.find([j])) this.users.addCoins([j], amt, `devolución ${s.type}`);
    }
    s.bets = {};
    this.db.touch();
  }

  /** Reparte el bote entre los ganadores (el resto de la división al primero). Sin ganadores, devuelve las apuestas. */
  settle(s, winners) {
    const pot = this.pot(s);
    if (pot === 0) return 0;
    if (!winners.length) {
      this.refund(s);
      return 0;
    }
    const share = Math.floor(pot / winners.length);
    const rest = pot - share * winners.length;
    winners.forEach((w, i) => this.users.addCoins([w], share + (i === 0 ? rest : 0), `premio ${s.type}`));
    s.bets = {};
    this.db.touch();
    return share;
  }

  // ---------- premios y estadísticas ----------

  _stats() {
    return this.db.ensure('rankings', 'games', () => ({ players: {} }));
  }

  playerStats(jidValue) {
    return this._stats().players[jid.normalize(jidValue)] || { total: { played: 0, wins: 0, coins: 0 }, byGame: {}, daily: { date: null, coins: 0 } };
  }

  recordStat(jidValue, type, won) {
    const st = this._stats();
    const p = (st.players[jidValue] ||= { total: { played: 0, wins: 0, coins: 0 }, byGame: {}, daily: { date: null, coins: 0 } });
    const g = (p.byGame[type] ||= { played: 0, wins: 0 });
    p.total.played++;
    g.played++;
    if (won) {
      p.total.wins++;
      g.wins++;
    }
    this.db.touch();
  }

  /** Premio por ganar sin apuesta: XP siempre; monedas hasta el tope diario. Devuelve texto "+50 🪙 +10 XP". */
  prize(jidValue, { coins = this.cfg.prizeCoins, xp = this.cfg.prizeXp } = {}) {
    const user = this.users.find([jidValue]);
    if (!user) return '';
    const p = this.playerStats(jidValue);
    const st = this._stats();
    st.players[jidValue] = p;
    const today = time.localDateString(this.now(), this.config.timezone);
    if (p.daily.date !== today) p.daily = { date: today, coins: 0 };
    const room = Math.max(0, this.cfg.dailyCoinCap - p.daily.coins);
    const c = Math.min(coins, room);
    const parts = [];
    if (c > 0) {
      this.users.addCoins([jidValue], c, 'premio de juego');
      p.daily.coins += c;
      p.total.coins += c;
      parts.push(`+${c} 🪙`);
    } else if (coins > 0) {
      parts.push('(tope diario de monedas alcanzado)');
    }
    if (xp > 0) {
      this.users.addXp([jidValue], xp, 'juego');
      parts.push(`+${xp} XP`);
    }
    this.db.touch();
    return parts.join(' ');
  }

  /** Ranking de jugadores por victorias en juegos. */
  topWinners(limit = 10, type = null) {
    return Object.entries(this._stats().players)
      .map(([j, p]) => ({ jid: j, wins: type ? p.byGame[type]?.wins || 0 : p.total.wins, played: type ? p.byGame[type]?.played || 0 : p.total.played }))
      .filter((r) => r.wins > 0)
      .sort((a, b) => b.wins - a.wins || a.played - b.played || a.jid.localeCompare(b.jid))
      .slice(0, limit);
  }
}

module.exports = { GameService, LIVE, JOB_TIMER };
