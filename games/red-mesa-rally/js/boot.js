'use strict';
/* Red Mesa Rally · Boot */

/* ---------------- boot ---------------- */
const GAME = new Game();
const startGame = (data) => GAME.boot(data || null).catch((e) => { console.error(e); $('loadText').textContent = 'Could not start: ' + e.message; });
if (window.claude?.hot?.ready) window.claude.hot.ready(startGame); else startGame(window.claude?.hot?.data ?? null);
