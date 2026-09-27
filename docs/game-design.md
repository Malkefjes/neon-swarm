# Neon Swarm — Game Design Doc

## Overview

Neon Swarm is a 15-minute browser horde survivor where you build a chain-reaction war machine: every weapon bolted onto your mech can be Linked into another, so one bullet sets off a cascade of lightning, missiles and black holes across hundreds of enemies.

**The loop players actually enjoy:** in this genre the fun isn't moving or aiming. It's the swing from barely surviving to watching your build melt the screen, and the moment a choice you made clicks into a synergy. Every system below exists to make that swing bigger, more frequent and more yours.

**Pitch:** "Build the chain reaction." Link Seeker Swarm into Tesla Chain, then into Singularity Core: every missile hit now sparks lightning that collapses into black holes.

**Design pillars** (ranked; a feature that serves none gets cut)

1. **Cascades are the fantasy.** The signature moment is one hit rippling into many. Link is the one deep system; everything else stays shallow.
2. **Authored tension and release.** A Surge crushes in every 90 s; breaking it floods XP and buys the next power spike.
3. **One verb.** WASD only. No dash, no aim, no ultimate. Skill is positioning and drafting.
4. **Your mech is your build.** Weapons mount visibly on the frame, Links run glowing conduits between mounts. You read your build by looking at your mech.
5. **Discovery drives replay.** 10 weapons, ordered Links, 90 two-part chains to find, and a Codex to fill: options, not grind.

**Scope:** a personal game on GitHub Pages, played in a desktop browser with a keyboard. No sound, no music, no monetisation, no accounts or backend. Runs last 15 minutes.

**How the docs are split:** this game design doc is the whole design, with starting numbers in the Numbers appendix at the end. The separate Engineer brief covers constraints and milestones for building it.

## Core loop: surge, carve, cascade

A run is 15 minutes of authored rhythm: every 90 seconds a Surge closes in, the player carves through it, and the XP flood that follows usually buys the next Link or weapon level.

**The loop in words:** within a run, Surge closes in → carve through it → Overflow XP burst → draft or Link → the next, bigger Surge. Across runs, run ends (Hull at 0 or Overmind beaten) → new Links logged → new parts unlocked → pick a frame → deploy again.

The Surge is the tension, the Overflow after it is the release, and each cycle should feel bigger than the last. That swing is the product.

**The 90-second beat**

| Beat | Length | What happens |
| --- | --- | --- |
| Build-up | ~60 s | Normal horde pressure, steady XP, 1–2 level-ups |
| Breath | ~10 s | Spawns pause, a warning ring shows at the screen edge, the scene dims slightly |
| Surge | ~15 s | A formation of 150–400 enemies (ring, wall or tide) closes in |
| Overflow | ~5 s | Breaking the formation pulls every XP core to the player; level-ups queue with a short slow-mo |

**Win and lose:** Hull at 0 ends the run. Everything discovered (Links, Codex entries, unlock progress) is kept either way. Endless unlocks after the first win.

## Controls and camera

Movement is the only verb; weapons fire and aim themselves, so every decision is where to stand and what to draft.

| Action | Key |
| --- | --- |
| Move | WASD or arrow keys |
| Pick a card | 1 / 2 / 3 or click |
| Reroll the draft | R, while cards are shown |
| Pause and view the build | Esc or Tab |
| Restart the run | Backspace, from the pause screen |

**Movement feel:** input mapped to the isometric axes (W is up-screen), top speed in ~0.1 s, no drift. The mech collides softly with the horde: it shoulders through Mites but is stopped by Carapaces, so the crowd's mass is felt.

**Camera**

- Orthographic, classic isometric angle (~35° pitch, 45° yaw), soft follow with look-ahead.
- Pulls back one step per filled hardpoint and per Link, so the growing cascade always fits on screen. The widening view is itself a power signal.
- Screen shake capped and toggleable.

## Frames and stats

Frames are rule-changers, not stat spreads: each bends the Link system a different way, so picking a frame changes how you draft. Three at launch.

| Frame | Starting weapon | Rule | Unlock |
| --- | --- | --- | --- |
| VANGUARD | Pulse Rifle | 4 hardpoints; the baseline | Default |
| SPARK | Tesla Chain | Links open at L3 instead of L5, but weapons cap at L4 | Make 3 Links in one run |
| COLOSSUS | Plasma Mortar | 3 hardpoints and 30% slower, but every trigger fires twice | Build a 3-part Apex chain |

**Stats:** Hull, Speed, Power, Rate, Area, Magnet. Base values and card steps are in the Numbers appendix.

## Hardpoints and Links

The build is 4 hardpoints. Each weapon levels 1–5, and any two L5 weapons can be Linked into one chain, which frees a hardpoint for a new weapon.

**How a Link works:** in a Link A → B, A fires as normal, and each A hit has a chance to fire B from the hit point instead of from the mech. The chain takes one hardpoint. Link it once more (A → B → C) for a 3-part Apex chain, the deepest allowed. Order matters: Seeker → Tesla (missiles that spark lightning) plays very differently from Tesla → Seeker (lightning that launches missiles).

**Launch weapons (10):** Pulse Rifle, Arc Coil, Tesla Chain, Seeker Swarm, Blade Drones, Plasma Mortar, Cryo Emitter, Ion Mines, Railgun, Singularity Core. Each has a solo pattern and a trigger form; both are specified in the Numbers appendix.

**Chain levels:** a finished chain keeps appearing in drafts as Chain Level cards (1–5), each raising every member's power and trigger chance.

**Mech as build sheet:** each weapon mounts to its own spot (shoulders, back, forearms, drone bay). A Link draws a glowing conduit between its mounts, and triggered effects take the colour of the weapon that fired them, so a cascade reads as a colour shift from hit to hit.

## Link rules

A Link is resolved entirely by hit events: the head weapon's hits roll for the next part, that part's triggered hits roll for the one after, and the tail rolls for nothing. These rules define exactly how Links behave.

**1. What counts as a hit event**

| Weapon type | Weapons | Trigger rolls |
| --- | --- | --- |
| Projectile | Pulse Rifle, Seeker Swarm, Railgun | One roll per enemy hit |
| Chain | Tesla Chain | One roll per jump |
| Area pulse | Arc Coil, Plasma Mortar shell, Ion Mines, Singularity collapse | Up to 3 rolls per activation, on 3 random enemies hit |
| Continuous | Blade Drones, Cryo Emitter, plasma pools, Singularity pull | One roll per enemy per 0.5 s of contact |

An enemy can source at most one trigger per Link part every 0.25 s, so one enemy can't be farmed.

**2. Structure**

- Only the head fires on its own. Linked-in parts fire only through triggers; that lost solo fire is the price of the freed hardpoint.
- Triggers flow one way (head to tail) and never loop back.
- Each weapon is owned at most once per run, so a chain never repeats a weapon.
- Linking two weapons: the player picks which one is the head.
- Making an Apex: a two-part chain at Chain Level 3 or higher plus an L5 weapon; the player picks front or back. Three parts is the maximum.

**3. Power of triggered effects**

- A triggered effect uses the triggered weapon's own L5 stats in its trigger form, times a trigger multiplier: ×0.6 at Chain Level 1, +0.1 per Chain Level, ×1.0 at Chain Level 5.
- Trigger chance = the weapon's base chance × (1 + 0.15 per Chain Level above 1), so +60% at Chain Level 5.
- Power and Area apply to every part. Rate applies only to the head, which raises trigger volume naturally.
- Position: triggered effects spawn at the hit point. Directional forms (Railgun, Cryo, Pulse burst) aim along the line from the mech through the hit point.

**4. Cascade limiter**

- Each Link part fires at most 150 triggers per second, with bursts of up to 60 at once.
- A trigger skipped over that limit isn't lost: it adds +10% power and +5% size to that part's next trigger, capped at +200% power and +50% size.
- At most 1,500 triggered effects exist at once; past that, the oldest continuous effects end first.

The player sees fewer, bigger effects, never a stutter.

**5. Naming and Codex**

- Every ordered pair logs to the Codex on first trigger.
- An Apex gets a generated name, the head's prefix plus the tail's noun (e.g. Seeker → Tesla → Singularity is the "Seeking Event Horizon"), and a unique conduit pattern on the mech.

## Level-up cards

Every level-up offers 3 cards from four types, so each draft is a readable choice between going wider, deeper, linking or buffing.

| Card | Effect | When it appears |
| --- | --- | --- |
| New weapon | Mounts on an empty hardpoint | A hardpoint is free |
| Weapon level | +1 level (L1–5); every level adds one visible change | A weapon is below L5 |
| Link | Joins two L5 weapons, or a chain at Chain Level 3+ and an L5 weapon (an Apex); the player picks the order | Two eligible parts exist; guaranteed in the next draft, then offered in every other draft until taken |
| Stat boost | One step of one of the 6 stats (sizes in the Numbers appendix); no slot, stacks | Always in the pool |

**Draft rules:** 3 rerolls per run; no banish, skip or rarity tiers. A Link card shows the two weapon icons joined head → tail with one line describing the trigger. Once everything is maxed, cards become Chain Level upgrades.

**Card weights** for the slots not taken by a Link card: Weapon level 40, New weapon 25 (only with a free hardpoint), Stat boost 20, Chain Level 15 (only once a chain exists). The same card never appears twice in one draft.

## Combat model

The player dies from being swarmed, not from single hits: contact damage is small, there is a short invulnerability window after each hit, and breaking a Surge heals, so position and build are what keep you alive.

**Taking damage**

- Enemies deal contact damage on touch; projectiles (Spitter globs, boss attacks) deal damage on hit.
- After any hit the mech is invulnerable for 0.5 s and flashes. Every enemy touching it is pushed back 1 u, so the player is never locked in place.
- Enemy damage scales with time (formula in the Numbers appendix). Threat Levels add more.

**Healing:** there is no regeneration stat. Hull comes back only three ways: breaking a Surge (+15 Hull), a Repair Kit (+30), and a Stat boost card for Hull (+10 max and +10 current).

**Dealing damage**

- Damage = the weapon's base × level bonuses × Power × (trigger multiplier if triggered). There are no crits and no damage types.
- Carapace fronts take 50% damage from their front 90° arc, which rewards orbiters, mines and triggers spawning behind them.
- Frozen enemies take +50% damage once Cryo Emitter reaches L3.
- There are no damage numbers; hits show as a white flash on the enemy.

**Death:** at 0 Hull the mech explodes and time slows while the final cascade plays out, then the run summary opens. There are no revives.

## Enemies, Surges and bosses

The Swarm threatens through density and formation, so 5 simple units arranged in authored Surges replace a large roster.

| Unit | Role | Behaviour | First appears |
| --- | --- | --- | --- |
| Mite | Fodder | Walks straight at the mech | 0:00 |
| Skitter | Fast fodder | Fast, low HP, zig-zags | 1:30 |
| Carapace | Wall | Slow, high HP, can't be shouldered through | 3:00 |
| Spitter | Ranged | Stops at range, fires slow globs | 4:30 |
| Splitter | Cascade food | Splits into 4 Mites on death, feeding more triggers | 6:00 |

**Surge formations**

- **Ring:** a closing circle; break a gap before it tightens.
- **Wall:** a thick line sweeping across the arena; punch through it or be pushed.
- **Tide:** a dense mass from one side; kite along it.
- **Mixed:** two formations or unit types layered together.

| Surge | Time | Formation | Units | Base size |
| --- | --- | --- | --- | --- |
| 1 | 1:30 | Ring | Mites | 180 |
| 2 | 3:00 | Wall | Mites, Skitters | 210 |
| 3 | 4:30 | Tide | Mites, 10% Carapaces | 240 |
| 4 | 6:00 | Ring | Carapace outer ring, Mites inside | 270 |
| 5 | 7:30 | Boss | Brood Mother replaces the Surge | — |
| 6 | 9:00 | Two Walls from opposite sides | Skitters, Splitters | 330 |
| 7 | 10:30 | Mixed | Carapace front line, Spitters behind, Mite tide | 360 |
| 8 | 12:00 | Double Ring | Mites outer, Splitters inner | 390 |
| 9 | 13:30 | Mixed | Wall plus closing Ring, every unit type | 420 |
| — | 15:00 | Boss | Overmind | — |

A Surge is broken when 70% of its units are dead.

**Elites:** 3× size, 10× HP, glowing outline, one of two affixes (Hasted or Shielded). Each drops an Overflow Cache, an instant level-up.

**Brood Mother (7:30)**, 5,000 HP, walks at 2 u/s toward the mech.

- **Charge:** a red line telegraphs for 1 s, then a 12 u dash dealing 25 damage.
- **Brood Burst:** every 10 s, 30 Mites spawn in a ring around her.
- **Acid Spit:** 3 globs in a 30° spread, each leaving an acid puddle for 3 s.
- Below 50% HP, she charges twice in a row.
- On death she drops a guaranteed Link card if one is possible, otherwise 2 Overflow Caches.

**Overmind (15:00)**, 60,000 HP, a stationary core at the arena centre. Normal spawns continue at 50% budget during the fight.

- **Phase 1 (100–66%):** 2 laser beams sweep at 30°/s, dealing 20 damage per touch.
- **Phase 2 (66–33%):** summons 2 elites every 15 s and fires slow homing orbs.
- **Phase 3 (below 33%):** the arena edge collapses inward at 0.5 u/s down to a 12 u radius, with 4 beams.
- **Enrage at 20:00:** beam speed doubles. Killing the Overmind wins the run.

**Director**

- **Budget and Surge sizing:** formulas in the Numbers appendix. Strong builds get bigger Surges; a Surge that takes over 25 s to break makes the next one smaller.
- **Spawning:** off-screen, 2–4 u beyond the camera edge. Enemies more than 1.5 screens away are despawned and respawned near the player.
- **Overflow:** on break, every core is pulled to the mech, the player heals 15 Hull, and time runs at 50% for 1.5 s.
- **Crowd physics:** soft separation, so the horde piles up against walls and the mech and cascades carve visible channels.

## XP and pickups

XP is the release valve: a steady trickle during build-up, a flood at every Overflow.

**XP curve:** XP needed to go from level L to L+1:

```latex
\text{XP}_{\text{next}}(L) = 10 + 12L
```

With the kill rates in the Numbers appendix (about 7,800 kills and 10,000 XP in a full run), this gives:

| Time | Expected level | What the build looks like |
| --- | --- | --- |
| 3:00 | ~L12 | 3–4 weapons, one close to L5 |
| 7:30 | ~L23 | 4 hardpoints full, first Link from the Brood Mother |
| 15:00 | ~L41, plus ~8 Overflow Caches | 2–3 Links, often one Apex |

| Pickup | Effect | Source |
| --- | --- | --- |
| Repair Kit | +30 Hull | Rare drop |
| Magnet Pulse | Pulls every core on the map | Rare drop |
| Overflow Cache | Instant level-up | Elites and bosses |

**Level-up UX:** the game pauses, 3 cards slide in, and queued level-ups follow one after another.

## Meta progression

Meta progression grows the menu, never the numbers: there is no currency and no stat shop, every unlock adds options, and the Link Codex is the long-term goal.

1. **Unlocks by feat:** start with 6 weapons (Pulse Rifle, Arc Coil, Tesla Chain, Seeker Swarm, Blade Drones, Plasma Mortar), VANGUARD and the Station. Everything else unlocks through the feats below.
2. **Link Codex:** a 10 × 10 grid of ordered pairs (head rows, tail columns). A discovered cell shows both icons and the best kill count with that Link; an undiscovered cell whose two weapons are both unlocked shows a dim outline, so the grid itself points at what to try next. Apex chains are listed below the grid by name.

| Unlock | Feat |
| --- | --- |
| Cryo Emitter | Beat the Brood Mother |
| Ion Mines | Make your first Link |
| Railgun | Break a Surge in under 8 s |
| Singularity Core | Discover 10 different Links |
| SPARK frame | Make 3 Links in one run |
| COLOSSUS frame | Build a 3-part Apex chain |
| Crystal Mining Moon | Win on the Station |
| Endless mode and Threat Level 1 | Win once |
| Threat Level N+1 | Win at Threat Level N |

**Threat Levels 1–10:** each adds one modifier on top of the ones below it.

| Threat | Added modifier |
| --- | --- |
| 1 | Enemies +15% speed |
| 2 | Elites every 45 s instead of 90 s |
| 3 | Surges +25% size |
| 4 | Repair Kits drop half as often |
| 5 | Spitters from 0:00, globs +50% speed |
| 6 | Enemy HP +30%, bosses included |
| 7 | Breaking a Surge no longer heals |
| 8 | Bosses gain an attack: Brood Mother spawns Splitters, Overmind fires 5 beams |
| 9 | Every Surge includes Carapaces |
| 10 | Max Hull 60 |

**Saved progress:** unlocks, the Codex, the highest Threat Level won and settings persist in the browser between visits.

## Maps

Launch with 2 biomes, each with one hazard that feeds cascades, so the map adds to the build instead of distracting from it.

| Biome | Look | Hazard | Unlock |
| --- | --- | --- | --- |
| Orbital Station Deck | Clean white panels, cyan lights | Airlock vents pull enemies into clumps, ideal for area chains | Default |
| Crystal Mining Moon | Purple crystals, dust | Crystals shatter into shrapnel, and each shard counts as a hit for triggers | Win on the Station |

**Structure:** bounded ~200 × 200 arenas with simple box and cylinder obstacles and always an escape lane; the Moon wraps around.

## Art direction

The look is clean, flat-shaded low poly with emissive accents and bloom: a dim, desaturated world where the player, weapons and pickups are the brightest things on screen.

**Procedural look:** every shape and effect is generated in code from simple low-poly forms; there are no asset files.

**No sound, so the screen carries all feedback:** a 60 ms hit-stop and a white flash when a Link forms; a radial light burst on level-up; a red vignette pulse when the mech takes damage; the Surge warning as a pulsing ring at the screen edge during Breath; a brief full-screen flash on Overflow; and a heavier shake plus slow-mo on boss death.

**Visual rules**

- **Colour hierarchy:** environment in muted mid-tones; enemies in one warm hue family per biome (magenta/red); the mech in white with cyan trim; each weapon owns one colour from a 10-colour palette that avoids the enemy hues (listed in the Numbers appendix); XP cores in saturated blue/green/gold. The player must never lose their frame in the crowd.
- **Shapes:** enemies read by silhouette at 32 px (spiky = fast, round = tank, tall = ranged). Frames are chunky mechs, 2–3× the size of a Mite.
- **Geometry budget:** frames ~1,500 tris, standard enemies 100–300 tris, elites and bosses up to 5,000. Flat shading, vertex colours or a small shared palette texture, no normal maps.
- **Lighting:** one directional light + ambient, baked-looking gradients; weapons light the scene via emissive + bloom rather than many dynamic lights.
- **VFX:** additive particles, trails and simple shader effects (dissolve on death, hit flash white for 1 frame). Death = the enemy shatters into 4–6 shards that fade within 0.5 s.
- **Juice:** hit-stop when an elite dies, small shake on big explosions.

**Cascade readability:** each weapon owns one colour, and a triggered effect keeps the colour of the weapon that fired it, so a chain reads as a colour sequence. Triggered effects render at ~70% size and brightness of the solo version, so the mech's own fire stays the focal point.

## UI/UX and HUD

The HUD stays at the screen edges and in thin holographic lines, leaving the centre for the fight.

**In-run HUD**

- Top: XP bar across the full width, level number, run timer centred.
- Top-left: the 4 hardpoints as icons with level pips; Linked weapons are drawn joined by a conduit, and a pulse marks a Link that's ready.
- Bottom-centre: Hull bar and the countdown to the next Surge.
- Top-right: kill count.
- Off-screen indicators for elites and bosses.

**Screens**

1. Title → Hangar (frame select, Codex, settings).
2. Pre-run: biome and Threat Level select.
3. Level-up overlay (cards), pause / build overview (all weapons, stats, Links).
4. Run summary: the final build drawn as a chain diagram, damage per chain, new Codex entries and unlocks earned. One-click "Deploy again".

**UX principles**

- Every screen is usable with the keyboard alone.
- Card text is short and numeric ("+1 blade, +10% dmg"), with a hold-to-expand detail.
- Settings: graphics preset (Low/Med/High/Auto), screen shake on or off.

## Decisions

All decisions are final; there are no open questions.

| Topic | Decision |
| --- | --- |
| Scope | Personal use on GitHub Pages; keyboard only; no audio, monetisation, accounts or backend |
| Trigger power | The triggered weapon's own stats × a Chain Level multiplier |
| Apex depth | 3 parts maximum, Endless included |
| Link access | Only from L5 parts; the Brood Mother guarantees one |
| Run length | 15 minutes; Endless after the first win |
| Meta | Unlock feats and the Codex; no currency, no Contracts, no cosmetics |

## Balance targets

These goals are fixed design; the Numbers appendix below is only the starting point for hitting them.

- **Pacing:** level ~12 at 3:00, ~23 at 7:30 and ~41 at 15:00, each within ±3 levels.
- **Surges:** a build that's on pace breaks each Surge in 8–20 s. Needing over 25 s should be rare.
- **Build variety:** no single Link appears in more than 20% of builds.
- **Difficulty:** at Threat 0, a player who has learned Links wins about 1 run in 3; each Threat Level is a step up, never a wall.

## Appendix: Numbers

Starting values only. Once the game is built, its tuning file is the live source for every number and this appendix is not kept in sync. Times are in seconds, distances in world units (u); the mech is about 1.5 u wide.

### Weapons

L1 weapons deal roughly 15–25 effective damage per second; each level is one visible change, and L5 is roughly 4–6× L1.

| Weapon | Colour | Damage | Cooldown (s) | Pattern |
| --- | --- | --- | --- | --- |
| Pulse Rifle | Cyan | 8 | 0.5 | 1 bolt, 20 u/s, no pierce |
| Arc Coil | Cobalt blue | 12 | 2.0 | Ring, 3 u radius |
| Tesla Chain | Indigo | 14 | 1.5 | 3 jumps, 4 u jump range |
| Seeker Swarm | Lime | 10 | 2.0 | 3 missiles, 1 u blast |
| Blade Drones | Silver | 9 per contact | — | 2 blades, 2.5 u orbit, 0.5 s per-enemy hit cooldown |
| Plasma Mortar | Amber | 20 shell, 5 per 0.5 s pool | 2.5 | 1 shell, 2 u blast, 2 s pool |
| Cryo Emitter | Ice white | 4 per 0.25 s | On 2 s, off 1 s | 90° cone, 4 u; 40% slow; freezes after 1.5 s inside for 1.5 s |
| Ion Mines | Yellow | 30 | 1.5 | 2 u blast, max 8 alive |
| Railgun | Emerald | 60 | 3.0 | Infinite pierce, 0.6 u wide, 18 u long, in travel direction |
| Singularity Core | Deep violet | 6 per 0.25 s, 40 collapse | 6.0 | 4 u pull, lasts 3 s |

**Level changes**

| Weapon | L2 | L3 | L4 | L5 |
| --- | --- | --- | --- | --- |
| Pulse Rifle | +1 bolt | +30% damage | Pierce 2 | +1 bolt, cooldown 0.4 |
| Arc Coil | Radius 3.75 u | +40% damage | Cooldown 1.4 | Leaves a static field: 4 per 0.5 s for 2 s |
| Tesla Chain | +2 jumps | +30% damage | 2 chains | +3 jumps, forks at jump 4 |
| Seeker Swarm | +2 missiles | +30% damage | Blast 1.8 u | +3 missiles |
| Blade Drones | +1 blade | +30% damage | Orbit 3.5 u, +40% spin | +2 blades |
| Plasma Mortar | +1 shell | Pool lasts 4 s | +40% damage | +2 shells, blast 3 u |
| Cryo Emitter | Cone 5 u | Frozen take +50% damage | Always on | Frozen enemies shatter on death: 10 in 1.5 u |
| Ion Mines | Max 12 | +40% damage | Cooldown 1.0 | Detonations set off mines within 3 u |
| Railgun | +40% damage | Width 1.2 u | Cooldown 2.2 | 3 rails in a 15° spread |
| Singularity Core | Pull 5 u | Lasts 4 s | Cooldown 4.5 | Collapse 120 in 3 u |

**Trigger forms** (the weapon's current stats × the trigger multiplier from Link rules)

| Weapon | Trigger form | Base chance |
| --- | --- | --- |
| Pulse Rifle | 3 bolts burst outward, 12 u range | 30% |
| Arc Coil | Ring at 50% radius | 25% |
| Tesla Chain | Chain of 3 jumps from the hit | 25% |
| Seeker Swarm | 2 missiles | 25% |
| Blade Drones | 1 blade orbits the hit point, 1.5 u, for 2 s | 20% |
| Plasma Mortar | Pool only, 1.5 u, 2 s | 20% |
| Cryo Emitter | Instant freeze for 1 s in 1.5 u | 20% |
| Ion Mines | 1 mine, arms after 0.3 s | 20% |
| Railgun | 1 rail, 10 u, continuing along mech-to-hit direction | 15% |
| Singularity Core | Mini: 2 u pull for 1.5 s, 50% collapse | 8% |

XP cores share hues with some weapons, so cores are told apart by shape: faceted, spinning gems that never appear in weapon effects.

### Enemies

Enemy HP grows about 7.75× over a run while contact damage grows 1.75×, so the danger comes from numbers.

| Unit | HP | Speed (u/s) | Contact damage | XP | Radius (u) | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Mite | 10 | 2.6 | 5 | 1 | 0.4 | Can be shouldered through |
| Skitter | 6 | 4.5 | 4 | 1 | 0.35 | Zig-zags every 0.6 s |
| Carapace | 80 | 1.6 | 12 | 5 | 0.9 | 50% damage from the front 90°; blocks the mech |
| Spitter | 25 | 2.2 | 6 | 2 | 0.5 | Holds at 7 u; glob 8 damage every 2.5 s at 5 u/s |
| Splitter | 30 | 2.2 | 6 | 2 | 0.6 | Splits into 4 Mites (scaled HP) |
| Elite (any) | ×10 | ×1 | ×2 | 25 | ×3 | One affix: Hasted (+60% speed) or Shielded (absorbs 50% of scaled HP first) |

**Scaling** (t = run time in minutes):

```latex
\text{HP}(t) = \text{HP}_{\text{base}} \times (1 + 0.15t + 0.02t^2)
```

```latex
\text{Damage}(t) = \text{Damage}_{\text{base}} \times (1 + 0.05t)
```

| Time | HP multiplier | Damage multiplier |
| --- | --- | --- |
| 0:00 | 1.0 | 1.0 |
| 3:00 | 1.63 | 1.15 |
| 7:30 | 3.25 | 1.38 |
| 15:00 | 7.75 | 1.75 |

Bosses don't scale with time; Threat Levels scale them instead.

### Director

Between Surges the director spends threat points on units, targeting about 660 kills per minute by 15:00. Surges come on top and ignore the on-screen target but not the 1,500 hard cap.

```latex
\text{Threat per second}(t) = 2 + 0.6t
```

```latex
\text{On-screen target}(t) = \min(50 + 40t,\ 650)
```

```latex
\text{Expected kills per minute}(t) = 60 + 40t
```

```latex
\text{Surge size}(n) = (150 + 30n) \times \text{clamp}\left(\frac{\text{kills in last 60 s}}{\text{expected kills per minute}},\ 0.8,\ 1.5\right)
```

**Unit costs:** Mite 1, Skitter 1, Splitter 3, Spitter 3, Carapace 6. An elite costs 10× its unit. One elite is forced every 90 s from 2:00.

| Window | Mite | Skitter | Carapace | Spitter | Splitter |
| --- | --- | --- | --- | --- | --- |
| 0:00–1:30 | 100 | 0 | 0 | 0 | 0 |
| 1:30–3:00 | 70 | 30 | 0 | 0 | 0 |
| 3:00–4:30 | 60 | 25 | 15 | 0 | 0 |
| 4:30–6:00 | 50 | 20 | 15 | 15 | 0 |
| 6:00–10:30 | 40 | 20 | 15 | 10 | 15 |
| 10:30–15:00 | 35 | 20 | 15 | 15 | 15 |

**Surge timing:** Breath starts 10 s before each Surge; the formation spawns at the camera edge and closes in at its units' own speed.

### Drops, stat boosts and frames

| Drop | Rule |
| --- | --- |
| XP cores | Each kill drops its XP value as cores: blue 1, green 5, gold 25; above 300 on the ground, new ones merge into the nearest core |
| Repair Kit | 0.1% per kill, at most one every 60 s |
| Magnet Pulse | 0.05% per kill, at most one every 45 s |
| Overflow Cache | Every elite; 2 from the Brood Mother when no Link is possible |

| Stat | Base | Per card | Cap |
| --- | --- | --- | --- |
| Hull | 100 | +10 max, heals 10 | None |
| Speed | 5 u/s | +0.5 u/s | 8 u/s |
| Power | 100% | +10% | None |
| Rate | 100% | +10% | +100% |
| Area | 100% | +10% | +100% |
| Magnet | 2 u | +0.5 u | 8 u |

| Frame | Hull | Speed (u/s) | Hardpoints | Rule in numbers |
| --- | --- | --- | --- | --- |
| VANGUARD | 100 | 5.0 | 4 | None |
| SPARK | 90 | 5.3 | 4 | Link at L3; weapons cap at L4; trigger forms use L4 stats |
| COLOSSUS | 140 | 3.5 | 3 | Each successful trigger spawns 2 effects 0.1 s apart and counts twice against the trigger limit |

**Mech and camera:** mech collision radius 0.75 u; invulnerability 0.5 s after a hit; knockback 1 u. Base view is about 30 × 17 u, widening 8% per filled hardpoint and per Link, capped at +50%.
