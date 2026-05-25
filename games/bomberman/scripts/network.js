import { supabase } from './supabase.js';

export class Network {
  constructor() {
    this.channel  = null;
    this.myId     = crypto.randomUUID();
    this.roomCode = null;

    // Callbacks — set before joinRoom()
    this.onPresenceUpdate    = null;   // full-state refresh (sync event)
    this.onPresenceJoin      = null;   // incremental: array of new presences
    this.onPresenceLeave     = null;   // incremental: array of left presences
    this.onPlayerHello       = null;   // broadcast-based hello (redundancy)
    this.onAIUpdate          = null;
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

    // ── Presence ──────────────────────────────────────────────────────────────
    // sync: full state snapshot (e.g. after reconnect)
    this.channel.on('presence', { event: 'sync' }, () => {
      if (!this.onPresenceUpdate) return;
      const players = Object.values(this.channel.presenceState()).flat();
      this.onPresenceUpdate(players);
    });

    // join: use newPresences directly — more reliable than re-reading presenceState()
    // which may not yet include the new entry at callback time
    this.channel.on('presence', { event: 'join' }, ({ key, newPresences }) => {
      const joined = newPresences.flat();
      if (this.onPresenceJoin) {
        this.onPresenceJoin(joined);
      } else if (this.onPresenceUpdate) {
        const players = Object.values(this.channel.presenceState()).flat();
        this.onPresenceUpdate(players);
      }
    });

    // leave: use leftPresences directly
    this.channel.on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
      const left = leftPresences.flat();
      if (this.onPresenceLeave) {
        this.onPresenceLeave(left);
      } else if (this.onPresenceUpdate) {
        const players = Object.values(this.channel.presenceState()).flat();
        this.onPresenceUpdate(players);
      }
    });

    // ── Broadcast events ───────────────────────────────────────────────────────
    const on = (event, cb) =>
      this.channel.on('broadcast', { event }, ({ payload }) => cb?.(payload));

    on('player_hello',      p => this.onPlayerHello?.(p));
    on('ai_update',         p => this.onAIUpdate?.(p));
    on('game_start',        p => this.onGameStart?.(p));
    on('player_move',       p => this.onPlayerMove?.(p));
    on('bomb_placed',       p => this.onBombPlaced?.(p));
    on('player_dead',       p => this.onPlayerDead?.(p));
    on('powerup_collected', p => this.onPowerupCollected?.(p));
    on('game_end',          p => this.onGameEnd?.(p));

    // ── Subscribe then track presence ──────────────────────────────────────────
    await new Promise((resolve, reject) => {
      this.channel.subscribe(async status => {
        if (status === 'SUBSCRIBED') {
          try {
            await this.channel.track({ id: this.myId, name: playerName, isHost });
          } catch (e) {
            console.warn('presence track failed:', e);
          }
          // Also announce via broadcast — presence can lag, this is instant
          this.#send('player_hello', { id: this.myId, name: playerName, isHost });
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          reject(new Error(`Channel ${status}`));
        }
      });
    });
  }

  // ── Private send helper ──────────────────────────────────────────────────────
  #send(event, payload) {
    return this.channel?.send({ type: 'broadcast', event, payload });
  }

  // ── Lobby ────────────────────────────────────────────────────────────────────
  sendAIUpdate(aiPlayers) {
    return this.#send('ai_update', { aiPlayers });
  }

  // ── Game — my own player ─────────────────────────────────────────────────────
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

  // ── Game — AI / any player (host only) ───────────────────────────────────────
  sendAnyMove(id, tileX, tileY) {
    return this.#send('player_move', { id, tileX, tileY });
  }

  sendAnyBomb(bombId, placedBy, tileX, tileY, explodesAt, range) {
    return this.#send('bomb_placed', { bombId, placedBy, tileX, tileY, explodesAt, range });
  }

  sendAnyPlayerDead(id) {
    return this.#send('player_dead', { id });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────
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
