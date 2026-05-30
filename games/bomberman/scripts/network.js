import { supabase } from './supabase.js';

export class Network {
  constructor() {
    this.channel  = null;
    this.myId     = crypto.randomUUID();
    this.roomCode = null;

    // Callbacks — set before joinRoom()
    this.onPresenceUpdate    = null;
    this.onPresenceJoin      = null;
    this.onPresenceLeave     = null;
    this.onPlayerHello       = null;
    this.onPlayerLeave       = null;  // intentional leave broadcast
    this.onLobbyState        = null;  // host-authoritative roster broadcast
    this.onReturnLobby       = null;  // host sent everyone back to the lobby
    this.onGameStart         = null;
    this.onPlayerMove        = null;
    this.onBombPlaced        = null;
    this.onBombKick          = null;
    this.onPlayerDead        = null;
    this.onPowerupCollected  = null;
    this.onGameEnd           = null;
    this.onPlayerKick        = null;
    this.onBombExploded      = null;  // host-authoritative explosion result
    this.onNapalmSpread      = null;  // host-authoritative napalm spread
    this.onBombAck           = null;  // host → all: authoritative explodesAt for non-host bombs
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
    this.channel.on('presence', { event: 'sync' }, () => {
      if (!this.onPresenceUpdate) return;
      const players = Object.values(this.channel.presenceState()).flat();
      this.onPresenceUpdate(players);
    });

    this.channel.on('presence', { event: 'join' }, ({ newPresences }) => {
      const joined = newPresences.flat();
      if (this.onPresenceJoin) {
        this.onPresenceJoin(joined);
      } else if (this.onPresenceUpdate) {
        const players = Object.values(this.channel.presenceState()).flat();
        this.onPresenceUpdate(players);
      }
    });

    this.channel.on('presence', { event: 'leave' }, ({ leftPresences }) => {
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
    on('player_leave',      p => this.onPlayerLeave?.(p));
    on('lobby_state',       p => this.onLobbyState?.(p));
    on('return_lobby',      p => this.onReturnLobby?.(p));
    on('game_start',        p => this.onGameStart?.(p));
    on('player_move',       p => this.onPlayerMove?.(p));
    on('bomb_placed',       p => this.onBombPlaced?.(p));
    on('bomb_kick',         p => this.onBombKick?.(p));
    on('player_dead',       p => this.onPlayerDead?.(p));
    on('powerup_collected', p => this.onPowerupCollected?.(p));
    on('game_end',          p => this.onGameEnd?.(p));
    on('player_kick',       p => this.onPlayerKick?.(p));
    on('bomb_exploded',     p => this.onBombExploded?.(p));
    on('napalm_spread',     p => this.onNapalmSpread?.(p));
    on('bomb_ack',          p => this.onBombAck?.(p));

    // ── Subscribe then track presence ──────────────────────────────────────────
    await new Promise((resolve, reject) => {
      this.channel.subscribe(async status => {
        if (status === 'SUBSCRIBED') {
          try {
            await this.channel.track({ id: this.myId, name: playerName, isHost });
          } catch (e) {
            console.warn('presence track failed:', e);
          }
          this.#send('player_hello', { id: this.myId, name: playerName, isHost });
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          reject(new Error(`Channel ${status}`));
        }
      });
    });
  }

  #send(event, payload) {
    return this.channel?.send({ type: 'broadcast', event, payload });
  }

  // ── Lobby ────────────────────────────────────────────────────────────────────
  sendPlayerLeave(id) {
    return this.#send('player_leave', { id });
  }

  // Host broadcasts the full, ordered roster so every client renders an
  // identical lobby view. `roster` is an array of
  // { id, name, isAI, isHost, inGame }; `gameRunning` flags whether a round
  // is currently in progress in the room.
  sendLobbyState(roster, gameRunning) {
    return this.#send('lobby_state', { roster, gameRunning });
  }

  // Host tells everyone to drop back to the lobby after a game.
  sendReturnLobby() {
    return this.#send('return_lobby', {});
  }

  sendPlayerKick(targetId) {
    return this.#send('player_kick', { targetId });
  }

  // ── Game ─────────────────────────────────────────────────────────────────────
  sendGameStart(map, playerOrder, gridW, gridH) {
    return this.#send('game_start', { map, playerOrder, gridW, gridH });
  }

  sendMove(tileX, tileY) {
    return this.#send('player_move', { id: this.myId, tileX, tileY });
  }

  sendBomb(bombId, tileX, tileY, explodesAt, range, type = 'normal') {
    return this.#send('bomb_placed', { bombId, placedBy: this.myId, tileX, tileY, explodesAt, range, type });
  }

  sendBombKick(bombId, newTileX, newTileY) {
    return this.#send('bomb_kick', { bombId, newTileX, newTileY });
  }

  sendPlayerDead(id) {
    return this.#send('player_dead', { id });
  }

  sendPowerupCollected(tileX, tileY) {
    return this.#send('powerup_collected', { playerId: this.myId, tileX, tileY });
  }

  // scores: [{id, name, pts}] final game scores (host-authoritative)
  sendGameEnd(winnerId, scores) {
    return this.#send('game_end', { winnerId, scores: scores ?? [] });
  }

  // Host → all: authoritative explosion result
  sendBombExploded(bombId, result, killedIds, powerups, totalBricksDestroyed) {
    return this.#send('bomb_exploded', {
      bombId,
      tiles:               result.tiles,
      destroyedBricks:     result.destroyedBricks,
      powerups:            powerups ?? [],
      isNapalm:            result.isNapalm,
      isBox:               result.isBox,
      napalmDieAt:         result.napalmDieAt ?? null,
      killedIds:           killedIds ?? [],
      totalBricksDestroyed,
    });
  }

  // Host → all: napalm spread + any players killed by it
  sendNapalmSpread(tiles, dieAt, killedIds) {
    return this.#send('napalm_spread', { tiles, dieAt, killedIds: killedIds ?? [] });
  }

  // Host → all: authoritative explodesAt for a non-host-placed bomb
  sendBombAck(bombId, explodesAt) {
    return this.#send('bomb_ack', { bombId, explodesAt });
  }

  // ── Host-only (AI / any player) ───────────────────────────────────────────────
  sendAnyMove(id, tileX, tileY) {
    return this.#send('player_move', { id, tileX, tileY });
  }

  sendAnyBomb(bombId, placedBy, tileX, tileY, explodesAt, range, type = 'normal') {
    return this.#send('bomb_placed', { bombId, placedBy, tileX, tileY, explodesAt, range, type });
  }

  sendAnyPlayerDead(id) {
    return this.#send('player_dead', { id });
  }

  sendAnyPowerupCollected(playerId, tileX, tileY) {
    return this.#send('powerup_collected', { playerId, tileX, tileY });
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
