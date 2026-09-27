// Every tuning number lives here. Logic reads from this object only, so a balance
// change never touches logic. Seeded from the Numbers appendix of docs/game-design.md;
// from now on this file (not the appendix) is the source of truth. Any change to a
// value must be logged in DECISIONS.md (old value, new value, why).
//
// Units: seconds, world units (u), fractions (0.3 = 30%).

/** Weapons implemented so far (milestone 2: the 6 starting weapons). */
export type WeaponId = 'pulse' | 'arc' | 'tesla' | 'seeker' | 'blades' | 'mortar';
/** Every launch weapon, for the Codex and unlocks. */
export type AnyWeaponId = WeaponId | 'cryo' | 'ion' | 'rail' | 'singularity';
export type UnitEnemy = 'mite' | 'skitter' | 'carapace' | 'splitter';
export type EnemyKind = UnitEnemy | 'brood' | 'overmind';
export type UnitKind = 'mite' | 'skitter' | 'carapace' | 'spitter' | 'splitter';
export type StatId = 'hull' | 'speed' | 'power' | 'rate' | 'area' | 'magnet';
export type Formation = 'ring' | 'wall' | 'tide' | 'ringCarapace' | 'twoWalls' | 'mixed7' | 'doubleRing' | 'mixed9' | 'brood';

export const TUNING = {
  sim: {
    tickRate: 60, // fixed simulation steps per second
    maxEnemies: 1500, // hard cap on live enemies (Surges included)
    hitFlashTicks: 1, // an enemy flashes white for one frame when hit
    linkHitStop: 0.06, // s of hit-stop when a Link forms
    eliteHitStop: 0.05, // s of hit-stop when an elite dies
    bossDeathSlow: 1.5, // s of real time at bossDeathScale after a boss dies
    bossDeathScale: 0.35,
  },

  /** Starting weapons (unlocked by default), in Codex order. */
  startingWeapons: ['pulse', 'arc', 'tesla', 'seeker', 'blades', 'mortar'] as WeaponId[],
  codexOrder: ['pulse', 'arc', 'tesla', 'seeker', 'blades', 'mortar', 'cryo', 'ion', 'rail', 'singularity'] as AnyWeaponId[],

  weaponInfo: {
    pulse: { name: 'Pulse Rifle', colour: 0x22e6ff }, // cyan
    arc: { name: 'Arc Coil', colour: 0x3d6dff }, // cobalt blue
    tesla: { name: 'Tesla Chain', colour: 0x6a4dff }, // indigo
    seeker: { name: 'Seeker Swarm', colour: 0xa6ff2e }, // lime
    blades: { name: 'Blade Drones', colour: 0xc9d3e6 }, // silver
    mortar: { name: 'Plasma Mortar', colour: 0xffa81a }, // amber
    cryo: { name: 'Cryo Emitter', colour: 0xeaf8ff }, // ice white
    ion: { name: 'Ion Mines', colour: 0xfff03a }, // yellow
    rail: { name: 'Railgun', colour: 0x16d98a }, // emerald
    singularity: { name: 'Singularity Core', colour: 0x8f3dff }, // deep violet
  } as Record<AnyWeaponId, { name: string; colour: number }>,

  arena: {
    halfSize: 100, // ~200 x 200 bounded arena
  },

  camera: {
    // Screen-space extents of the base view, in world units (about 30 x 17 u).
    viewWidth: 30,
    viewHeight: 17,
    pitchDeg: 35,
    yawDeg: 45,
    followRate: 6, // 1/s, exponential soft follow
    lookAhead: 0.35, // s of mech velocity added to the follow target
  },

  mech: {
    radius: 0.75,
    accelTime: 0.1, // s to reach top speed (and to stop): no drift
    invulnTime: 0.5,
    knockback: 1, // u every touching enemy is pushed back after a hit
  },

  frames: {
    vanguard: { name: 'VANGUARD', hull: 100, speed: 5, hardpoints: 4, startWeapon: 'pulse' as WeaponId, weaponCap: 5, linkLevel: 5 },
  },

  // Hull and Speed bases come from the frame; the rest from here.
  stats: {
    hull: { base: 100, step: 10, cap: Infinity },
    speed: { base: 5, step: 0.5, cap: 8 },
    power: { base: 1, step: 0.1, cap: Infinity },
    rate: { base: 1, step: 0.1, cap: 2 },
    area: { base: 1, step: 0.1, cap: 2 },
    magnet: { base: 2, step: 0.5, cap: 8 },
  } as Record<StatId, { base: number; step: number; cap: number }>,

  xp: {
    // XP needed to go from level L to L + 1 = base + perLevel * L
    base: 10,
    perLevel: 16, // 12 -> 16, see DECISIONS.md
    coreValues: [25, 5, 1], // gold, green, blue
    maxCoresOnGround: 300, // above this, new cores merge into the nearest core
    magnetSpeed: 14, // u/s for cores inside the magnet radius
    overflowSpeed: 30, // u/s for cores pulled by Overflow or a Magnet Pulse
    pickupRadius: 0.9,
  },

  pickups: {
    repairChance: 0.001, // per kill
    repairCooldown: 60, // s, at most one per
    repairHeal: 30,
    magnetChance: 0.0005,
    magnetCooldown: 45,
    radius: 0.9,
  },

  draft: {
    cards: 3,
    rerollsPerRun: 3,
    weights: { weaponLevel: 40, newWeapon: 25, statBoost: 20, chainLevel: 15 },
  },

  links: {
    maxParts: 3,
    apexMinChainLevel: 3,
    maxChainLevel: 5,
    triggerMultBase: 0.6, // at Chain Level 1
    triggerMultPerLevel: 0.1, // per Chain Level above 1 (1.0 at CL5)
    chancePerLevel: 0.15, // trigger chance x (1 + 0.15 per CL above 1)
    enemyGate: 0.25, // s: one enemy sources at most one trigger per part per 0.25 s
    areaRolls: 3, // an area pulse rolls for up to 3 random enemies it hit
    continuousRollEvery: 0.5, // s of contact per roll for continuous weapons
    limiterRate: 150, // triggers per second per Link part
    limiterBurst: 60,
    bankPower: 0.1, // per skipped trigger
    bankSize: 0.05,
    bankPowerCap: 2.0,
    bankSizeCap: 0.5,
    maxTriggeredEffects: 1500,
    triggeredVisualScale: 0.7,
  },

  weapons: {
    pulse: {
      damage: 8,
      speed: 20,
      range: 14, // u a bolt flies before fading
      acquireRange: 13, // u to the furthest target the rifle aims at
      boltRadius: 0.2,
      levels: [
        null,
        { bolts: 1, damageMult: 1, pierce: 0, cooldown: 0.5 },
        { bolts: 2, damageMult: 1, pierce: 0, cooldown: 0.5 },
        { bolts: 2, damageMult: 1.3, pierce: 0, cooldown: 0.5 },
        { bolts: 2, damageMult: 1.3, pierce: 2, cooldown: 0.5 },
        { bolts: 3, damageMult: 1.3, pierce: 2, cooldown: 0.4 },
      ],
      levelText: ['', '1 bolt, 8 dmg', '+1 bolt', '+30% damage', 'Pierce 2', '+1 bolt, cooldown 0.4'],
      trigger: { chance: 0.3, bolts: 3, range: 12, spreadDeg: 40 },
      triggerText: 'a 3-bolt Pulse burst',
    },
    arc: {
      damage: 12,
      levels: [
        null,
        { radius: 3, damageMult: 1, cooldown: 2.0, field: false },
        { radius: 3.75, damageMult: 1, cooldown: 2.0, field: false },
        { radius: 3.75, damageMult: 1.4, cooldown: 2.0, field: false },
        { radius: 3.75, damageMult: 1.4, cooldown: 1.4, field: false },
        { radius: 3.75, damageMult: 1.4, cooldown: 1.4, field: true },
      ],
      field: { damage: 4, tick: 0.5, duration: 2 }, // L5 static field
      ringLife: 0.25, // s the ring is visible
      levelText: ['', 'Ring, 3 u, 12 dmg', 'Radius 3.75 u', '+40% damage', 'Cooldown 1.4', 'Leaves a static field'],
      trigger: { chance: 0.25, radiusScale: 0.5 },
      triggerText: 'a half-size Arc ring',
    },
    tesla: {
      damage: 14,
      cooldown: 1.5,
      jumpRange: 4,
      acquireRange: 9, // u from the mech to the first target
      levels: [
        null,
        { jumps: 3, damageMult: 1, chains: 1, fork: false },
        { jumps: 5, damageMult: 1, chains: 1, fork: false },
        { jumps: 5, damageMult: 1.3, chains: 1, fork: false },
        { jumps: 5, damageMult: 1.3, chains: 2, fork: false },
        { jumps: 8, damageMult: 1.3, chains: 2, fork: true },
      ],
      forkAtJump: 4,
      arcLife: 0.18, // s an arc stays visible
      levelText: ['', '3 jumps, 14 dmg', '+2 jumps', '+30% damage', '2 chains', '+3 jumps, forks at jump 4'],
      trigger: { chance: 0.25, jumps: 3 },
      triggerText: 'a 3-jump Tesla chain',
    },
    seeker: {
      damage: 10,
      cooldown: 2.0,
      speed: 11,
      turnRate: 6, // rad/s
      life: 2.5, // s before a missile detonates on its own
      acquireRange: 14,
      hitRadius: 0.35,
      levels: [
        null,
        { missiles: 3, damageMult: 1, blast: 1 },
        { missiles: 5, damageMult: 1, blast: 1 },
        { missiles: 5, damageMult: 1.3, blast: 1 },
        { missiles: 5, damageMult: 1.3, blast: 1.8 },
        { missiles: 8, damageMult: 1.3, blast: 1.8 },
      ],
      levelText: ['', '3 missiles, 1 u blast', '+2 missiles', '+30% damage', 'Blast 1.8 u', '+3 missiles'],
      trigger: { chance: 0.25, missiles: 2 },
      triggerText: '2 seeker missiles',
    },
    blades: {
      damage: 9,
      hitCooldown: 0.5, // per enemy
      radius: 0.45, // blade hit radius
      spin: 3.2, // rad/s at L1
      levels: [
        null,
        { blades: 2, damageMult: 1, orbit: 2.5, spinMult: 1 },
        { blades: 3, damageMult: 1, orbit: 2.5, spinMult: 1 },
        { blades: 3, damageMult: 1.3, orbit: 2.5, spinMult: 1 },
        { blades: 3, damageMult: 1.3, orbit: 3.5, spinMult: 1.4 },
        { blades: 5, damageMult: 1.3, orbit: 3.5, spinMult: 1.4 },
      ],
      levelText: ['', '2 blades, 9 dmg', '+1 blade', '+30% damage', 'Orbit 3.5 u, +40% spin', '+2 blades'],
      trigger: { chance: 0.2, orbit: 1.5, duration: 2 },
      triggerText: 'a blade orbiting the hit for 2 s',
    },
    mortar: {
      shellDamage: 20,
      poolDamage: 5,
      poolTick: 0.5,
      poolRadiusScale: 0.75, // pool radius = blast x this
      flight: 0.7, // s a shell is in the air
      acquireRange: 13,
      levels: [
        null,
        { shells: 1, damageMult: 1, blast: 2, pool: 2, cooldown: 2.5 },
        { shells: 2, damageMult: 1, blast: 2, pool: 2, cooldown: 2.5 },
        { shells: 2, damageMult: 1, blast: 2, pool: 4, cooldown: 2.5 },
        { shells: 2, damageMult: 1.4, blast: 2, pool: 4, cooldown: 2.5 },
        { shells: 4, damageMult: 1.4, blast: 3, pool: 4, cooldown: 2.5 },
      ],
      levelText: ['', 'Shell 20 dmg, 2 s pool', '+1 shell', 'Pool lasts 4 s', '+40% damage', '+2 shells, blast 3 u'],
      trigger: { chance: 0.2, radius: 1.5, duration: 2 },
      triggerText: 'a plasma pool',
    },
  },

  enemies: {
    mite: { hp: 10, speed: 2.6, damage: 5, xp: 2, radius: 0.4, cost: 1 }, // xp 1 -> 2, see DECISIONS.md
    skitter: { hp: 6, speed: 4.5, damage: 4, xp: 1, radius: 0.35, cost: 1, zigEvery: 0.6, zigAngleDeg: 40 },
    carapace: { hp: 80, speed: 1.6, damage: 12, xp: 5, radius: 0.9, cost: 6, frontArcDeg: 90, frontMult: 0.5 },
    splitter: { hp: 30, speed: 2.2, damage: 6, xp: 2, radius: 0.6, cost: 3, splits: 4 },
    // Spitter arrives in milestone 3; its director weight falls back to the other units.
  },

  elite: {
    size: 3,
    hp: 10,
    speed: 1,
    damage: 2,
    xp: 25,
    costMult: 10,
    hastedSpeed: 1.6,
    shield: 0.5, // Shielded: absorbs 50% of scaled HP first
    every: 90, // s: one elite is forced every 90 s ...
    from: 120, // ... from 2:00
  },

  bosses: {
    brood: {
      hp: 5000,
      speed: 2,
      radius: 2.2,
      contactDamage: 15,
      chargeEvery: 7, // s between charges
      chargeTelegraph: 1,
      chargeDistance: 12,
      chargeSpeed: 24,
      chargeDamage: 25,
      burstEvery: 10,
      burstMites: 30,
      burstRadius: 3.5,
      spitEvery: 5,
      spitGlobs: 3,
      spitSpreadDeg: 30,
      globSpeed: 6,
      globRange: 11,
      globDamage: 8,
      puddleLife: 3,
      puddleRadius: 1.3,
      puddleDamage: 6,
      enrageHp: 0.5, // below 50% she charges twice in a row
    },
    overmind: {
      hp: 36000, // 60000 -> 36000, see DECISIONS.md
      radius: 3.5,
      contactDamage: 20,
      spawnBudget: 0.5, // normal spawns continue at 50% budget
      beamLength: 45,
      beamWidth: 0.9,
      beamDamage: 20,
      beamSpeedDeg: 30, // deg/s
      phase2: 0.66,
      phase3: 0.33,
      summonEvery: 15,
      summonElites: 2,
      orbEvery: 2.5,
      orbSpeed: 3,
      orbTurn: 1.2, // rad/s
      orbDamage: 10,
      orbLife: 9,
      collapseSpeed: 0.5, // u/s the arena edge closes in phase 3
      collapseMin: 12,
      enrageAt: 1200, // s (20:00): beam speed doubles
    },
  },

  scaling: {
    // HP(t) = base * (1 + a t + b t^2), Damage(t) = base * (1 + c t), t in minutes
    hpLinear: 0.15,
    hpQuad: 0.02,
    damageLinear: 0.05,
  },

  crowd: {
    separation: 0.5, // each of two overlapping enemies moves 25% of the overlap per tick
    cellSize: 1.8, // >= twice the largest grid enemy radius, so 3 x 3 cells cover every overlap
  },

  director: {
    // Threat per second(t) = a + b t
    threatBase: 2,
    threatPerMin: 0.6,
    // On-screen target(t) = min(a + b t, cap)
    onScreenBase: 50,
    onScreenPerMin: 40,
    onScreenCap: 650,
    // Expected kills per minute(t) = a + b t
    expectedKpmBase: 60,
    expectedKpmPerMin: 40,
    maxBankedSeconds: 5, // unspent threat carried over, in seconds of income
    spawnMarginMin: 2, // u beyond the camera edge
    spawnMarginMax: 4,
    despawnScreens: 1.5,
    // Unit mix by window (start time in s); weights per unit kind.
    mix: [
      { from: 0, weights: { mite: 100, skitter: 0, carapace: 0, spitter: 0, splitter: 0 } },
      { from: 90, weights: { mite: 70, skitter: 30, carapace: 0, spitter: 0, splitter: 0 } },
      { from: 180, weights: { mite: 60, skitter: 25, carapace: 15, spitter: 0, splitter: 0 } },
      { from: 270, weights: { mite: 50, skitter: 20, carapace: 15, spitter: 15, splitter: 0 } },
      { from: 360, weights: { mite: 40, skitter: 20, carapace: 15, spitter: 10, splitter: 15 } },
      { from: 630, weights: { mite: 35, skitter: 20, carapace: 15, spitter: 15, splitter: 15 } },
    ] as { from: number; weights: Record<UnitKind, number> }[],
  },

  surge: {
    breath: 10, // s of paused spawns before each Surge
    sizeBase: 150, // Surge size(n) = (base + perSurge n) * clamp(ratio, min, max)
    sizePerSurge: 30,
    ratioMin: 0.8,
    ratioMax: 1.5,
    breakFraction: 0.7, // broken when 70% of its units are dead
    slowSurgeTime: 25, // s: a Surge slower than this makes the next one smaller ...
    slowSurgeMult: 0.85, // ... by this factor
    ringRadius: 20, // u from the mech: just beyond the corners of the view
    ringSpacing: 0.85, // u between neighbours in a ring row
    wallDistance: 19, // u from the mech to a wall's start line
    wallLength: 46,
    wallSpacing: 0.9,
    wallMarch: 30, // u a wall sweeps before its units start hunting the mech
    tideDistance: 20,
    schedule: [
      { time: 90, formation: 'ring' as Formation },
      { time: 180, formation: 'wall' as Formation },
      { time: 270, formation: 'tide' as Formation },
      { time: 360, formation: 'ringCarapace' as Formation },
      { time: 450, formation: 'brood' as Formation }, // Brood Mother replaces Surge 5
      { time: 540, formation: 'twoWalls' as Formation },
      { time: 630, formation: 'mixed7' as Formation },
      { time: 720, formation: 'doubleRing' as Formation },
      { time: 810, formation: 'mixed9' as Formation },
    ],
    overmindAt: 900,
  },

  overflow: {
    heal: 15,
    slowTime: 1.5, // s of real time at the slowed rate
    slowScale: 0.5,
  },

  death: {
    slowScale: 0.3,
    slowTime: 0.6, // s of game time the final cascade plays before the summary (2 s real)
  },
} as const;

export type Tuning = typeof TUNING;
