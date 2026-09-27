// Every tuning number lives here. Logic reads from this object only, so a balance
// change never touches logic. Seeded from the Numbers appendix of docs/game-design.md;
// from now on this file (not the appendix) is the source of truth. Any change to a
// value must be logged in DECISIONS.md (old value, new value, why).
//
// Units: seconds, world units (u), fractions (0.3 = 30%).

export type WeaponId = 'pulse' | 'tesla';
export type EnemyKind = 'mite';
export type StatId = 'hull' | 'speed' | 'power' | 'rate' | 'area' | 'magnet';

export const TUNING = {
  sim: {
    tickRate: 60, // fixed simulation steps per second
    maxEnemies: 1500, // hard cap on live enemies (Surges included)
    hitFlashTicks: 1, // an enemy flashes white for one frame when hit
    linkHitStop: 0.06, // s of hit-stop when a Link forms
  },

  // Weapons the current milestone implements, in unlock order.
  weaponPool: ['pulse', 'tesla'] as WeaponId[],

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
    shoulderPush: 0.6, // fraction of overlap resolved by moving Mites out of the mech per tick
  },

  frames: {
    vanguard: { name: 'VANGUARD', hull: 100, speed: 5, hardpoints: 4, startWeapon: 'pulse' as WeaponId },
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
    perLevel: 12,
    coreValues: [25, 5, 1], // gold, green, blue
    maxCoresOnGround: 300, // above this, new cores merge into the nearest core
    coreRadius: 0.25,
    magnetSpeed: 14, // u/s for cores inside the magnet radius
    overflowSpeed: 30, // u/s for cores pulled by Overflow
    pickupRadius: 0.9,
  },

  draft: {
    cards: 3,
    rerollsPerRun: 3,
    weights: { weaponLevel: 40, newWeapon: 25, statBoost: 20, chainLevel: 15 },
  },

  links: {
    maxParts: 3,
    linkLevel: 5, // weapon level needed to be Linked
    apexMinChainLevel: 3,
    maxChainLevel: 5,
    triggerMultBase: 0.6, // at Chain Level 1
    triggerMultPerLevel: 0.1, // per Chain Level above 1 (1.0 at CL5)
    chancePerLevel: 0.15, // trigger chance x (1 + 0.15 per CL above 1)
    enemyGate: 0.25, // s: one enemy sources at most one trigger per part per 0.25 s
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
      name: 'Pulse Rifle',
      colour: 0x22e6ff, // cyan
      damage: 8,
      cooldown: 0.5,
      bolts: 1,
      speed: 20,
      pierce: 0,
      range: 14, // u a bolt flies before fading
      acquireRange: 13, // u to the furthest target the rifle aims at
      boltRadius: 0.2,
      // per level (index = level): cumulative values
      levels: [
        null,
        { bolts: 1, damageMult: 1, pierce: 0, cooldown: 0.5 },
        { bolts: 2, damageMult: 1, pierce: 0, cooldown: 0.5 },
        { bolts: 2, damageMult: 1.3, pierce: 0, cooldown: 0.5 },
        { bolts: 2, damageMult: 1.3, pierce: 2, cooldown: 0.5 },
        { bolts: 3, damageMult: 1.3, pierce: 2, cooldown: 0.4 },
      ],
      levelText: ['', 'Pulse Rifle: 1 bolt', '+1 bolt', '+30% damage', 'Pierce 2', '+1 bolt, cooldown 0.4'],
      trigger: {
        chance: 0.3,
        bolts: 3,
        range: 12,
        spreadDeg: 40, // total fan of the 3-bolt burst around the mech-to-hit line
      },
    },
    tesla: {
      name: 'Tesla Chain',
      colour: 0x6a4dff, // indigo
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
      levelText: ['', 'Tesla Chain: 3 jumps', '+2 jumps', '+30% damage', '2 chains', '+3 jumps, forks at jump 4'],
      arcLife: 0.18, // s an arc stays visible
      trigger: {
        chance: 0.25,
        jumps: 3,
      },
    },
  },

  enemies: {
    mite: { hp: 10, speed: 2.6, damage: 5, xp: 1, radius: 0.4, cost: 1 },
  } as Record<EnemyKind, { hp: number; speed: number; damage: number; xp: number; radius: number; cost: number }>,

  scaling: {
    // HP(t) = base * (1 + a t + b t^2), Damage(t) = base * (1 + c t), t in minutes
    hpLinear: 0.15,
    hpQuad: 0.02,
    damageLinear: 0.05,
  },

  crowd: {
    separation: 0.5, // fraction of pairwise overlap resolved per tick
    cellSize: 1.2,
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
    ],
  },

  surge: {
    breath: 10, // s of paused spawns before each Surge
    sizeBase: 150, // Surge size(n) = (base + perSurge n) * clamp(ratio, min, max)
    sizePerSurge: 30,
    ratioMin: 0.8,
    ratioMax: 1.5,
    breakFraction: 0.7, // broken when 70% of its units are dead
    slowSurgeTime: 25, // s: a Surge slower than this makes the next one smaller
    ringRadius: 16, // u from the mech: at the camera edge
    ringSpacing: 0.85, // u between neighbours in a ring row
    // Milestone 1 ships Surge 1 only; the rest of the schedule arrives in milestone 2.
    schedule: [{ time: 90, formation: 'ring' as const, units: 'mite' as const }],
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
