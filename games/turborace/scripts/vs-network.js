'use strict';
import { supabase } from './supabase.js';

/**
 * VsNetwork — real-time 2-player VS racing via Supabase channels.
 * Follows the same presence + broadcast pattern as Bomber's network.js.
 */
export class VsNetwork {
  constructor() {
    this.channel  = null;
    this.myId     = crypto.randomUUID();
    this.roomCode = null;
    this.isHost   = false;

    // Callbacks — assign before joinRoom()
    this.onPresenceUpdate  = null;  // (players[]) called on any join/leave/sync
    this.onGameConfig      = null;  // ({trackId, carIdx, hostName}) host config pushed to guest
    this.onGuestReady      = null;  // ({carIdx, guestName}) guest signals ready
    this.onGameStart       = null;  // () race is starting
    this.onPosUpdate       = null;  // ({id, x, z, hdg, spd, lap, totalProg})
    this.onPlayerFinished  = null;  // ({id, finTime})
    this.onPlayerLeft      = null;  // ({id})
  }

  // ── Join / leave ──────────────────────────────────────────────────────────
  async joinRoom(roomCode, playerName, isHost) {
    this.roomCode = roomCode;
    this.isHost   = isHost;

    this.channel = supabase.channel(`turborace-vs:${roomCode}`, {
      config: {
        broadcast: { self: false },
        presence:  { key: this.myId },
      },
    });

    // Presence: who is in the room
    const _presenceChanged = () => {
      if (!this.onPresenceUpdate) return;
      const players = Object.values(this.channel.presenceState()).flat();
      this.onPresenceUpdate(players);
    };
    this.channel.on('presence', { event: 'sync' },  _presenceChanged);
    this.channel.on('presence', { event: 'join' },  _presenceChanged);
    this.channel.on('presence', { event: 'leave' }, ({ leftPresences }) => {
      const left = leftPresences.flat();
      for (const p of left) this.onPlayerLeft?.({ id: p.id });
      _presenceChanged();
    });

    // Broadcast events
    const on = (event, cb) =>
      this.channel.on('broadcast', { event }, ({ payload }) => cb?.(payload));

    on('game_config',     p => this.onGameConfig?.(p));
    on('guest_ready',     p => this.onGuestReady?.(p));
    on('game_start',      p => this.onGameStart?.(p));
    on('pos_update',      p => this.onPosUpdate?.(p));
    on('player_finished', p => this.onPlayerFinished?.(p));

    // Subscribe and track presence
    await new Promise((resolve, reject) => {
      this.channel.subscribe(async status => {
        if (status === 'SUBSCRIBED') {
          try {
            await this.channel.track({ id: this.myId, name: playerName, isHost });
          } catch (e) {
            console.warn('[vs-network] presence track failed:', e);
          }
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          reject(new Error(`Channel ${status}`));
        }
      });
    });
  }

  async leave() {
    if (this.channel) {
      await this.channel.unsubscribe();
      this.channel = null;
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  getPresencePlayers() {
    if (!this.channel) return [];
    return Object.values(this.channel.presenceState()).flat();
  }

  #send(event, payload) {
    return this.channel?.send({ type: 'broadcast', event, payload });
  }

  // ── Lobby messages ────────────────────────────────────────────────────────
  /** Host → guest: selected track + car index */
  sendGameConfig(trackId, carIdx, hostName) {
    return this.#send('game_config', { trackId, carIdx, hostName });
  }

  /** Guest → host: selected car + ready */
  sendGuestReady(carIdx, guestName) {
    return this.#send('guest_ready', { carIdx, guestName });
  }

  /** Host → all: race is starting NOW */
  sendGameStart() {
    return this.#send('game_start', {});
  }

  // ── In-race messages ──────────────────────────────────────────────────────
  /** Frequent position snapshot (~20 Hz) */
  sendPosUpdate(x, z, hdg, spd, lap, totalProg) {
    return this.#send('pos_update', {
      id: this.myId, x, z, hdg, spd, lap, totalProg,
    });
  }

  /** One-shot: player crossed the finish line */
  sendPlayerFinished(finTime) {
    return this.#send('player_finished', { id: this.myId, finTime });
  }
}

/** Generate a random 4-character uppercase room code */
export function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}
