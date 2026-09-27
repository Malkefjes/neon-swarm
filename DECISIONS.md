# Decisions

Engineering decisions made while building Neon Swarm, per the working rules in
`docs/engineer-brief.md`. Three kinds of entry:

- **Silent**: the design doesn't say; the simplest option that fits the pillars.
- **Fix**: a design rule proved unplayable or contradicted another; smallest fix (flagged in the milestone summary).
- **Tuning**: a change to a value in `src/tuning.ts` (old → new, why).

## Milestone 1

### Stack and architecture (silent)

| # | Decision | Reason |
| --- | --- | --- |
| 1 | TypeScript + Vite + Three.js (bundled), Vitest for tests. Deployed by `.github/workflows/deploy.yml` on push to `main`. | Small static bundle, no network requests after load, instanced rendering for 800+ enemies. |
| 2 | The simulation (`src/sim/`) is headless, fixed-step at 60 Hz, and draws all randomness from one seeded PRNG (sfc32). Runs replay from seed + per-tick input log + choice log (`replay()` in `src/sim/world.ts`). | Reproducible runs (quality bar), fast headless simulated runs, and testable rules. |
| 3 | Slow-mo and hit-stop scale the sim's `dt` per fixed tick rather than the tick rate. | Keeps slow-mo deterministic. |
| 4 | The sim uses a fixed nominal 30 × 17 u view for spawning and despawning, independent of window size. The renderer always shows at least that area; wider windows see a little more. | Window size must not change a seeded run. |
| 5 | Every tuning number lives in `src/tuning.ts`. Numbers the design doesn't give are also there and listed below. | Working rule 1. |
| 6 | Hidden dev tools behind `?dev` (readout, panel on the `` ` `` key, URL build setup, `window.neon`); see README. | Brief: capabilities hidden from normal play. |
| 7 | Weapons pool for milestone 1 is Pulse Rifle and Tesla Chain (`TUNING.weaponPool`). | Milestone 1 scope. |

### Rules the design leaves open (silent)

| # | Decision | Reason |
| --- | --- | --- |
| 8 | "More than 1.5 screens away" = the enemy's screen offset from the camera centre exceeds 1.5 × the view width horizontally or 1.5 × the view height vertically. It is moved to a fresh off-screen spawn point and keeps its Surge membership. | Simplest reading; keeps Surge counts intact. |
| 9 | Director: unspent threat carries over up to 5 s of income (`director.maxBankedSeconds`). All live enemies, Surge units included, count toward the on-screen target. | Avoids a burst of stored spawns after a lull; Surges replace normal pressure while they're alive. |
| 10 | Unit mix windows past 1:30 fall back to Mites until milestone 2 adds those units. The Surge schedule holds Surge 1 only for now. | Milestone 1 scope. |
| 11 | Ring formation: rows of units on circles around the mech starting at 16 u (the camera edge), 0.85 u apart, extra rows outward until the Surge size is placed; clamped inside the arena. Surge size is rounded to the nearest unit. | Simplest ring that starts at the camera edge and closes in at unit speed. |
| 12 | Pulse Rifle aims each bolt at a different nearby enemy (nearest first, within 13 u); spare bolts fan out 8° around the nearest. With no target it holds fire. Bolts fly 14 u. | Auto-aim that spreads fire across a horde. |
| 13 | "Pierce N" = passes through N enemies (hits up to N + 1). | Common genre reading. |
| 14 | Tesla Chain: first target is the nearest enemy within 9 u of the mech; each jump hits one new enemy (jumps = enemies hit), jumping to the nearest un-hit enemy within 4 u × Area. L4 starts 2 chains on the 2 nearest enemies. L5 forks at the 4th hit into two branches, each continuing for the remaining jumps. An enemy is hit at most once per activation. | Simplest reading of the level table. |
| 15 | Trigger chance uses the base chance of the part being fired (e.g. Pulse → Tesla rolls Tesla's 25%). | The trigger-forms table lists chance per triggered weapon. |
| 16 | Pulse trigger burst: 3 bolts in a 40° fan centred on the mech → hit line, 12 u range, L5 damage and pierce, ignoring the enemy that sourced it. Tesla trigger: 3 jumps starting at the nearest enemy to the hit point other than the source. | Directional forms aim along mech → hit (Link rules §3). |
| 17 | The 0.25 s per-enemy gate starts only when a roll succeeds; while it runs, that enemy makes no rolls for that part. | "Source at most one trigger". |
| 18 | Limiter is a token bucket per Link part (capacity 60, refill 150/s). Triggered effects counted against the 1,500 cap are triggered bolts plus triggered Tesla chains (for the life of their arcs). At the cap with no continuous effect to end (none exist in milestone 1), the new trigger is skipped and banked like a limiter skip. | Keeps "fewer, bigger effects" at the cap. |
| 19 | A draft holds at most one Link card (a random eligible Link), in the first slot. Picking it opens a second step to choose the head (keys 1/2). A reroll keeps the Link card in the draft if it had one. | One readable choice per card; keeps rerolls from dodging the guarantee. |
| 20 | Link cadence: the Link card appears when a Link is possible and the previous draft had none; taking a Link resets the cadence so the next new Link is guaranteed. | "Guaranteed in the next draft, then offered in every other draft until taken." |
| 21 | A new pair starts at Chain Level 1 and sits in the lower-numbered of its two hardpoints. An Apex keeps the Chain Level of the chain it extends. | Design gives no Apex starting level. |
| 22 | All four card types are live in milestone 1 (Stat boosts and Chain Level included). | With two weapons, a 3-card draft often can't be filled otherwise. |
| 23 | Level-ups earned during the Overflow slow-mo wait until it ends, then show one after another. | "Level-ups queue with a short slow-mo." |
| 24 | Overflow slow-mo is 1.5 s of real time (0.75 s of game time). Cores pulled by Overflow fly at 30 u/s until collected; cores dropped during the slow-mo are pulled too. Magnetised cores fly at 14 u/s; pickup at 0.9 u. | Every core reaches the mech within a few seconds. |
| 25 | Contact: touching = within the two radii + 0.05 u. When several enemies touch, the hit uses the highest contact damage among them. Mites overlapping the mech are pushed out of it (the mech shoulders through, unslowed). | Swarm pressure without the mech being pinned. |
| 26 | Crowd: soft separation pushes each of two overlapping enemies apart by 25% of the overlap per tick. | Soft, stable piling. |
| 27 | Mech reaches its target velocity linearly within 0.1 s, both speeding up and stopping. | "Top speed in ~0.1 s, no drift." |
| 28 | Camera: exponential soft follow at 6/s toward the mech plus 0.35 s of its velocity (look-ahead). No widening until milestone 4. | Simple, smooth follow. |
| 29 | Death: game time runs at 30% for 0.6 s of game time (2 s real), then a minimal run-over panel with "Deploy again" (Enter). The full run summary is milestone 2. | Minimal playable loop now. |
| 30 | Title screen is a single "press any key" panel that deploys VANGUARD on the Station; the Hangar and pre-run screens come in milestone 2. A minimal pause panel (Esc/Tab; Backspace restarts) is live; losing window focus pauses. | Minimal playable loop now. |
| 31 | Arena: bounded 200 × 200 u, no obstacles yet. | Maps arrive with their milestone. |
| 32 | Enemy hit flash lasts 1 tick. Triggered effects draw at 70% size and brightness. A Link forming hit-stops the sim for 60 ms and flashes white. | Art direction values. |
| 33 | Render pixel ratio capped at 1.5. | Protects integrated GPUs on high-DPI screens until milestone 4 quality scaling. |

### Design fixes (flag in summary)

| # | Rule | Fix |
| --- | --- | --- |
| F1 | Link rules §3 says a triggered effect uses the weapon's **L5** stats; the appendix trigger-forms heading says **current** stats. | Use L5 stats, as the Link rules say. Identical for VANGUARD, since only L5 weapons can be Linked; matters only for SPARK, whose row already says "trigger forms use L4 stats". |

### Tuning changes

None yet: every appendix value is as written. Values the appendix doesn't give (all in `src/tuning.ts`): Pulse acquire range 13 u and bolt range 14 u, Pulse trigger fan 40°, Tesla acquire range 9 u, Tesla arc life 0.18 s, ring radius 16 u and spacing 0.85 u, core speeds (14 / 30 u/s) and pickup radius 0.9 u, crowd separation 0.5, camera follow 6/s and look-ahead 0.35 s, death slow-mo 0.6 s at 30%.
