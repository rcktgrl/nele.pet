import { supabase } from './supabase.js';

export class Network {
  constructor() {
    this.channel  = null;
    this.myId     = crypto.randomUUID();
    this.roomCode = null;

    // Callbacks — set before joinRoom()
    this.onPresenceUpdate    = null;
    this.onAIUpdate          = null;   // { aiPlayers }
    this.onGameStart         = null;
    this.onPlayerMove        = null;
    this.onBombPlaced        = null;
    this.onPlayerDead        = null;
    this.onPowerupCollected  = null;
    this.onGameEnd           = null;
  }

  async joinRoom(roomCode, playerName, isHost) {
    this.roomCode = roomCode;

    this.channel = supabase.channel(`bomberman:${roomCode}`, {
      config: {
        broadcast: { self: false },
        presence:  { key: this.myId },
      },
    });

    // Presence — lobby player list
    this.channel.on('presence', { event: 'sync' }, () => {
      if (this.onPresenceUpdate) {
        const players = Object.values(this.channel.presenceState()).flat();
        this.onPresenceUpdate(players);
      }
    });

    // Broadcast events
    const on = (event, cb) =>
      this.channel.on('broadcast', { event }, ({ payload }) => cb?.(payload));

    on('ai_update',         p => this.onAIUpdate?.(p));
    on('game_start',        p => this.onGameStart?.(p));
    on('player_move',       p => this.onPlayerMove?.(p));
    on('bomb_placed',       p => this.onBombPlaced?.(p));
    on('player_dead',       p => this.onPlayerDead?.(p));
    on('powerup_collected', p => this.onPowerupCollected?.(p));
    on('game_end',          p => this.onGameEnd?.(p));

    // Subscribe and announce presence
    await new Promise(resolve => {
      this.channel.subscribe(async status => {
        if (status === 'SUBSCRIBED') {
          await this.channel.track({ id: this.myId, name: playerName, isHost });
          resolve();
        }
      });
    });
  }

  // ── Private send helper ────────────────────────────────────────────────────
  #send(event, payload) {
    return this.channel?.send({ type: 'broadcast', event, payload });
  }

  // ── Lobby ──────────────────────────────────────────────────────────────────
  /** Host broadcasts current AI player list to sync all lobby UIs */
  sendAIUpdate(aiPlayers) {
    return this.#send('ai_update', { aiPlayers });
  }

  // ── Game — my own player ───────────────────────────────────────────────────
  sendGameStart(map, playerOrder) {
    return this.#send('game_start', { map, playerOrder });
  }

  sendMove(tileX, tileY) {
    return this.#send('player_move', { id: this.myId, tileX, tileY });
  }

  sendBomb(bombId, tileX, tileY, explodesAt, range) {
    return this.#send('bomb_placed', { bombId, placedBy: this.myId, tileX, tileY, explodesAt, range });
  }

  sendPlayerDead(id) {
    return this.#send('player_dead', { id });
  }

  sendPowerupCollected(tileX, tileY) {
    return this.#send('powerup_collected', { playerId: this.myId, tileX, tileY });
  }

  sendGameEnd(winnerId) {
    return this.#send('game_end', { winnerId });
  }

  // ── Game — AI / any player (host only) ────────────────────────────────────
  /** Broadcast a move on behalf of any player id (used for AI) */
  sendAnyMove(id, tileX, tileY) {
    return this.#send('player_move', { id, tileX, tileY });
  }

  /** Broadcast a bomb placement on behalf of any player id (used for AI) */
  sendAnyBomb(bombId, placedBy, tileX, tileY, explodesAt, range) {
    return this.#send('bomb_placed', { bombId, placedBy, tileX, tileY, explodesAt, range });
  }

  /** Broadcast death on behalf of any player id (used for AI) */
  sendAnyPlayerDead(id) {
    return this.#send('player_dead', { id });
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  getPresencePlayers() {
    if (!this.channel) return [];
    return Object.values(this.channel.presenceState()).flat();
  }

  async leave() {
    if (this.channel) {
      await this.channel.unsubscribe();
      this.channel = null;
    }
  }
}
