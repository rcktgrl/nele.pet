'use strict';
import { supabase } from './supabase.js';

/**
 * VsNetwork — real-time racing via Supabase channels.
 * Mirrors the Bomber Network class: host-authoritative roster via lobby_state,
 * presence used only for disconnect detection.
 */
export class VsNetwork {
  constructor() {
    this.channel = null;
    this.myId = crypto.randomUUID();
    this.roomCode = null;

    // Callbacks — assign before joinRoom()
    this.onPresenceLeave  = null;  // ([leftPlayers]) — disconnect detection only
    this.onPlayerHello    = null;  // ({id, name, isHost, carIdx})
    this.onPlayerLeave    = null;  // ({id}) intentional leave broadcast
    this.onGuestReady     = null;  // ({id, carIdx}) guest car selection change
    this.onLobbyState     = null;  // ({roster, trackId, gameRunning}) host-authoritative
    this.onReturnLobby    = null;  // () host sent everyone back to lobby
    this.onGameStart      = null;  // ({slots, trackId}) race starting
    this.onPlayerKick     = null;  // ({targetId})
    this.onPosUpdate      = null;  // ({id, x, z, hdg, spd, lap, totalProg})
    this.onPlayerFinished = null;  // ({id, finTime})
  }

  async joinRoom(roomCode, playerName, isHost, carIdx = 0) {
    this.roomCode = roomCode;

    this.channel = supabase.channel(`turborace-vs:${roomCode}`, {
      config: {
        broadcast: { self: false },
        presence:  { key: this.myId },
      },
    });

    // Presence: only for disconnect detection, NOT for join discovery
    this.channel.on('presence', { event: 'leave' }, ({ leftPresences }) => {
      this.onPresenceLeave?.(leftPresences.flat());
    });

    const on = (event, cb) =>
      this.channel.on('broadcast', { event }, ({ payload }) => cb?.(payload));

    on('player_hello',    p => this.onPlayerHello?.(p));
    on('player_leave',    p => this.onPlayerLeave?.(p));
    on('guest_ready',     p => this.onGuestReady?.(p));
    on('lobby_state',     p => this.onLobbyState?.(p));
    on('return_lobby',    p => this.onReturnLobby?.(p));
    on('game_start',      p => this.onGameStart?.(p));
    on('player_kick',     p => this.onPlayerKick?.(p));
    on('pos_update',      p => this.onPosUpdate?.(p));
    on('player_finished', p => this.onPlayerFinished?.(p));

    await new Promise((resolve, reject) => {
      this.channel.subscribe(async status => {
        if (status === 'SUBSCRIBED') {
          try {
            await this.channel.track({ id: this.myId, name: playerName, isHost });
          } catch (e) {
            console.warn('[vs-network] presence track failed:', e);
          }
          this.#send('player_hello', { id: this.myId, name: playerName, isHost, carIdx });
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

  // ── Lobby ─────────────────────────────────────────────────────────────────────
  sendPlayerLeave(id) { return this.#send('player_leave', { id }); }

  sendGuestReady(carIdx) { return this.#send('guest_ready', { id: this.myId, carIdx }); }

  // Host broadcasts the full ordered roster so every client renders identical UI.
  // roster: [{id, name, isAI, isHost, carIdx}]; trackId: string|null; gameRunning: bool
  sendLobbyState(roster, trackId, gameRunning) {
    return this.#send('lobby_state', { roster, trackId: trackId ?? null, gameRunning: !!gameRunning });
  }

  sendReturnLobby() { return this.#send('return_lobby', {}); }

  sendPlayerKick(targetId) { return this.#send('player_kick', { targetId }); }

  // ── Race ──────────────────────────────────────────────────────────────────────
  sendGameStart(slots, trackId) { return this.#send('game_start', { slots, trackId }); }

  sendPosUpdate(id, x, z, hdg, spd, lap, totalProg) {
    return this.#send('pos_update', { id, x, z, hdg, spd, lap, totalProg });
  }

  sendPlayerFinished(id, finTime) { return this.#send('player_finished', { id, finTime }); }

  // ── Helpers ───────────────────────────────────────────────────────────────────
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

/** Random 4-char uppercase room code */
export function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

/** AI bot names */
export const BOT_NAMES = ['Bot Alpha', 'Bot Beta', 'Bot Gamma', 'Bot Delta'];
