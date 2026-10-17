'use strict';
/* Red Mesa Rally · Keyboard, touch and gamepad input */

/* ---------------- Input ---------------- */
class Input {
  constructor() {
    this.keys = new Set(); this.pressed = new Set();
    this.touch = { left: 0, right: 0, gas: 0, brake: 0, boost: 0, hand: 0 };
    this.steer = 0; this.usingPad = false;
    addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' && e.target.type === 'text') return; // typing a session code
      if ((['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Space'].includes(e.key) || e.code === 'Space') && e.target.type !== 'range') e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code); this.usingPad = false;
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    this.padPrev = [];
  }
  bindTouch() {
    const map = { tLeft: 'left', tRight: 'right', tGas: 'gas', tBrake: 'brake', tBoost: 'boost', tHand: 'hand' };
    for (const [id, k] of Object.entries(map)) {
      const el = $(id);
      const on = (e) => { e.preventDefault(); this.touch[k] = 1; el.classList.add('act'); try { el.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ } };
      const off = (e) => { this.touch[k] = 0; el.classList.remove('act'); };
      el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('lostpointercapture', off);
    }
  }
  was(code) { return this.pressed.has(code); }
  poll(dt) {
    const k = this.keys, T = this.touch;
    let thr = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) || T.gas;
    let brk = (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) || T.brake;
    let st = ((k.has('KeyD') || k.has('ArrowRight') || T.right) ? 1 : 0) - ((k.has('KeyA') || k.has('ArrowLeft') || T.left) ? 1 : 0);
    let hand = k.has('Space') || T.hand ? 1 : 0;
    let boost = k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyN') || T.boost ? 1 : 0;
    // gamepad
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads && [...pads].find((p) => p && p.connected);
    this.padButtons = [];
    if (pad) {
      const b = (i) => (pad.buttons[i] ? pad.buttons[i].value || (pad.buttons[i].pressed ? 1 : 0) : 0);
      const ax = pad.axes[0] || 0;
      const any = Math.abs(ax) > 0.15 || b(7) > 0.05 || b(6) > 0.05;
      if (any) this.usingPad = true;
      if (this.usingPad) {
        const dz = Math.abs(ax) < 0.12 ? 0 : (ax - Math.sign(ax) * 0.12) / 0.88;
        thr = Math.max(thr, b(7)); brk = Math.max(brk, b(6)); hand = Math.max(hand, b(1)); boost = Math.max(boost, b(0));
        if (Math.abs(dz) > 0) st = Math.sign(dz) * Math.pow(Math.abs(dz), 1.4);
      }
      for (let i = 0; i < pad.buttons.length; i++) { const p = pad.buttons[i].pressed; if (p && !this.padPrev[i]) this.padButtons.push(i); this.padPrev[i] = p; }
    }
    // keyboard steering ramps; pads are direct
    if (this.usingPad) this.steer = st;
    else { const rate = st === 0 ? 7 : (Math.sign(st) !== Math.sign(this.steer) ? 9 : 3.6); this.steer += clamp(st - this.steer, -rate * dt, rate * dt); }
    return { throttle: thr, brake: brk, steer: this.steer, handbrake: hand, boost };
  }
  padPressed(i) { return this.padButtons && this.padButtons.includes(i); }
  endFrame() { this.pressed.clear(); }
}
