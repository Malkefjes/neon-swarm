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

None in milestone 1: every appendix value was as written. Values the appendix doesn't give (all in `src/tuning.ts`): Pulse acquire range 13 u and bolt range 14 u, Pulse trigger fan 40°, Tesla acquire range 9 u, Tesla arc life 0.18 s, ring radius 16 u (20 u from milestone 2) and spacing 0.85 u, core speeds (14 / 30 u/s) and pickup radius 0.9 u, crowd separation 0.5, camera follow 6/s and look-ahead 0.35 s, death slow-mo 0.6 s at 30%.

## Milestone 2

### Rules the design leaves open (silent)

| # | Decision | Reason |
| --- | --- | --- |
| 34 | Arc Coil pulses a filled disc around the mech and only fires when an enemy is inside it; its L5 static field stays where it pulsed. Seeker Swarm missiles fly at 11 u/s, turn at 6 rad/s, live 2.5 s and burst on contact; they launch fanned out at the nearest enemies within 14 u. Blade Drones spin at 3.2 rad/s (Rate speeds up the spin); the 0.5 s per-enemy cooldown is shared by all the weapon's blades. Plasma Mortar shells fly 0.7 s to random enemies within 13 u; pool radius = 0.75 × blast; L4's +40% applies to shell and pool. Area scales every radius (rings, blasts, pools, blade orbit and size, Tesla jump range, bolt size). | Simplest readings of the weapon tables. |
| 35 | Auto-aim: a boss in range takes the first shot (Pulse's first bolt, Tesla's first chain, Seeker's first missile, Mortar's first shell); the rest go to the nearest enemies. | With pure nearest-first aim, the Overmind's summoned horde soaked almost all fire. |
| 36 | Trigger forms: the Arc ring hits the enemy that sourced it too; Seeker trigger missiles hunt the 2 nearest other enemies; a triggered blade orbits the fixed hit point; the Mortar trigger is the pool only. Missile blasts are projectile hits (one roll per enemy hit); Arc rings and Mortar shell impacts are area pulses. | Link rules §1 table. |
| 37 | Continuous effects roll on their 0.5 s damage ticks; each triggered blade keeps its own 0.5 s per-enemy cooldown. | "One roll per enemy per 0.5 s of contact." |
| 38 | Skitters zig-zag ±40° off their heading, switching every 0.6 s. A Carapace's front is the 90° arc around its direction of travel, judged from where the damage comes from (bolt path, blast centre, previous Tesla jump, blade position). Splitter Mites have current-time HP and don't count toward the Surge. Elites keep their unit's shape at 3× size and are never despawned; Shielded elites glow blue until the shield breaks. | Simplest readings. |
| 39 | The crowd pushes by mass (1/r²), so big units shove small ones; bosses don't move for the crowd. Carapaces (elite or not) and bosses block the mech. | "Stopped by Carapaces." |
| 40 | Elites come only from the forced one every 90 s from 2:00 and the Overmind's summons; affix 50/50; unit kind from the current mix. 50 ms hit-stop when one dies. | The director budget alone never buys elites. |
| 41 | Spitters arrive in milestone 3: their mix weight is dropped (the rest renormalise), Mites stand in for Surge 7's Spitter line, and Surge 9's "every unit type" is the other four. | Milestone scope. |
| 42 | Formations: Wall = rows 46 u long starting 19 u off one side, sweeping 30 u across before hunting; Tide = a packed disc 20 u off one side; Surge 4 = Mite rings with a Carapace ring (15% of the Surge) outside; Two Walls split 50/50 from opposite sides; Surge 7 = Carapace line (15%) then a Mite tide; Double Ring = Splitters inner (30%), Mites outer; Surge 9 = half a wall, half a ring. Unit splits: Surge 2 70/30 Mite/Skitter, Surge 3 90/10 Mite/Carapace, Surge 6 50/50 Skitter/Splitter. | The table gives formations and units, not counts. |
| 43 | Surge size uses the schedule slot n (the Brood Mother is slot 5), matching the table's base sizes. A Surge slower than 25 s makes the next one ×0.85. | Design says "smaller" without a number. |
| 44 | A living Brood Mother doesn't hold back the next Surge; normal spawns continue during her fight. She spawns 16 u from the mech. Charge every 7 s (24 u/s dash), contact 15; Acid Spit every 5 s, globs 6 u/s over 11 u for 8 damage; puddles 1.3 u, 6 damage per touch; Brood Burst ring 3.5 u. | Timings the design doesn't give. |
| 45 | Her guaranteed Link card is one extra draft (not a level) that always holds a Link card; with no Link possible she drops 2 Overflow Caches. | Simplest delivery. |
| 46 | Overmind: a 3.5 u core at the arena centre; beams 45 u long and 0.9 u wide; summoned elites appear 5 u from its edge; homing orbs every 2.5 s at 3 u/s (turn 1.2 rad/s, 10 damage, 9 s life). Summons and orbs continue into phase 3. The collapse starts from the arena's inscribed circle (100 u). | Numbers the design doesn't give. |
| 47 | Repair Kit and Magnet Pulse drop from kills at the appendix chances and cooldowns; pickups are collected at 0.9 u and pulled by the magnet like cores. An Overflow Cache is an instant level-up (one extra draft). | Simplest. |
| 48 | Screens: Title → Hangar (frames with lock state, unlock list, Codex) → Deploy goes straight to the Orbital Station at Threat 0. The pre-run biome and Threat screen arrives with the Moon and Threat Levels in milestone 3; SPARK and COLOSSUS show their lock state but deploy from milestone 3; settings are milestone 4. | Nothing to choose yet. |
| 49 | Codex "best kill count with that Link" = kills by effects that ordered pair triggered, best of any run; an Apex's best = kills by any part of that chain in a run. New Codex entries and unlocks are saved the moment they happen; best kills at run end (or restart). | Keeps progress if the tab closes mid-run. |
| 50 | Run summary: final build as chains, damage per chain (earlier configurations marked "before Link"), new Codex entries, unlocks earned; Enter deploys again, H returns to the Hangar. | The design's summary contents. |
| 51 | HUD adds a boss health bar with the Overmind's phase, and off-screen arrows for elites and bosses. | The phases are HP thresholds the player needs to read; arrows are in the HUD list. |
| 52 | Apex chains are listed by their parts until Apex names arrive in milestone 4. | Milestone scope. |
| 53 | Pacing checkpoints compare the XP level: levels earned from XP, not from Overflow Caches. The design derives the checkpoints from the XP curve and lists "~L41, plus ~8 Overflow Caches". The level shown in game includes cache levels (about +4 at 7:30, +9 at 15:00). | Matches how the design table was built. |
| 54 | Small screen shake on elite death and a bigger one on boss death, as in Art direction. The toggle arrives with settings (milestone 4). | Milestone scope. |

### Design fixes (flag in summary)

| # | Rule | Fix |
| --- | --- | --- |
| F2 | The XP curve (10 + 12L) and the kill rates (60 + 40t per minute, Mites worth 1 XP) can't both hold: by 3:00 they give about 540 XP, but L12 needs 902, while the late game gives more than L41 needs. | Tuning: Mite XP 1 → 2 and XP per level 12 → 16 (below). |
| F3 | Overmind 60,000 HP against the 20:00 enrage: on-pace builds took 5–7 minutes, running into the enrage nearly every time. | Tuning: 60,000 → 36,000 (below). |

### Tuning changes

| Value | Old | New | Why |
| --- | --- | --- | --- |
| `enemies.mite.xp` | 1 | 2 | Early XP comes almost only from Mites; at 1 XP, simulated runs reached XP level ~7 at 3:00 (target 12). |
| `xp.perLevel` | 12 | 16 | With Mite XP 2, later levels came too fast (XP level ~50 at 15:00). At 16, 20 of 20 simulated runs are within ±3 of all three checkpoints (means 11.3 / 22.8 / 42.1). |
| `bosses.overmind.hp` | 60,000 | 36,000 | On-pace builds deal ~150–250 DPS to the core under beam pressure; 60,000 HP took 5–7 minutes, past the 20:00 enrage. 36,000 takes about 3 minutes. |
| `surge.ringRadius` (not in appendix) | 16 u | 20 u | Ring Surges broke in ~7 s (target 8–20 s) because every unit arrives at once. |
| `surge.wallMarch` (not in appendix) | 42 u | 30 u | Two Walls broke in ~23 s because units marched far past the mech before hunting. With both changes, 124 of 160 simulated Surge breaks land in 8–20 s and 8 take over 25 s. |
| `crowd.cellSize` (not in appendix) | 1.2 u | 1.8 u | Performance only: a 3 × 3 cell walk now covers every overlap. |

Values the appendix doesn't give for milestone 2 are in `src/tuning.ts` next to their weapon, unit or boss, and summarised in entries 34–47 above.

## Milestone 3

### Rules the design leaves open (silent)

| # | Decision | Reason |
| --- | --- | --- |
| 55 | Cryo Emitter aims at the nearest enemy (a boss first). The cone ticks every 0.25 s ÷ Rate on a 2 s on / 1 s off cycle; enemies inside are slowed, and freeze after 1.5 s inside without a break. Bosses are slowed but never frozen. The L5 shatter deals 10 in 1.5 u around the dead enemy without rolling for Links. Its trigger form freezes (no damage) and is an area pulse for the next part. | Simplest readings of the Cryo rows. |
| 56 | Ion Mines drop within 1.5 u of the mech (only when an enemy is within 12 u), arm in 0.5 s, go off when an enemy's edge comes within 1.1 u, and last 20 s. At the cap the oldest solo mine is removed. L5 detonations set off mines within 3 u, armed or not. | Mines where the swarm chases you. |
| 57 | The Railgun fires along the mech's last movement direction whenever an enemy is within 18 u; the rail is instant and hits every enemy along it once. | "In travel direction". |
| 58 | The Singularity Core lands on the enemy with the most neighbours within 3 u among the 12 nearest (a boss if one is in range). It pulls at 3.5 u/s (bosses aren't pulled); damage ticks every 0.25 s and rolls for Links every 0.5 s; collapse radius 2 u before L5. The mini (trigger form) pulls within 2 u for 1.5 s and collapses for 50% of the frame's trigger-level collapse, in 2 u. | Numbers the table leaves open. |
| 59 | Spitters walk in until 7 u from the mech, hold, and fire a glob every 2.5 s (5 u/s, 12 u range, 8 damage × time scaling). Their globs don't leave puddles (those are the Brood Mother's). | Appendix values; puddles are hers. |
| 60 | COLOSSUS: the second trigger effect fires 0.1 s later from the same hit point, even if that enemy has died; each trigger takes two limiter tokens. SPARK: "an L5 weapon" for an Apex means a weapon at its Link level (L3). | See F4. |
| 61 | Threat Levels: +15% speed applies to the Brood Mother too; Threat 5 gives Spitters a mix weight of 15 in windows that have none; Threat 8 makes 8 of each Brood Burst's 30 units Splitters, and the Overmind fires 5 beams in every phase; Threat 9 makes every 10th Surge unit a Carapace; Threat 10 caps starting max Hull at 60 (Hull cards still add). | Simplest readings. |
| 62 | Endless: the Overmind's death counts as a win (unlocks, Threat progress) and the run goes on. Surges continue every 90 s from 16:30, cycling the formations and continuing the size formula (n = 10, 11, …); as in normal runs, the next Surge waits for the last to break. The run ends at Hull 0. | The design names Endless without rules. |
| 63 | Winning at Threat N on either biome opens N + 1; winning on the Station at any Threat opens the Moon. | Feat table. |
| 64 | Station: a fixed layout of 36 axis-aligned boxes (3–7 u) and cylinders (1.5–3 u radius), at least 5 u apart and 18 u clear around the start (the escape lanes). Obstacles block the mech and enemies, not shots. 8 airlock vents run 4 s in every 14, pulling enemies within 9 u at 3.5 u/s. | Learnable map; always a way out. |
| 65 | Moon: 200 × 200 and wrapping; the world shifts in 20 u steps so the mech stays near the origin. 70 crystals (fixed layout) shatter when a bolt, missile or shell blast, Arc ring, rail, mine or collapse touches them, into 6 shards (12 damage × Power, 6 u) whose hits roll for the chain part that shattered the crystal; they regrow in 25 s. Shards don't shatter other crystals. | "Each shard counts as a hit for triggers"; no runaway chain. |
| 66 | Pre-run screen: biome, Threat Level (up to the highest unlocked) and mode (15 minutes / Endless), remembered between visits. | Design screen list. |
| 67 | Visual pass: enemy hues magenta on the Station and red on the Moon; lit bodies plus unlit glow parts that bloom; frozen enemies ice-white, slowed ones tinted; 4–6 shards per death fading in 0.5 s (24 for bosses); missile smoke trails; soft shadows under units; small shake on explosions of 2 u or more; bloom at half resolution. A cyan ring under the player keeps the frame findable in the crowd without touching the model. | Art direction. |
| 68 | SPARK and COLOSSUS use the Neon Sentinel model at 0.9× and 1.25× scale. | No other frame models were supplied. |
| 69 | A run starts only once the player model has loaded (the menus work meanwhile), so the stand-in frame never appears in play. | "No placeholder visuals remain". |
| 70 | Automated checks run gameplay scenes with bloom off (`?dev&quality=low`) because the check machines render in software; performance and screenshots use the full look. | Keeps real-time checks inside their time limits. |

### Design fixes (flag in summary)

| # | Rule | Fix |
| --- | --- | --- |
| F4 | An Apex needs "a two-part chain at Chain Level 3+ plus an L5 weapon", but SPARK caps weapons at L4. | For SPARK, "L5" reads as its Link level (L3). |
| F5 | The Overmind is "a stationary core at the arena centre", but the Moon wraps around and has no centre. | On the Moon it appears 20 u from the mech; its collapsing edge centres on it. |

### Tuning changes

| Value | Old | New | Why |
| --- | --- | --- | --- |
| `xp.base` | 10 | 6 | With the milestone 3 roster, 1 of 20 simulated runs fell more than 3 levels short at 3:00. At 6, 20 of 20 runs (starting weapons) are within ±3 at every checkpoint (averages 12.0 / 23.1 / 42.0). With all 10 weapons unlocked, 19 of 20 are: one autopilot run stalls early (XP level 3 at 3:00). |

The four new weapons, the Spitter, SPARK, COLOSSUS and the Threat Levels use the appendix values. Numbers the appendix doesn't give are in `src/tuning.ts` (weapons, `threat`, `endless`, `maps`) and summarised above.

## Directed by the owner

| # | Change | Detail |
| --- | --- | --- |
| U1 | The player is the supplied Neon Sentinel model, not a code-generated frame. This overrides the brief's "no external asset files" and the ~1,500-triangle frame budget for the player only. | `src/assets/sentinel.glb` is the supplied file, unmodified (22 MB, 10,103 triangles, its own textures and materials). It loads in the background after the title screen is up (a simple stand-in frame shows until it arrives). Scaled 1.35× (≈2.3 u tall); plays `Running` while moving (paced to speed) and `restpose` when still; the hit flash blinks it. |
| U2 | No weapon mounts or Link conduits on the mech. | Replaces design pillar 4's mounts and conduits. The build reads from the HUD hardpoints (weapons, levels, Links, Chain Levels) and the pause/run-summary chain diagrams. |
