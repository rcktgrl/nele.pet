# CLAUDE.md — nele.pet Codebase Guide

This file provides context for AI assistants working on this codebase.

## Project Overview

**nele.pet** is a personal portfolio/hobby site (domain: `nele.pet`) built with vanilla JavaScript and no framework. It features an artist portfolio homepage, a blog, a full gallery, a story page, and an arcade section with three browser games. Backend services are provided by Supabase (PostgreSQL + Auth).

## Repository Structure

```
nele.pet/
├── index.html              # Homepage
├── blog.json               # Blog post data (newest-first on page)
├── CNAME                   # Domain config: nele.pet
├── package.json            # Dev tooling only (ESLint)
├── eslint.config.mjs       # ESLint flat config (browser globals)
│
├── scripts/                # Homepage JavaScript modules
│   ├── index.js            # Coordinator — imports and wires all modules
│   ├── audio-controls.js   # Volume control + bark sound playback
│   ├── cookie-consent.js   # First-visit consent popup
│   ├── hero-slider.js      # Auto-rotating featured artwork (20s interval)
│   ├── ocs-gallery-slider.js  # OC artwork carousel
│   ├── pawprints.js        # Guestbook panel (Supabase, XSS-safe)
│   ├── gallery-data.js     # Artwork data for homepage + full gallery
│   ├── blog.js             # Blog page logic
│   ├── gallery-page.js     # Gallery page with lightbox
│   └── story.js            # Story page logic
│
├── styles/                 # CSS stylesheets
│   ├── index.css           # Homepage (~607 lines)
│   ├── blog.css            # Blog page (~239 lines)
│   ├── gallery.css         # Gallery page (~146 lines)
│   └── story.css           # Story page (~262 lines)
│
├── assets/                 # Static media (audio, icons, images)
│
├── pages/                  # Additional HTML pages
│   ├── blog.html
│   ├── gallery.html
│   └── story.html
│
├── games/                  # Arcade section
│   ├── index.html          # Arcade hub/menu
│   ├── scripts/            # Shared game scripts
│   ├── styles/             # Shared game styles
│   ├── turborace/          # F³ Racing (production)
│   ├── turboracing-exp/    # F³ Racing Experimental (data-driven refactor)
│   └── fusion-towerdefense/ # Neon Tower Defense
│
└── supabase/               # Database migration SQL scripts
    ├── arcade_auth_setup.sql
    ├── arcade_auth_username_login_update.sql
    ├── turborace_leaderboard_car_columns.sql
    └── turborace_leaderboard_ghost_data.sql
```

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla JavaScript (ES6 modules), HTML5, CSS3 |
| 3D Graphics | Three.js (CDN) |
| Backend/DB | Supabase (PostgreSQL + Auth + REST API) |
| Supabase client | @supabase/supabase-js v2.39.5 (CDN) |
| Linting | ESLint 10.x (flat config) |
| Build | None — no bundler, no transpile step |
| Deployment | Static site (GitHub Pages via CNAME) |
| CI/CD | GitHub Actions (Supabase keep-alive ping every 3 days) |

**There is no build step.** All code runs directly in the browser via `<script type="module">`.

## Development Workflows

### Local Development
Open HTML files directly in a browser or use a simple static server:
```bash
npx serve .          # or any static file server
# Then open http://localhost:3000
```

### Linting
```bash
npm install          # install ESLint dev dependency
npx eslint .         # lint all JS files
```

No test framework exists — testing is manual/browser-based.

### Adding a Blog Post
Edit `blog.json`. Entries are displayed newest-first. Each entry shape:
```json
{
  "date": "YYYY-MM-DD",
  "title": "Post title",
  "content": "HTML content string"
}
```

### Adding Gallery Artwork
Edit `scripts/gallery-data.js` — single source of truth used by both the homepage slider and the full gallery page.

### Database Changes
Add a new SQL migration file to `supabase/` and apply it manually via the Supabase dashboard or CLI. There is no migration runner — scripts are reference/setup files.

## Code Conventions

### JavaScript

- **ES6 modules** everywhere (`import`/`export`). No CommonJS.
- **Functional init pattern**: each module exports an `init*` function that returns a cleanup function:
  ```js
  export function initHeroSlider(config) {
    // setup...
    return function cleanup() { /* teardown */ };
  }
  ```
- `scripts/index.js` is the coordinator — it imports all modules, calls their init functions, and registers cleanups on `beforeunload`.
- **camelCase** for variables and functions, **UPPER_SNAKE_CASE** for module-level constants.
- **JSDoc comments** on exported functions.
- One responsibility per file — do not mix unrelated features in the same module.

### Supabase / Security
- Supabase anon key lives in client-side JS (this is intentional — Row Level Security policies on the database enforce access control).
- **Always HTML-escape user-generated content** before inserting into the DOM. The `pawprints.js` guestbook is the reference implementation.
- Never expose private/service role keys in any frontend file.

### CSS
- Mobile-first responsive design.
- CSS Grid for page layouts, Flexbox for component alignment.
- Accessibility-first: semantic HTML elements, ARIA labels/roles where needed, `prefers-reduced-motion` media query respected in animations.

### Games

#### turborace (production)
- Self-contained under `games/turborace/`.
- Main engine: `games/turborace/scripts/game.js` — Three.js scene, physics, input, leaderboard integration.
- Car meshes are procedurally generated from Three.js primitives (no external 3D assets).

#### turboracing-exp (experimental)
- Data-driven architecture: car definitions live in `games/turboracing-exp/data/cars.js` and `gearboxes.js`.
- See `games/turboracing-exp/README.md` and `games/turboracing-exp/data/README.md` for architecture docs.
- Preferred pattern for new game features: define data in `/data/`, reference it in game logic.

#### fusion-towerdefense
- Most modular of the three games.
- `games/fusion-towerdefense/js/` is organized into subdirectories: `core/`, `data/`, `projectiles/`, `render/`, `systems/`, `ui/`.
- Follow the existing subdirectory pattern when adding new game systems.

### Three.js / 3D Graphics
- All car meshes are built from box and cylinder primitives (visual recipes), not loaded from files.
- Reuse `MeshLambertMaterial` instances across similar geometry.
- See `games/turborace/docs/car-models.md` for the mesh assembly guide.

## Key Architecture Decisions

1. **No framework** — vanilla JS keeps the site fast and dependency-free. Do not introduce React, Vue, or similar.
2. **No bundler** — files are served as-is. Avoid adding Webpack/Vite/Rollup unless there is a compelling need discussed first.
3. **Data-driven content** — blog posts (`blog.json`), gallery artwork (`gallery-data.js`), and game car specs (`data/cars.js`) are all defined in data files, not hardcoded in logic. Follow this pattern for new content.
4. **Cleanup callbacks** — every `init*` function should return a teardown function to prevent memory leaks.
5. **Supabase for all persistence** — guestbook entries, leaderboards, and auth all go through Supabase. Do not add a separate backend.

## CI/CD

`.github/workflows/supabase-keepalive.yml` — pings the Supabase REST API every 3 days to prevent the free-tier project from hibernating. No deployment pipeline exists; changes to `main` are served directly by GitHub Pages.

## Docs to Read for Specific Areas

| Area | File |
|---|---|
| Experimental racing architecture | `games/turboracing-exp/README.md` |
| Car data schema | `games/turboracing-exp/data/README.md` |
| 3D car mesh construction | `games/turborace/docs/car-models.md` |
| Database schema | `supabase/*.sql` |
