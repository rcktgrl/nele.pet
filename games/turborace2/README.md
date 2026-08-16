# Turbo Race 2 — build output

Generated. Do not edit anything in this directory by hand; the next build
overwrites all of it.

Unlike the other games in this arcade, which are hand-written ES modules served
as-is, this one is a compiled bundle. The spec's stack (a TypeScript monorepo
and Rapier's WASM physics) does not survive being served raw, so the build
output is checked in instead.

Rebuild with, from the turbo-race-2 repository:

    pnpm exec vite build --sourcemap false
    cp -r dist/. <this-directory>/

Sourcemaps are deliberately off: they add ~22 MB, and this directory is already
the largest thing in the site repository.

## Pages

- `index.html` — the game.
- `editor.html` — the track editor. Draw a circuit, watch it validate live,
  press <kbd>D</kbd> to drive what you just drew. Saves drafts and exports map
  data as downloads; nothing is stored server-side.

## Status: alpha

A driving test, not a game. One car, one procedurally generated circuit, real
suspension and tyre physics, keyboard and gamepad input, three cameras. No AI
opponents, no lap timing, no progression, and no arcade account integration
yet — it does not use `games/scripts/arcade.js`.

## Source

The source repository is **not published anywhere yet** — it currently exists
only on the server that produced this build. That needs fixing before anyone
else can rebuild this directory.
