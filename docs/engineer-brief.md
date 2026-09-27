# Engineer brief

Build Neon Swarm as the game design doc (`docs/game-design.md`) describes it, as a static web game on GitHub Pages. You own every technical decision; the constraints, quality bars and milestone checks below define done.

## What to build

The game described in the game design doc, for one player in one browser. That doc is the single source of truth for behaviour and balance targets; its Numbers appendix holds the starting values.

## Constraints and quality bars

These are fixed; everything else is your call.

**Constraints**

- Static site, deployed to GitHub Pages by GitHub Actions on every push to `main`. The repo exists and Pages via Actions is enabled.
- Desktop browsers (current Chrome, Firefox, Edge, Safari), keyboard only.
- No audio. No external asset files: every visual is generated in code. No backend, accounts, analytics or network requests after the page loads.
- Progress persists in the browser between visits.

**Quality bars**

- 60 fps (p95 frame time 16.7 ms or less) with 800 enemies and active Link cascades, on a 2020-era laptop with integrated graphics.
- Page load to first input under 10 s on a cold cache.
- No console errors during a full run.
- The same seed and the same inputs reproduce the same run.

## What you own

Stack, architecture, file layout, tests and tooling are yours to choose. Whatever you pick has to give you these capabilities, hidden from normal play:

- Start a run at any time with any build, and grant weapons, levels and Links on demand.
- Trigger Surges and bosses on demand.
- An on-screen readout of frame time, entity counts and cascade load.
- Automated checks of the Link rules, the XP curve and the director formulas.
- A way to run many fast simulated runs and compare levels reached against the design's checkpoints.

## Working rules

1. Keep every tuning number in one place in code, so balance changes never touch logic. Seed it from the Numbers appendix; from then on the code is the source of truth for values. You may change any value to hit the Balance targets in the game design doc, logging each change in `DECISIONS.md` (old value, new value, why). The targets themselves change only through the designers.
2. Build no feature, screen or system that isn't in the game design doc.
3. Where the design is silent, pick the simplest option that fits its pillars. Log it in `DECISIONS.md` with a one-line reason.
4. Where a design rule proves unplayable or contradicts another, apply the smallest fix, log it the same way, and flag it in the milestone summary.
5. Keep `main` building and deploying. Work in milestone order, with gameplay on placeholder shapes until milestone 3.
6. End each milestone with a short summary: what's done, the result of each check, and new `DECISIONS.md` entries.

## Milestones

Four milestones, in order. A milestone is done only when every check passes on the live Pages URL.

| Milestone | Content | Done when |
| --- | --- | --- |
| 1 Prototype | VANGUARD with WASD and the camera; the horde; contact damage and death; Pulse Rifle, XP and the level-up draft; Tesla Chain and Links with the cascade limit; one Ring Surge with Overflow | 800 enemies plus a Pulse → Tesla cascade meet the frame-time bar; a Link visibly changes the fight; Surge 1 arrives at 1:30 and Overflow collects every core |
| 2 Vertical slice | The 6 starting weapons with trigger forms; Mite, Skitter, Carapace, Splitter and elites; the full Surge schedule and director; Brood Mother and Overmind; all four card types; Codex, unlocks, hangar, run summary; saved progress | A full 15-minute run plays start to finish; all 30 ordered pairs of the 6 weapons trigger correctly; simulated runs land within ±3 levels of the design checkpoints; unlocks survive a reload |
| 3 Content and visuals | Cryo Emitter, Ion Mines, Railgun, Singularity Core; Spitter; SPARK and COLOSSUS; Crystal Mining Moon; Threat Levels; Endless; the visual pass from Art direction, including every feedback effect | All 90 ordered pairs trigger correctly; no placeholder visuals remain; enemies read by silhouette with 500+ on screen; across 20 simulated runs, no single Link appears in more than 20% of builds |
| 4 Polish | HUD and pause build view, settings, Apex names, camera widening, automatic quality scaling | Every quality bar passes; 20 runs complete without a crash or console error |
