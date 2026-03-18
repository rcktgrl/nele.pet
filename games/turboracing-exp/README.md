# TurboRacing Experimental

TurboRacing Experimental is the data-driven branch of the racing game inside this repo.
This refactor keeps the feature set intact while reorganizing the code so car data,
track-generation logic, and shared utilities are easier to extend.

## Structure

- `data/`
  - Static gameplay data such as cars and gearbox definitions.
- `scripts/`
  - Runtime game systems, UI, rendering, and gameplay orchestration.
- `scripts/utils/`
  - Shared helper functions used across multiple files.
- `scripts/editor/`
  - Track-editor specific shared helpers.
- `scripts/track/`
  - Track-generation submodules such as scenery generation.
- `tracks/`
  - JSON track data only.

## Refactor notes

- Car stats and car model definitions now live together in `data/cars.js`.
- Shared formatting and geometry helpers were moved into `scripts/utils/`.
- Oversized files were split so the main editor and track generator stay below 1000 lines.
- Unused/legacy duplicates such as the old local `util.js` and the nested `scripts/data/*` copies were removed.

## Maintenance guidelines

- Add new cars in `data/cars.js` so stats and visuals remain synchronized.
- Put reusable helpers in `scripts/utils/` instead of duplicating them.
- Keep tracks and other pure content in data-oriented folders rather than under runtime scripts.
