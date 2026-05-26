'use strict';
import { supabase } from './supabase.js';

/**
 * VsNetwork — real-time racing via Supabase channels.
 * Supports up to 4 players (real + AI) using the same
 * presence + broadcast pattern as Bomber.
 */
export class VsNetwork {
  constructor() {
    this.channel  = null;
    this.myId     = crypto.randomUUID();
    this.roomCode = null;
    this.isHost   = false;

    // Callbacks — assign before joinRoom()
    this.onPresenceUpdate  = null;  // (players[]) any join/leave/sync
    this.onAIUpdate        = null;  // ({aiPlayers}) host pushed AI list
    this.onGameConfig      = null;  // ({trackId, hostCarIdx}) host config
    this.onGuestReady      = null;  // ({id, carIdx}) guest car selection
    this.onGameStart       = null;  // ({slots, trackId}) race starting
    this.onPosUpdate       = null;  // ({id, x, z, hdg, spd, lap, totalProg})
    this.onPlayerFinished  = null;  // ({id, finTime})
    this.onPlayerKick      = null;  // ({targetId})
  }

  async joinRoom(roomCode, playerName, isHost) {
    this.roomCode = roomCode;
    this.isHost   = isHost;

    this.channel = supabase.channel(`turborace-vs:${roomCode}`, {
      config: {
        broadcast: { self: false },
        presence:  { key: this.myId },
      },
    });

    const _presenceChanged = () => {
      if (!this.onPresenceUpdate) return;
      const players = Object.values(this.channel.presenceState()).flat();
      this.onPresenceUpdate(players);
    };
    this.channel.on('presence', { event: 'sync' },  _presenceChanged);
    this.channel.on('presence', { event: 'join' },  _presenceChanged);
    this.channel.on('presence', { event: 'leave' }, _presenceChanged);

    const on = (event, cb) =>
      this.channel.on('broadcast', { event }, ({ payload }) => cb?.(payload));

    on('ai_update',       p => this.onAIUpdate?.(p));
    on('game_config',     p => this.onGameConfig?.(p));
    on('guest_ready',     p => this.onGuestReady?.(p));
    on('game_start',      p => this.onGameStart?.(p));
    on('pos_update',      p => this.onPosUpdate?.(p));
    on('player_finished', p => this.onPlayerFinished?.(p));
    on('player_kick',     p => this.onPlayerKick?.(p));

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

  getPresencePlayers() {
    if (!this.channel) return [];
    return Object.values(this.channel.presenceState()).flat();
  }

  #send(event, payload) {
    return this.channel?.send({ type: 'broadcast', event, payload });
  }

  // ── Lobby ────────────────────────────────────────────────────────────────────
  /** Host → all: updated AI player list */
  sendAIUpdate(aiPlayers) {
    return this.#send('ai_update', { aiPlayers });
  }

  /** Host → guest: current track + host car selection */
  sendGameConfig(trackId, hostCarIdx) {
    return this.#send('game_config', { trackId, hostCarIdx });
  }

  /** Guest → host: car selection */
  sendGuestReady(carIdx) {
    return this.#send('guest_ready', { id: this.myId, carIdx });
  }

  /** Host → all: race start with full slot list */
  sendGameStart(slots, trackId) {
    return this.#send('game_start', { slots, trackId });
  }

  /** Host → all: kick a real player */
  sendPlayerKick(targetId) {
    return this.#send('player_kick', { targetId });
  }

  // ── In-race ──────────────────────────────────────────────────────────────────
  /** Any player (or host for AI) → all: position snapshot ~20 Hz */
  sendPosUpdate(id, x, z, hdg, spd, lap, totalProg) {
    return this.#send('pos_update', { id, x, z, hdg, spd, lap, totalProg });
  }

  /** One-shot: a car finished the race */
  sendPlayerFinished(id, finTime) {
    return this.#send('player_finished', { id, finTime });
  }
}

/** Random 4-char uppercase room code */
export function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

/** AI bot names */
export const BOT_NAMES = ['Bot Alpha', 'Bot Beta', 'Bot Gamma', 'Bot Delta'];
