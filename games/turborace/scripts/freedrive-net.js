'use strict';
import { supabase } from './supabase.js';

/**
 * FreeDriveNetwork — drop-in open-world multiplayer via Supabase channels.
 *
 * Unlike VS mode there is no lobby, no host and no room code: everyone who
 * enables Online shares one persistent island channel. Presence is the
 * roster (sync fires on every join/leave) and a single broadcast event
 * carries position updates.
 */
export class FreeDriveNetwork {
  constructor() {
    this.channel = null;
    this.myId = crypto.randomUUID();

    // Callbacks — assign before join()
    this.onRoster = null;  // ([{id, name, carIdx, color}]) full presence roster
    this.onPos    = null;  // ({id, x, z, hdg, spd})
  }

  async join(worldId, name, carIdx, color) {
    this.channel = supabase.channel(`turborace-freedrive:${worldId}`, {
      config: {
        broadcast: { self: false },
        presence:  { key: this.myId },
      },
    });

    this.channel.on('presence', { event: 'sync' }, () => {
      this.onRoster?.(this.getPlayers());
    });
    this.channel.on('broadcast', { event: 'fd_pos' }, ({ payload }) => this.onPos?.(payload));

    await new Promise((resolve, reject) => {
      this.channel.subscribe(async status => {
        if (status === 'SUBSCRIBED') {
          try {
            await this.channel.track({ id: this.myId, name, carIdx, color });
          } catch (e) {
            console.warn('[freedrive-net] presence track failed:', e);
          }
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          reject(new Error(`Channel ${status}`));
        }
      });
    });
  }

  getPlayers() {
    if (!this.channel) return [];
    return Object.values(this.channel.presenceState()).flat();
  }

  sendPos(x, z, hdg, spd) {
    return this.channel?.send({ type: 'broadcast', event: 'fd_pos', payload: { id: this.myId, x, z, hdg, spd } });
  }

  async leave() {
    if (this.channel) {
      await this.channel.unsubscribe();
      this.channel = null;
    }
  }
}
