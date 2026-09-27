// The game simulation: deterministic, fixed-step, no DOM or rendering.
// Same seed + same options + same input log => same run (tests/determinism.test.ts).
// Weapons, the director and the bosses live in their own modules and operate on
// the World's public state.
import { len2 } from './math';
import { TUNING, type EnemyKind, type StatId, type UnitEnemy, type WeaponId } from '../tuning';
import {
  addWeapon,
  allWeapons,
  applyLink,
  findWeapon,
  linkOptions,
  makeBuild,
  refillLimiters,
  takeTrigger,
  type Build,
  type Chain,
  type LinkOption,
} from './build';
import { makeDraft, type Card, type DraftContext } from './draft';
import { damageMult, hpMult, triggerChance, triggerMult, xpNext } from './formulas';
import { Grid } from './grid';
import { Rng } from './rng';
import { FORESHORTEN, RIGHT, UP, inputToGround } from './view';
import type {
  Arc,
  Bolt,
  Core,
  Enemy,
  Hazard,
  Missile,
  OrbitBlade,
  Pickup,
  PickupKind,
  Ring,
  Shell,
  Src,
  Zone,
} from './types';
import { endOldestContinuous, fireHeads, fireTrigger, updateEffects } from './weapons';
import { devBoss, devElite, devSurge, direct, onSurgeUnitKilled, spawnPoint } from './director';
import { onBossKilled, updateBosses } from './bosses';

export type { Enemy } from './types';
export type { Card };

const T = TUNING;
export const DT = 1 / T.sim.tickRate;
const MAX_PART_SLOTS = 4 * T.links.maxParts;
/** Enemies up to this radius go in the grid; bigger ones (elites, bosses) are checked directly. */
export const SMALL_R = 0.9;

export type WorldEvent =
  | { type: 'levelup' }
  | { type: 'hurt' }
  | { type: 'link'; chain: WeaponId[] }
  | { type: 'codex'; pair: string }
  | { type: 'breath'; boss: boolean }
  | { type: 'surge'; n: number; size: number }
  | { type: 'overflow'; n: number; breakTime: number }
  | { type: 'elite' }
  | { type: 'eliteDown' }
  | { type: 'boss'; kind: 'brood' | 'overmind' }
  | { type: 'bossDown'; kind: 'brood' | 'overmind' }
  | { type: 'pickup'; kind: PickupKind }
  | { type: 'feat'; feat: Feat }
  | { type: 'death' }
  | { type: 'win' };

/** Unlock feats a run can achieve (see docs/game-design.md, Meta progression). */
export type Feat = 'broodBeaten' | 'firstLink' | 'fastSurge' | 'threeLinks' | 'apex' | 'win';

export type LogEvent =
  | { tick: number; type: 'choose'; index: number; order: number }
  | { tick: number; type: 'reroll' }
  | { tick: number; type: 'dev'; cmd: DevCommand };

export type DevCommand =
  | { cmd: 'grant'; weapon: WeaponId; level: number }
  | { cmd: 'level'; weapon: WeaponId; level: number }
  | { cmd: 'link'; chain: WeaponId[]; chainLevel: number }
  | { cmd: 'chainLevel'; slot: number; level: number }
  | { cmd: 'stat'; stat: StatId; value: number }
  | { cmd: 'surge'; n?: number }
  | { cmd: 'boss'; kind: 'brood' | 'overmind' }
  | { cmd: 'elite' }
  | { cmd: 'spawn'; count: number; kind?: EnemyKind }
  | { cmd: 'god'; on: boolean }
  | { cmd: 'stress'; on: boolean }
  | { cmd: 'bench'; count: number; minutes: number }
  | { cmd: 'time'; seconds: number }
  | { cmd: 'xp'; amount: number }
  | { cmd: 'director'; on: boolean };

export type SurgePhase = 'build' | 'breath' | 'surge' | 'boss';

export interface WorldOptions {
  seed: number;
  /** Weapons that can appear in drafts (unlocked and implemented). Defaults to the starting 6. */
  weapons?: readonly WeaponId[];
}

export class World {
  readonly seed: number;
  readonly rng: Rng;
  readonly weaponPool: readonly WeaponId[];

  tick = 0;
  time = 0; // game seconds (slows during slow-mo)

  // Mech
  x = 0;
  z = 0;
  px = 0;
  pz = 0;
  vx = 0;
  vz = 0;
  hull: number;
  invuln = 0;
  dead = false;
  won = false;
  runOver = false;
  endTimer = 0;

  // Camera (simulated so spawning is deterministic)
  camX = 0;
  camZ = 0;
  pcamX = 0;
  pcamZ = 0;

  build: Build;
  weaponCap: number;
  linkLevel: number;

  // Progress
  level = 1;
  xp = 0;
  kills = 0;
  pendingLevels = 0;
  draft: Card[] | null = null;
  draftHasLink = false;
  lastDraftHadLink = false;
  forceLinkDraft = false;
  rerolls: number = T.draft.rerollsPerRun;
  linksMade = 0;
  cacheLevels = 0; // levels that came from Overflow Caches rather than XP
  damageTaken: Record<string, number> = {};
  xpEarned = 0;
  codex = new Set<string>(); // ordered pairs that triggered this run
  pairKills = new Map<string, number>(); // kills by effects each ordered pair triggered
  chainDamage = new Map<string, number>(); // damage per chain (weapon ids joined by '>')
  chainKills = new Map<string, number>();
  apexes = new Set<string>();
  feats = new Set<Feat>();

  // Entities
  enemies: Enemy[] = [];
  big: Enemy[] = []; // enemies too big for the grid, rebuilt every tick
  bosses: Enemy[] = [];
  bolts: Bolt[] = [];
  missiles: Missile[] = [];
  shells: Shell[] = [];
  zones: Zone[] = [];
  orbitBlades: OrbitBlade[] = [];
  soloBlades: { x: number; z: number; weapon: WeaponId }[] = [];
  soloBladeHits = new Map<number, number>();
  bladeAngle = 0;
  arcs: Arc[] = [];
  rings: Ring[] = [];
  cores: Core[] = [];
  pickups: Pickup[] = [];
  hazards: Hazard[] = [];
  triggeredInstant: number[] = []; // expiry times of live triggered instant effects (Tesla chains, Arc rings)
  enemyPool: Enemy[] = [];
  nextEnemyId = 1;
  grid: Grid;
  pushX = new Float32Array(2048);
  pushZ = new Float32Array(2048);

  // Arena: a square, which becomes a closing circle in the Overmind's last phase
  arenaRadius = Infinity;

  // Director
  budget = 0;
  killTimes: number[] = [];
  killHead = 0;
  surgePhase: SurgePhase = 'build';
  surgeIndex = 0; // next scheduled entry
  surgeCount = 0; // Surges spawned so far (schedule slots, the Brood Mother included)
  surgeId = 0;
  surgeSize = 0;
  surgeKilled = 0;
  surgeStart = 0;
  surgeSizeMult = 1;
  lastBreakTime = 0;
  breakTimes: number[] = [];
  nextElite: number = T.elite.from;
  lastRepair = -Infinity;
  lastMagnet = -Infinity;
  overmindSpawned = false;
  overmindBreath = false;

  // Time control, in real ticks
  hitStopTicks = 0;
  overflowTicks = 0;
  bossSlowTicks = 0;

  // Dev
  god = false;
  stress = false;
  benchCount = 0;
  directorOn = true;
  benchHpMult = 1;

  // Logs
  inputs: number[] = [];
  log: LogEvent[] = [];
  events: WorldEvent[] = [];

  constructor(opts: WorldOptions) {
    this.seed = opts.seed >>> 0;
    this.rng = new Rng(this.seed);
    this.weaponPool = opts.weapons ?? T.startingWeapons;
    const f = T.frames.vanguard;
    this.build = makeBuild(f.hardpoints, f.hull, f.speed);
    this.weaponCap = f.weaponCap;
    this.linkLevel = f.linkLevel;
    this.hull = f.hull;
    addWeapon(this.build, f.startWeapon);
    this.grid = new Grid(T.arena.halfSize, T.crowd.cellSize, 2048);
  }

  // ---------------------------------------------------------------- queries

  get tMin(): number {
    return this.time / 60;
  }

  get xpToNext(): number {
    return xpNext(this.level);
  }

  get timeScale(): number {
    if (this.hitStopTicks > 0) return 0;
    if (this.dead || this.won) return T.death.slowScale;
    if (this.bossSlowTicks > 0) return T.sim.bossDeathScale;
    if (this.overflowTicks > 0) return T.overflow.slowScale;
    return 1;
  }

  /** Seconds until the next scheduled Surge or boss, and what it is. */
  get nextThreat(): { in: number; boss: string | null } | null {
    const s = T.surge.schedule[this.surgeIndex];
    if (s) return { in: Math.max(0, s.time - this.time), boss: s.formation === 'brood' ? 'BROOD MOTHER' : null };
    if (!this.overmindSpawned) return { in: Math.max(0, T.surge.overmindAt - this.time), boss: 'OVERMIND' };
    return null;
  }

  get triggeredEffects(): number {
    let n = this.triggeredInstant.length;
    for (const b of this.bolts) if (b.src.triggered) n++;
    for (const m of this.missiles) if (m.src.triggered) n++;
    for (const s of this.shells) if (s.src.triggered) n++;
    for (const z of this.zones) if (z.src.triggered) n++;
    n += this.orbitBlades.length;
    return n;
  }

  draftContext(): DraftContext {
    return { build: this.build, unlocked: this.weaponPool, weaponCap: this.weaponCap, linkLevel: this.linkLevel };
  }

  /** Calls fn for every live enemy that might be within r of (x, z); callers test exact distance. */
  near(x: number, z: number, r: number, fn: (e: Enemy) => void): void {
    const es = this.enemies;
    this.grid.query(x, z, r + SMALL_R, (i) => {
      const e = es[i];
      if (e.alive) fn(e);
    });
    for (const e of this.big) if (e.alive) fn(e);
  }

  /** Up to k nearest live enemies whose edge is within range of (x, z), nearest first. */
  nearest(x: number, z: number, range: number, k: number, exclude?: Set<number> | number): Enemy[] {
    const found: { e: Enemy; d: number }[] = [];
    this.near(x, z, range, (e) => {
      if (exclude !== undefined && (typeof exclude === 'number' ? e.id === exclude : exclude.has(e.id))) return;
      const d = Math.max(0, len2(e.x - x, e.z - z) - (e.r > SMALL_R ? e.r : 0));
      if (d > range) return;
      found.push({ e, d });
    });
    found.sort((a, b) => a.d - b.d || a.e.id - b.e.id);
    const out: Enemy[] = [];
    for (let i = 0; i < found.length && i < k; i++) out.push(found[i].e);
    return out;
  }

  nearestOne(x: number, z: number, range: number, exclude?: Set<number> | number): Enemy | null {
    let best: Enemy | null = null;
    let bestId = 0;
    let bd = range;
    this.near(x, z, range, (e) => {
      if (exclude !== undefined && (typeof exclude === 'number' ? e.id === exclude : exclude.has(e.id))) return;
      const d = Math.max(0, len2(e.x - x, e.z - z) - (e.r > SMALL_R ? e.r : 0));
      if (d < bd || (d === bd && best !== null && e.id < bestId)) {
        bd = d;
        best = e;
        bestId = e.id;
      }
    });
    return best;
  }

  /** All live enemies overlapping a disc, in id order. */
  inDisc(x: number, z: number, r: number): Enemy[] {
    const out: Enemy[] = [];
    this.near(x, z, r, (e) => {
      const rr = r + e.r;
      const dx = e.x - x;
      const dz = e.z - z;
      if (dx * dx + dz * dz <= rr * rr) out.push(e);
    });
    out.sort((a, b) => a.id - b.id);
    return out;
  }

  // ---------------------------------------------------------------- input

  /** Advance one fixed tick. mx, my in {-1, 0, 1}; my = +1 is up-screen. */
  step(mx: number, my: number): void {
    if (this.draft || this.runOver) return;
    this.inputs.push((mx + 1) * 3 + (my + 1));

    const dt = DT * this.timeScale;
    if (this.hitStopTicks > 0) this.hitStopTicks--;
    else {
      if (this.overflowTicks > 0) this.overflowTicks--;
      if (this.bossSlowTicks > 0) this.bossSlowTicks--;
    }

    this.px = this.x;
    this.pz = this.z;
    this.pcamX = this.camX;
    this.pcamZ = this.camZ;
    for (const e of this.enemies) {
      e.px = e.x;
      e.pz = e.z;
    }
    for (const b of this.bolts) {
      b.px = b.x;
      b.pz = b.z;
    }
    for (const m of this.missiles) {
      m.px = m.x;
      m.pz = m.z;
    }
    for (const c of this.cores) {
      c.px = c.x;
      c.pz = c.z;
    }
    for (const h of this.hazards) {
      h.px = h.x;
      h.pz = h.z;
    }

    if (dt > 0) {
      if (this.dead || this.won) {
        this.endTimer -= dt;
        if (this.endTimer <= 0) this.runOver = true;
      } else {
        this.moveMech(mx, my, dt);
      }
      this.moveCamera(dt);
      direct(this, dt);
      this.moveEnemies(dt);
      updateBosses(this, dt);
      this.contact();
      refillLimiters(this.build, dt);
      if (!this.dead && !this.won) fireHeads(this, dt);
      updateEffects(this, dt);
      this.compactEnemies();
      this.updateCores(dt);
      this.updatePickups(dt);
      this.time += dt;
    }
    this.tick++;
    this.maybeOpenDraft();
  }

  choose(index: number, order = 0): void {
    const d = this.draft;
    if (!d || index < 0 || index >= d.length) return;
    this.log.push({ tick: this.tick, type: 'choose', index, order });
    const card = d[index];
    this.draft = null;
    this.pendingLevels--;
    this.applyCard(card, order);
    this.maybeOpenDraft();
  }

  reroll(): void {
    if (!this.draft || this.rerolls <= 0) return;
    this.log.push({ tick: this.tick, type: 'reroll' });
    this.rerolls--;
    this.draft = makeDraft(this.draftContext(), this.rng, this.draftHasLink);
  }

  dev(cmd: DevCommand): void {
    this.log.push({ tick: this.tick, type: 'dev', cmd });
    this.applyDev(cmd);
  }

  // ---------------------------------------------------------------- arena

  /** Clamp a point of radius r inside the arena (square, or the closing circle). */
  clampToArena(p: { x: number; z: number }, r: number): void {
    const lim = T.arena.halfSize - r;
    p.x = clampAbs(p.x, lim);
    p.z = clampAbs(p.z, lim);
    if (this.arenaRadius < Infinity) {
      const d = len2(p.x, p.z);
      const max = Math.max(0.1, this.arenaRadius - r);
      if (d > max) {
        p.x *= max / d;
        p.z *= max / d;
      }
    }
  }

  // ---------------------------------------------------------------- mech

  private moveMech(mx: number, my: number, dt: number): void {
    const speed = this.build.stats.speed;
    let tx = 0;
    let tz = 0;
    if (mx || my) {
      const g = inputToGround(mx, my);
      const len = len2(g.x, g.z);
      tx = (g.x / len) * speed;
      tz = (g.z / len) * speed;
    }
    // Reach the target velocity within accelTime: no drift.
    const maxDv = (speed / T.mech.accelTime) * dt;
    const dvx = tx - this.vx;
    const dvz = tz - this.vz;
    const dv = len2(dvx, dvz);
    if (dv <= maxDv) {
      this.vx = tx;
      this.vz = tz;
    } else {
      this.vx += (dvx / dv) * maxDv;
      this.vz += (dvz / dv) * maxDv;
    }
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.clampToArena(this, T.mech.radius);
    if (this.invuln > 0) this.invuln -= dt;
  }

  private moveCamera(dt: number): void {
    const la = T.camera.lookAhead;
    const tx = this.x + this.vx * la;
    const tz = this.z + this.vz * la;
    const k = 1 - Math.exp(-T.camera.followRate * dt);
    this.camX += (tx - this.camX) * k;
    this.camZ += (tz - this.camZ) * k;
  }

  /** Damage the mech (contact, projectiles, hazards). Returns true if it landed. */
  hurt(amount: number, source = 'unknown'): boolean {
    if (this.invuln > 0 || this.god || this.dead || this.won) return false;
    this.hull -= amount;
    this.damageTaken[source] = (this.damageTaken[source] ?? 0) + amount;
    this.invuln = T.mech.invulnTime;
    this.events.push({ type: 'hurt' });
    // Every enemy touching the mech is pushed back 1 u.
    const mr = T.mech.radius;
    this.near(this.x, this.z, mr + 0.1, (e) => {
      if (e.mass === 0) return;
      let dx = e.x - this.x;
      let dz = e.z - this.z;
      let d = len2(dx, dz);
      if (d > mr + e.r + 0.05) return;
      if (d < 1e-5) {
        dx = UP.x;
        dz = UP.z;
        d = 1;
      }
      e.x += (dx / d) * T.mech.knockback;
      e.z += (dz / d) * T.mech.knockback;
      this.clampToArena(e, e.r);
    });
    if (this.hull <= 0) this.die();
    return true;
  }

  private die(): void {
    this.hull = 0;
    this.dead = true;
    this.endTimer = T.death.slowTime;
    this.vx = this.vz = 0;
    this.events.push({ type: 'death' });
  }

  winRun(): void {
    if (this.dead || this.won) return;
    this.won = true;
    this.endTimer = T.death.slowTime;
    this.addFeat('win');
    this.events.push({ type: 'win' });
  }

  addFeat(f: Feat): void {
    if (this.feats.has(f)) return;
    this.feats.add(f);
    this.events.push({ type: 'feat', feat: f });
  }

  // ---------------------------------------------------------------- enemies

  spawnEnemy(kind: EnemyKind, x: number, z: number, surge: number, elite: 0 | 1 | 2 = 0): Enemy | null {
    if (this.enemies.length >= T.sim.maxEnemies) return null;
    const e: Enemy = this.enemyPool.pop() ?? {
      id: 0,
      kind,
      x: 0,
      z: 0,
      px: 0,
      pz: 0,
      fx: 0,
      fz: 1,
      r: 0,
      hp: 0,
      maxHp: 0,
      shield: 0,
      speed: 0,
      damage: 0,
      xp: 0,
      alive: true,
      lastHit: -99,
      surge: 0,
      elite: 0,
      blocks: false,
      mass: 1,
      zigT: 0,
      zig: 1,
      marchX: 0,
      marchZ: 0,
      marchLeft: 0,
      gate: new Float64Array(MAX_PART_SLOTS),
      boss: null,
    };
    const tMin = this.tMin;
    e.id = this.nextEnemyId++;
    e.kind = kind;
    e.x = e.px = x;
    e.z = e.pz = z;
    e.fx = 0;
    e.fz = 1;
    e.alive = true;
    e.lastHit = -99;
    e.surge = surge;
    e.elite = elite;
    e.shield = 0;
    e.zigT = 0;
    e.zig = 1;
    e.marchLeft = 0;
    e.boss = null;
    e.gate.fill(-1);
    if (kind === 'brood' || kind === 'overmind') {
      // Bosses don't scale with time.
      const b = T.bosses[kind];
      e.r = b.radius;
      e.maxHp = e.hp = b.hp;
      e.speed = kind === 'brood' ? T.bosses.brood.speed : 0;
      e.damage = b.contactDamage;
      e.xp = 0;
      e.blocks = true;
      e.mass = 0;
      e.boss = {
        chargeT: T.bosses.brood.chargeEvery,
        chargesLeft: 0,
        telegraph: 0,
        dashLeft: 0,
        dirX: 0,
        dirZ: 1,
        burstT: T.bosses.brood.burstEvery,
        spitT: T.bosses.brood.spitEvery / 2,
        phase: 1,
        beamAngle: 0,
        summonT: T.bosses.overmind.summonEvery,
        orbT: T.bosses.overmind.orbEvery,
      };
      this.bosses.push(e);
    } else {
      const def = T.enemies[kind as UnitEnemy];
      const el = T.elite;
      const hp = def.hp * hpMult(tMin) * this.benchHpMult * (elite ? el.hp : 1);
      e.r = def.radius * (elite ? el.size : 1);
      e.maxHp = e.hp = hp;
      e.shield = elite === 2 ? hp * el.shield : 0;
      e.speed = def.speed * (elite === 1 ? el.hastedSpeed : el.speed);
      e.damage = def.damage * damageMult(tMin) * (elite ? el.damage : 1);
      e.xp = elite ? el.xp : def.xp;
      e.blocks = kind === 'carapace';
      e.mass = 1 / (e.r * e.r);
    }
    this.enemies.push(e);
    return e;
  }

  private rebuildGrid(): void {
    const g = this.grid;
    g.clear();
    this.big.length = 0;
    const es = this.enemies;
    for (let i = 0; i < es.length; i++) {
      const e = es[i];
      if (e.r > SMALL_R) this.big.push(e);
      else g.insert(i, e.x, e.z);
    }
  }

  private moveEnemies(dt: number): void {
    const es = this.enemies;
    const n = es.length;
    const dW = T.director.despawnScreens * T.camera.viewWidth;
    const dH = T.director.despawnScreens * T.camera.viewHeight;
    const sk = T.enemies.skitter;
    const zigA = (sk.zigAngleDeg * Math.PI) / 180;
    for (let i = 0; i < n; i++) {
      const e = es[i];
      if (e.boss) continue; // bosses steer themselves
      let dx: number;
      let dz: number;
      if (e.marchLeft > 0) {
        dx = e.marchX;
        dz = e.marchZ;
        e.marchLeft -= e.speed * dt;
      } else {
        dx = this.x - e.x;
        dz = this.z - e.z;
        const d = len2(dx, dz);
        if (d < 1e-6) continue;
        dx /= d;
        dz /= d;
        if (e.kind === 'skitter') {
          e.zigT -= dt;
          if (e.zigT <= 0) {
            e.zigT = sk.zigEvery;
            e.zig = -e.zig;
          }
          const a = zigA * e.zig;
          const c = Math.cos(a);
          const s = Math.sin(a);
          const rx = dx * c - dz * s;
          dz = dx * s + dz * c;
          dx = rx;
        }
      }
      e.fx = dx;
      e.fz = dz;
      e.x += dx * e.speed * dt;
      e.z += dz * e.speed * dt;
      // Too far away: respawn near the player (keeps its Surge membership). Elites are kept.
      if (!e.elite) {
        const ox = e.x - this.camX;
        const oz = e.z - this.camZ;
        const sx = ox * RIGHT.x + oz * RIGHT.z;
        const sy = (ox * UP.x + oz * UP.z) * FORESHORTEN;
        if (Math.abs(sx) > dW || Math.abs(sy) > dH) {
          const p = spawnPoint(this);
          e.x = e.px = p.x;
          e.z = e.pz = p.z;
          e.marchLeft = 0;
        }
      }
    }
    // Soft separation, weighted by mass (bosses don't move)
    this.rebuildGrid();
    if (this.pushX.length < n) {
      this.pushX = new Float32Array(n * 2);
      this.pushZ = new Float32Array(n * 2);
    }
    const px = this.pushX;
    const pz = this.pushZ;
    px.fill(0, 0, n);
    pz.fill(0, 0, n);
    const k = T.crowd.separation;
    const pair = (i: number, j: number) => {
      const a = es[i];
      const b = es[j];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const rr = a.r + b.r;
      const d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr) return;
      const tm = a.mass + b.mass;
      if (tm === 0) return;
      let d = Math.sqrt(d2);
      let nx: number;
      let nz: number;
      if (d < 1e-5) {
        const ang = ((a.id * 7919 + b.id * 104729) % 628) / 100;
        nx = Math.cos(ang);
        nz = Math.sin(ang);
        d = 0;
      } else {
        nx = dx / d;
        nz = dz / d;
      }
      const push = ((rr - d) * k) / tm;
      px[i] -= nx * push * a.mass;
      pz[i] -= nz * push * a.mass;
      px[j] += nx * push * b.mass;
      pz[j] += nz * push * b.mass;
    };
    // Small enemies: walk the 3 x 3 grid cells around each one (cells are >= 2 x SMALL_R)
    const g = this.grid;
    const head = g.head;
    const next = g.next;
    const cols = g.cols;
    const bigIdx: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = es[i];
      if (a.r > SMALL_R) {
        bigIdx.push(i);
        continue;
      }
      const c0 = g.col(a.x);
      const r0 = g.col(a.z);
      const cLo = c0 > 0 ? c0 - 1 : 0;
      const cHi = c0 < cols - 1 ? c0 + 1 : c0;
      const rLo = r0 > 0 ? r0 - 1 : 0;
      const rHi = r0 < cols - 1 ? r0 + 1 : r0;
      const ax = a.x;
      const az = a.z;
      const ar = a.r;
      for (let r = rLo; r <= rHi; r++) {
        for (let c = cLo; c <= cHi; c++) {
          for (let j = head[r * cols + c]; j !== -1; j = next[j]) {
            if (j <= i) continue;
            const b = es[j];
            const dx = b.x - ax;
            const dz = b.z - az;
            const rr = ar + b.r;
            if (dx * dx + dz * dz < rr * rr) pair(i, j);
          }
        }
      }
    }
    for (let bi = 0; bi < bigIdx.length; bi++) {
      const ib = bigIdx[bi];
      const b = es[ib];
      g.query(b.x, b.z, b.r + SMALL_R, (j) => pair(ib, j));
      for (let bj = bi + 1; bj < bigIdx.length; bj++) pair(ib, bigIdx[bj]);
    }
    for (let i = 0; i < n; i++) {
      const e = es[i];
      e.x += px[i];
      e.z += pz[i];
      this.clampToArena(e, e.r);
    }
    this.rebuildGrid();
  }

  /** Contact damage; the mech shoulders through the horde but is stopped by blockers. */
  private contact(): void {
    if (this.dead || this.won) return;
    const mr = T.mech.radius;
    let dmg = 0;
    let source = '';
    const touching: Enemy[] = [];
    this.near(this.x, this.z, mr + 0.1, (e) => {
      const rr = mr + e.r + 0.05;
      const dx = e.x - this.x;
      const dz = e.z - this.z;
      if (dx * dx + dz * dz < rr * rr) {
        touching.push(e);
        if (e.damage > dmg) {
          dmg = e.damage;
          source = (e.elite ? 'elite ' : '') + e.kind;
        }
      }
    });
    if (!touching.length) return;
    this.hurt(dmg, source);
    for (const e of touching) {
      let dx = e.x - this.x;
      let dz = e.z - this.z;
      let d = len2(dx, dz);
      if (d < 1e-5) {
        dx = UP.x;
        dz = UP.z;
        d = 1;
      }
      const out = Math.max(0, T.mech.radius + e.r - d);
      if (out <= 0) continue;
      if (e.blocks) {
        // Carapaces and bosses stop the mech
        this.x -= (dx / d) * out;
        this.z -= (dz / d) * out;
        this.clampToArena(this, mr);
      } else {
        e.x += (dx / d) * out;
        e.z += (dz / d) * out;
        this.clampToArena(e, e.r);
      }
    }
  }

  /**
   * Damage an enemy. (sx, sz) is where the damage comes from, for Carapace fronts.
   * Returns true if this killed it.
   */
  damage(e: Enemy, amount: number, src: Src | null, sx: number, sz: number): boolean {
    if (!e.alive) return false;
    if (e.kind === 'carapace') {
      const c = T.enemies.carapace;
      const dx = sx - e.x;
      const dz = sz - e.z;
      const d = len2(dx, dz);
      if (d > 1e-5 && (dx * e.fx + dz * e.fz) / d >= Math.cos(((c.frontArcDeg / 2) * Math.PI) / 180)) amount *= c.frontMult;
    }
    e.lastHit = this.tick;
    let dealt = amount;
    if (e.shield > 0) {
      const absorbed = Math.min(e.shield, amount);
      e.shield -= absorbed;
      amount -= absorbed;
    }
    e.hp -= amount;
    if (e.hp < 0) dealt += e.hp;
    if (src) {
      const key = chainKey(src.chain);
      this.chainDamage.set(key, (this.chainDamage.get(key) ?? 0) + dealt);
      src.chain.parts[src.part].damage += dealt;
    }
    if (e.hp > 0) return false;
    this.kill(e, src);
    return true;
  }

  private kill(e: Enemy, src: Src | null): void {
    e.alive = false;
    this.kills++;
    this.killTimes.push(this.time);
    if (src) {
      const key = chainKey(src.chain);
      this.chainKills.set(key, (this.chainKills.get(key) ?? 0) + 1);
      if (src.pair) this.pairKills.set(src.pair, (this.pairKills.get(src.pair) ?? 0) + 1);
    }
    if (e.surge) onSurgeUnitKilled(this, e);
    if (e.boss) {
      onBossKilled(this, e);
      return;
    }
    this.dropCores(e.x, e.z, e.xp);
    if (e.elite) {
      this.pickups.push({ kind: 'cache', x: e.x, z: e.z, state: 0 });
      this.hitStopTicks = Math.max(this.hitStopTicks, Math.round(T.sim.eliteHitStop * T.sim.tickRate));
      this.events.push({ type: 'eliteDown' });
    } else {
      const P = T.pickups;
      if (this.time - this.lastRepair >= P.repairCooldown && this.rng.chance(P.repairChance)) {
        this.lastRepair = this.time;
        this.pickups.push({ kind: 'repair', x: e.x, z: e.z, state: 0 });
      } else if (this.time - this.lastMagnet >= P.magnetCooldown && this.rng.chance(P.magnetChance)) {
        this.lastMagnet = this.time;
        this.pickups.push({ kind: 'magnet', x: e.x, z: e.z, state: 0 });
      }
    }
    if (e.kind === 'splitter') {
      const n = T.enemies.splitter.splits;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + (e.id % 7);
        this.spawnEnemy('mite', e.x + Math.cos(a) * 0.5, e.z + Math.sin(a) * 0.5, 0, 0);
      }
    }
  }

  private compactEnemies(): void {
    const es = this.enemies;
    let w = 0;
    for (let i = 0; i < es.length; i++) {
      const e = es[i];
      if (e.alive) es[w++] = e;
      else this.enemyPool.push(e);
    }
    es.length = w;
    if (this.bosses.some((b) => !b.alive)) this.bosses = this.bosses.filter((b) => b.alive);
  }

  // ---------------------------------------------------------------- Links

  /** A hit by part `src.part` of its chain on enemy e: roll for the next part. */
  hit(src: Src, e: Enemy): void {
    const chain = src.chain;
    const part = src.part;
    if (part >= chain.parts.length - 1) return; // the tail rolls for nothing
    const slot = this.build.hardpoints.indexOf(chain);
    if (slot < 0) return; // effect from a chain that has since been re-linked
    const next = part + 1;
    const gi = slot * T.links.maxParts + next;
    if (e.gate[gi] > this.time) return;
    const p = chain.parts[next];
    const base = T.weapons[p.weapon.id].trigger.chance;
    const chance = this.stress ? 1 : triggerChance(base, chain.level);
    if (!this.rng.chance(chance)) return;
    e.gate[gi] = this.time + T.links.enemyGate;
    const pair = `${chain.parts[part].weapon.id}>${p.weapon.id}`;
    if (!this.codex.has(pair)) {
      this.codex.add(pair);
      this.events.push({ type: 'codex', pair });
    }
    let capped = this.triggeredEffects >= T.links.maxTriggeredEffects;
    if (capped && endOldestContinuous(this)) capped = false;
    const grant = takeTrigger(p, capped);
    if (!grant) return;
    const power = triggerMult(chain.level) * (1 + grant.power) * this.build.stats.power;
    const size = 1 + grant.size;
    fireTrigger(this, chain, next, e, power, size, pair);
  }

  /** An area pulse: rolls for up to 3 random enemies it hit. */
  areaHits(src: Src, hit: Enemy[]): void {
    const chain = src.chain;
    if (src.part >= chain.parts.length - 1 || !hit.length) return;
    const pool = hit.slice();
    const n = Math.min(T.links.areaRolls, pool.length);
    for (let i = 0; i < n; i++) {
      const e = pool.splice(this.rng.int(pool.length), 1)[0];
      this.hit(src, e);
    }
  }

  // ---------------------------------------------------------------- XP and pickups

  dropCores(x: number, z: number, xp: number): void {
    let left = xp;
    for (const v of T.xp.coreValues) {
      while (left >= v) {
        left -= v;
        this.addCore(x, z, v);
      }
    }
  }

  private addCore(x: number, z: number, value: number): void {
    const cs = this.cores;
    if (cs.length >= T.xp.maxCoresOnGround) {
      let best = 0;
      let bd = Infinity;
      for (let i = 0; i < cs.length; i++) {
        const dx = cs[i].x - x;
        const dz = cs[i].z - z;
        const d = dx * dx + dz * dz;
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      cs[best].value += value;
      return;
    }
    cs.push({ x, z, px: x, pz: z, value, state: this.overflowTicks > 0 ? 2 : 0 });
  }

  /** Pull every core on the map to the mech (Overflow, Magnet Pulse). */
  pullAllCores(): void {
    for (const c of this.cores) c.state = 2;
  }

  private updateCores(dt: number): void {
    const cs = this.cores;
    const mag = this.build.stats.magnet;
    const mag2 = mag * mag;
    const pick2 = T.xp.pickupRadius * T.xp.pickupRadius;
    const alive = !this.dead && !this.won;
    let w = 0;
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      const dx = this.x - c.x;
      const dz = this.z - c.z;
      const d2 = dx * dx + dz * dz;
      if (alive) {
        if (d2 <= pick2) {
          this.addXp(c.value);
          continue;
        }
        if (c.state === 0 && d2 <= mag2) c.state = 1;
        if (c.state) {
          const d = Math.sqrt(d2);
          const sp = (c.state === 2 ? T.xp.overflowSpeed : T.xp.magnetSpeed) * dt;
          const m = Math.min(1, sp / d);
          c.x += dx * m;
          c.z += dz * m;
        }
      }
      cs[w++] = c;
    }
    cs.length = w;
  }

  private updatePickups(dt: number): void {
    if (this.dead || this.won) return;
    const mag = this.build.stats.magnet;
    const pr = T.pickups.radius;
    let w = 0;
    for (const p of this.pickups) {
      const dx = this.x - p.x;
      const dz = this.z - p.z;
      const d = len2(dx, dz);
      if (d <= pr) {
        this.collect(p.kind);
        continue;
      }
      if (d <= mag) p.state = 1;
      if (p.state) {
        const m = Math.min(1, (T.xp.magnetSpeed * dt) / d);
        p.x += dx * m;
        p.z += dz * m;
      }
      this.pickups[w++] = p;
    }
    this.pickups.length = w;
  }

  private collect(kind: PickupKind): void {
    this.events.push({ type: 'pickup', kind });
    if (kind === 'repair') this.hull = Math.min(this.build.maxHull, this.hull + T.pickups.repairHeal);
    else if (kind === 'magnet') this.pullAllCores();
    else {
      this.cacheLevels++;
      this.levelUp();
    }
  }

  addXp(v: number): void {
    this.xp += v;
    this.xpEarned += v;
    while (this.xp >= xpNext(this.level)) {
      this.xp -= xpNext(this.level);
      this.levelUp();
    }
  }

  /** One level-up: a draft to pick from (queued). Overflow Caches call this directly. */
  levelUp(): void {
    this.level++;
    this.pendingLevels++;
    this.events.push({ type: 'levelup' });
  }

  // ---------------------------------------------------------------- drafting

  maybeOpenDraft(): void {
    if (this.draft || this.pendingLevels <= 0 || this.dead || this.won || this.overflowTicks > 0) return;
    if (this.benchCount > 0) return; // benchmarks run uninterrupted
    const possible = linkOptions(this.build, this.linkLevel).length > 0;
    const withLink = possible && (this.forceLinkDraft || !this.lastDraftHadLink);
    this.forceLinkDraft = false;
    this.draft = makeDraft(this.draftContext(), this.rng, withLink);
    this.draftHasLink = this.draft.some((c) => c.type === 'link');
    this.lastDraftHadLink = this.draftHasLink;
    if (!this.draft.length) {
      this.draft = null;
      this.pendingLevels = 0;
    }
  }

  private applyCard(card: Card, order: number): void {
    const b = this.build;
    switch (card.type) {
      case 'level': {
        const w = findWeapon(b, card.weapon);
        if (w && w.level < this.weaponCap) w.level++;
        break;
      }
      case 'new':
        addWeapon(b, card.weapon);
        break;
      case 'stat':
        this.boostStat(card.stat);
        break;
      case 'chain': {
        const c = b.hardpoints[card.slot];
        if (c && c.level < T.links.maxChainLevel) c.level++;
        break;
      }
      case 'link':
        this.formLink(card.option, card.option.orders[order] ?? card.option.orders[0]);
        this.lastDraftHadLink = false;
        break;
    }
  }

  private boostStat(stat: StatId): void {
    const def = T.stats[stat];
    if (stat === 'hull') {
      this.build.maxHull += def.step;
      this.hull += def.step;
      return;
    }
    this.build.stats[stat] = Math.min(def.cap, this.build.stats[stat] + def.step);
  }

  private formLink(opt: LinkOption, order: WeaponId[]): Chain {
    const chain = applyLink(this.build, opt, order);
    this.hitStopTicks = Math.round(T.sim.linkHitStop * T.sim.tickRate);
    this.linksMade++;
    this.addFeat('firstLink');
    if (this.linksMade >= 3) this.addFeat('threeLinks');
    if (chain.parts.length >= 3) {
      this.addFeat('apex');
      this.apexes.add(chainKey(chain));
    }
    this.events.push({ type: 'link', chain: chain.parts.map((p) => p.weapon.id) });
    return chain;
  }

  // ---------------------------------------------------------------- dev

  private applyDev(c: DevCommand): void {
    const b = this.build;
    switch (c.cmd) {
      case 'grant': {
        const w = findWeapon(b, c.weapon) ?? addWeapon(b, c.weapon);
        if (w) w.level = Math.max(1, Math.min(this.weaponCap, c.level));
        break;
      }
      case 'level': {
        const w = findWeapon(b, c.weapon);
        if (w) w.level = Math.max(1, Math.min(this.weaponCap, c.level));
        break;
      }
      case 'link': {
        // Grant every part at the Link level (freeing a hardpoint if needed), then Link them in order.
        for (const id of c.chain) {
          let w = findWeapon(b, id);
          if (!w) {
            if (b.hardpoints.indexOf(null) < 0) {
              const drop = b.hardpoints.findIndex((ch) => ch && ch.parts.length === 1 && !c.chain.includes(ch.parts[0].weapon.id));
              if (drop >= 0) b.hardpoints[drop] = null;
            }
            w = addWeapon(b, id) ?? undefined;
          }
          if (w) w.level = Math.max(w.level, this.linkLevel);
        }
        const [h, t, third] = c.chain;
        let opt = linkOptions(b, this.linkLevel).find(
          (o) => o.kind === 'pair' && o.orders.some((ord) => ord[0] === h && ord[1] === t),
        );
        if (!opt) break;
        const chain = this.formLink(opt, [h, t]);
        chain.level = Math.max(1, Math.min(5, c.chainLevel));
        if (third) {
          chain.level = Math.max(chain.level, T.links.apexMinChainLevel);
          opt = linkOptions(b, this.linkLevel).find((o) => o.kind === 'apex' && o.orders[1][2] === third);
          if (opt) this.formLink(opt, opt.orders[1]);
        }
        break;
      }
      case 'chainLevel': {
        const ch = b.hardpoints[c.slot];
        if (ch && ch.parts.length > 1) ch.level = Math.max(1, Math.min(5, c.level));
        break;
      }
      case 'stat':
        if (c.stat === 'hull') {
          b.maxHull = c.value;
          this.hull = c.value;
        } else b.stats[c.stat] = c.value;
        break;
      case 'surge':
        devSurge(this, c.n);
        break;
      case 'boss':
        devBoss(this, c.kind);
        break;
      case 'elite':
        devElite(this);
        break;
      case 'spawn':
        for (let i = 0; i < c.count; i++) {
          const p = spawnPoint(this);
          this.spawnEnemy(c.kind ?? 'mite', p.x, p.z, 0);
        }
        break;
      case 'god':
        this.god = c.on;
        break;
      case 'stress':
        this.stress = c.on;
        break;
      case 'bench':
        this.benchCount = c.count;
        this.benchHpMult = hpMult(c.minutes) / hpMult(this.tMin);
        this.god = true;
        break;
      case 'time':
        this.time = c.seconds;
        while (this.surgeIndex < T.surge.schedule.length && T.surge.schedule[this.surgeIndex].time < this.time) {
          this.surgeIndex++;
          this.surgeCount++;
        }
        while (this.nextElite < this.time) this.nextElite += T.elite.every;
        break;
      case 'xp':
        this.addXp(c.amount);
        this.maybeOpenDraft();
        break;
      case 'director':
        this.directorOn = c.on;
        break;
    }
  }

  /** A compact fingerprint of the run state, for reproducibility checks. */
  fingerprint(): string {
    let ex = 0;
    let ez = 0;
    let hp = 0;
    for (const e of this.enemies) {
      ex += e.x;
      ez += e.z;
      hp += e.hp;
    }
    const weapons = allWeapons(this.build)
      .map((w) => `${w.id}${w.level}`)
      .join(',');
    return [
      this.tick,
      this.time.toFixed(6),
      this.x.toFixed(6),
      this.z.toFixed(6),
      this.hull.toFixed(4),
      this.level,
      this.xp,
      this.kills,
      this.enemies.length,
      ex.toFixed(4),
      ez.toFixed(4),
      hp.toFixed(4),
      this.bolts.length + this.missiles.length + this.shells.length + this.zones.length,
      this.cores.length,
      weapons,
      this.rng.state().join(':'),
    ].join('|');
  }
}

export function chainKey(c: Chain): string {
  return c.parts.map((p) => p.weapon.id).join('>');
}

export function clampAbs(v: number, lim: number): number {
  return v < -lim ? -lim : v > lim ? lim : v;
}

/** Decode a logged input code back to (mx, my). */
export function decodeInput(code: number): [number, number] {
  return [Math.floor(code / 3) - 1, (code % 3) - 1];
}

/** Rebuild a run from its options and logs. */
export function replay(opts: WorldOptions, inputs: number[], log: LogEvent[]): World {
  const w = new World(opts);
  let li = 0;
  const applyDue = () => {
    while (li < log.length && log[li].tick === w.tick) {
      const ev = log[li++];
      if (ev.type === 'choose') w.choose(ev.index, ev.order);
      else if (ev.type === 'reroll') w.reroll();
      else w.dev(ev.cmd);
    }
  };
  applyDue();
  for (const code of inputs) {
    const [mx, my] = decodeInput(code);
    w.step(mx, my);
    applyDue();
  }
  return w;
}
