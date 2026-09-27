# Neon Swarm

A 15-minute browser horde survivor about building chain reactions. Design: `docs/game-design.md`.
Engineering brief: `docs/engineer-brief.md`. Engineering decisions: `DECISIONS.md`.

Play: https://malkefjes.github.io/neon-swarm/ (WASD or arrows to move, 1/2/3 to pick a card, R to reroll, Esc to pause).

## Develop

```sh
npm install
npm run dev        # local server
npm test           # rule checks: Link rules, XP curve, director formulas, reproducibility
npm run build      # typecheck + production build into dist/
npm run sim -- --runs 20 --seconds 900   # fast simulated runs vs the design's level checkpoints
```

Every push to `main` is tested, built and deployed to GitHub Pages (`.github/workflows/deploy.yml`).

## Layout

- `src/tuning.ts` — every tuning number. Change values here only (log changes in `DECISIONS.md`).
- `src/sim/` — the deterministic, headless simulation (no DOM). `world.ts` is the game step; `weapons.ts` the six weapons and their trigger forms; `director.ts` spawning, elites and Surges; `bosses.ts` the Brood Mother and Overmind; `build.ts` the hardpoints and Link rules; `draft.ts` the level-up cards; `formulas.ts` the design's formulas; `bot.ts` the autopilot for simulated runs.
- `src/meta.ts` — unlocks, the Codex and saved progress (localStorage).
- `src/render/` — Three.js renderer (placeholder shapes until milestone 3), the DOM HUD and the menu screens.
- `src/assets/sentinel.glb` — the player model, as supplied (DECISIONS.md U1).
- `src/dev.ts` — hidden dev tools.
- `tests/` — Vitest suites. `tools/` — simulation runner and the milestone check script.

## Dev tools (hidden)

Add `?dev` to the URL for the readout (frame time, sim/render cost, entity counts, cascade load per Link part).
The `` ` `` key opens a panel to grant weapons, levels and Links, raise Chain Levels, trigger a Surge, spawn enemies, toggle god/stress mode and start a benchmark.

URL parameters (with `?dev`): `seed=123`, `build=pulse:5,tesla:3`, `link=pulse>tesla:5` (head>tail:chainLevel),
`stat=rate:2,power:1.5`, `god=1`, `stress=1` (every trigger roll succeeds), `t=80` (jump the clock), `surge=1`,
`bench=800&minutes=15` (hold 800 enemies on screen with 15:00 HP, god mode, no drafts), `boss=brood|overmind`, `elite=1`,
`bot=1` (autopilot), `speed=8` (run the sim 8× real time), `autostart=1`.

`window.neon` (dev only): `world`, `profile`, `screen`, `restart()`, `stats()`, `cpuBench(seconds)`, `events`, `resetProfile()`.

Milestone checks against a deployed build: `node tools/m1-check.mjs <url> <outDir>` and `node tools/m2-check.mjs <url> <outDir>`
(need Playwright + Chromium); `.github/workflows/live-check.yml` runs them after every deploy, together with
`npm run sim -- --runs 20 --seconds 910 --god --check` (simulated runs against the design's level checkpoints).
