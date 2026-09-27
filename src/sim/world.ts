// The whole game simulation: deterministic, fixed-step, no DOM or rendering.
// Same seed + same input log => same run (see tests/determinism.test.ts).
import { TUNING, type EnemyKind, type StatId, type WeaponId } from '../tuning';
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
import {
  damageMult,
  hpMult,
  onScreenTarget,
  surgeSize,
  threatPerSecond,
  triggerChance,
  triggerMult,
  xpNext,
} from './formulas';
import { Grid } from './grid';
import { Rng } from './rng';
import { FORESHORTEN, HALF_H, HALF_W, RIGHT, UP, inputToGround, toGround } from './view';

const T = TUNING;
const DT = 1 / T.sim.tickRate;
const MAX_PART_SLOTS = 4 * T.links.maxParts;

export interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number;
  z: number;
  px: number; // position at the start of the tick, for render interpolation
  pz: number;
  r: number;
  hp: number;
  maxHp: number;
  speed: number;
  damage: number;
  xp: number;
  alive: boolean;
  lastHit: number; // tick of the last hit, for the white flash
  surge: number; // id of the Surge this unit belongs to, 0 if none
  gate: Float64Array; // per Link part: game time until this enemy may source another trigger
}

export interface Bolt {
  x: number;
  z: number;
  px: number;
  pz: number;
  dx: number;
  dz: number;
  speed: number;
  travelled: number;
  range: number;
  radius: number;
  damage: number;
  pierce: number;
  hits: number[];
  chain: Chain | null;
  part: number;
  triggered: boolean;
  alive: boolean;
}

export interface Arc {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  life: number;
  maxLife: number;
  weapon: WeaponId;
  triggered: boolean;
}

export interface Core {
  x: number;
  z: number;
  px: number;
  pz: number;
  value: number;
  state: 0 | 1 | 2; // idle, magnetised, Overflow pull
}

export type WorldEvent =
  | { type: 'levelup' }
  | { type: 'hurt' }
  | { type: 'link'; chain: WeaponId[] }
  | { type: 'codex'; pair: string }
  | { type: 'breath' }
  | { type: 'surge'; size: number }
  | { type: 'overflow'; breakTime: number }
  | { type: 'death' };

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
  | { cmd: 'surge' }
  | { cmd: 'spawn'; count: number }
  | { cmd: 'god'; on: boolean }
  | { cmd: 'stress'; on: boolean }
  | { cmd: 'bench'; count: number; minutes: number }
  | { cmd: 'time'; seconds: number }
  | { cmd: 'xp'; amount: number }
  | { cmd: 'director'; on: boolean };

export type SurgePhase = 'build' | 'breath' | 'surge';

export interface WorldOptions {
  seed: number;
}

export class World {
  readonly seed: number;
  readonly rng: Rng;

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
  runOver = false;
  private deathTimer = 0;

  // Camera (simulated so spawning is deterministic)
  camX = 0;
  camZ = 0;
  pcamX = 0;
  pcamZ = 0;

  build: Build;
  weaponCap = 5;
  linkLevel: number = T.links.linkLevel;

  // Progress
  level = 1;
  xp = 0;
  kills = 0;
  pendingLevels = 0;
  draft: Card[] | null = null;
  private draftHasLink = false;
  private lastDraftHadLink = false;
  rerolls: number = T.draft.rerollsPerRun;
  codex = new Set<string>();

  // Entities
  enemies: Enemy[] = [];
  bolts: Bolt[] = [];
  arcs: Arc[] = [];
  cores: Core[] = [];
  private triggeredArcsExpire: number[] = []; // game time at which each live triggered Tesla effect ends
  private enemyPool: Enemy[] = [];
  private nextEnemyId = 1;
  private grid: Grid;
  private cands: number[] = [];
  private collect = (i: number) => {
    this.cands.push(i);
  };
  private pushX = new Float32Array(2048);
  private pushZ = new Float32Array(2048);

  // Director
  private budget = 0;
  private killTimes: number[] = [];
  private killHead = 0;
  surgePhase: SurgePhase = 'build';
  private surgeIndex = 0; // next scheduled Surge
  surgeCount = 0; // Surges spawned so far
  private surgeId = 0;
  surgeSize = 0;
  surgeKilled = 0;
  surgeStart = 0;
  lastBreakTime = 0;

  // Time control, in real ticks
  private hitStopTicks = 0;
  overflowTicks = 0;

  // Dev
  god = false;
  stress = false;
  benchCount = 0;
  directorOn = true;
  private benchHpMult = 1;

  // Logs
  inputs: number[] = [];
  log: LogEvent[] = [];
  events: WorldEvent[] = [];

  constructor(opts: WorldOptions) {
    this.seed = opts.seed >>> 0;
    this.rng = new Rng(this.seed);
    const f = T.frames.vanguard;
    this.build = makeBuild(f.hardpoints, f.hull, f.speed);
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
    if (this.dead) return T.death.slowScale;
    if (this.overflowTicks > 0) return T.overflow.slowScale;
    return 1;
  }

  /** Seconds until the next scheduled Surge arrives, or null. */
  get nextSurgeIn(): number | null {
    const s = T.surge.schedule[this.surgeIndex];
    return s ? Math.max(0, s.time - this.time) : null;
  }

  get triggeredEffects(): number {
    let n = this.triggeredArcsExpire.length;
    for (const b of this.bolts) if (b.triggered) n++;
    return n;
  }

  private draftContext(): DraftContext {
    return { build: this.build, unlocked: T.weaponPool, weaponCap: this.weaponCap, linkLevel: this.linkLevel };
  }

  // ---------------------------------------------------------------- input

  /** Advance one fixed tick. mx, my in {-1, 0, 1}; my = +1 is up-screen. */
  step(mx: number, my: number): void {
    if (this.draft || this.runOver) return;
    this.inputs.push((mx + 1) * 3 + (my + 1));

    const scale = this.timeScale;
    const dt = DT * scale;
    if (this.hitStopTicks > 0) this.hitStopTicks--;
    else if (this.overflowTicks > 0) this.overflowTicks--;

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
    for (const c of this.cores) {
      c.px = c.x;
      c.pz = c.z;
    }
    if (dt > 0) {
      if (this.dead) {
        this.deathTimer -= dt;
        if (this.deathTimer <= 0) this.runOver = true;
      } else {
        this.moveMech(mx, my, dt);
      }
      this.moveCamera(dt);
      this.direct(dt);
      this.moveEnemies(dt);
      this.contact();
      this.fireWeapons(dt);
      this.updateBolts(dt);
      this.updateArcs(dt);
      this.compactEnemies();
      this.updateCores(dt);
      this.checkSurgeBreak();
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

  // ---------------------------------------------------------------- mech

  private moveMech(mx: number, my: number, dt: number): void {
    const speed = this.build.stats.speed;
    let tx = 0;
    let tz = 0;
    if (mx || my) {
      const g = inputToGround(mx, my);
      const len = Math.hypot(g.x, g.z);
      tx = (g.x / len) * speed;
      tz = (g.z / len) * speed;
    }
    // Reach the target velocity within accelTime: no drift.
    const maxDv = (speed / T.mech.accelTime) * dt;
    const dvx = tx - this.vx;
    const dvz = tz - this.vz;
    const dv = Math.hypot(dvx, dvz);
    if (dv <= maxDv) {
      this.vx = tx;
      this.vz = tz;
    } else {
      this.vx += (dvx / dv) * maxDv;
      this.vz += (dvz / dv) * maxDv;
    }
    const lim = T.arena.halfSize - T.mech.radius;
    this.x = clampAbs(this.x + this.vx * dt, lim);
    this.z = clampAbs(this.z + this.vz * dt, lim);
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

  // ---------------------------------------------------------------- director

  private direct(dt: number): void {
    // Kill window for Surge sizing
    while (this.killHead < this.killTimes.length && this.killTimes[this.killHead] < this.time - 60) this.killHead++;
    if (this.killHead > 4096) {
      this.killTimes = this.killTimes.slice(this.killHead);
      this.killHead = 0;
    }

    if (this.benchCount > 0) {
      this.maintainBench();
      return;
    }

    const next = T.surge.schedule[this.surgeIndex];
    if (next && !this.dead && this.directorOn) {
      if (this.surgePhase === 'build' && this.time >= next.time - T.surge.breath) {
        this.surgePhase = 'breath';
        this.events.push({ type: 'breath' });
      }
      if (this.surgePhase === 'breath' && this.time >= next.time) {
        this.surgeIndex++;
        this.startSurge();
      }
    }

    if (this.surgePhase === 'breath' || this.dead || !this.directorOn) return;
    const tMin = this.tMin;
    const income = threatPerSecond(tMin);
    this.budget = Math.min(this.budget + income * dt, income * T.director.maxBankedSeconds);
    const target = onScreenTarget(tMin);
    while (this.enemies.length < target && this.enemies.length < T.sim.maxEnemies) {
      const kind = this.pickKind();
      const cost = T.enemies[kind].cost;
      if (this.budget < cost) break;
      this.budget -= cost;
      const p = this.spawnPoint();
      this.spawnEnemy(kind, p.x, p.z, 0);
    }
  }

  private pickKind(): EnemyKind {
    // Milestone 1 implements Mites only; later windows' units fall back to Mites.
    return 'mite';
  }

  private killsLast60(): number {
    return this.killTimes.length - this.killHead;
  }

  private startSurge(): void {
    this.surgeCount++;
    const n = this.surgeCount;
    const size = surgeSize(n, this.killsLast60(), this.tMin);
    this.surgeId++;
    this.surgePhase = 'surge';
    this.surgeKilled = 0;
    this.surgeStart = this.time;
    // Formation: Ring of Mites, spawned at the camera edge around the mech.
    let placed = 0;
    let radius = T.surge.ringRadius;
    const room = T.sim.maxEnemies - this.enemies.length;
    const total = Math.min(size, room);
    const lim = T.arena.halfSize - 1;
    while (placed < total) {
      const perRow = Math.max(8, Math.floor((2 * Math.PI * radius) / T.surge.ringSpacing));
      const count = Math.min(perRow, total - placed);
      const offset = this.rng.next() * Math.PI * 2;
      for (let i = 0; i < count; i++) {
        const a = offset + (i / count) * Math.PI * 2;
        const x = clampAbs(this.x + Math.cos(a) * radius, lim);
        const z = clampAbs(this.z + Math.sin(a) * radius, lim);
        this.spawnEnemy('mite', x, z, this.surgeId);
      }
      placed += count;
      radius += T.surge.ringSpacing;
    }
    this.surgeSize = placed;
    this.events.push({ type: 'surge', size: placed });
  }

  private checkSurgeBreak(): void {
    if (this.surgePhase !== 'surge') return;
    if (this.surgeKilled < Math.ceil(this.surgeSize * T.surge.breakFraction)) return;
    this.surgePhase = 'build';
    this.lastBreakTime = this.time - this.surgeStart;
    this.surgeId++; // survivors keep an id that no longer counts
    // Overflow: pull every core, heal, slow time.
    for (const c of this.cores) c.state = 2;
    if (!this.dead) this.hull = Math.min(this.build.maxHull, this.hull + T.overflow.heal);
    this.overflowTicks = Math.round(T.overflow.slowTime * T.sim.tickRate);
    this.events.push({ type: 'overflow', breakTime: this.lastBreakTime });
  }

  /** A point 2-4 u beyond the edge of the nominal camera view, inside the arena. */
  private spawnPoint(): { x: number; z: number } {
    const lim = T.arena.halfSize - 1;
    let best = { x: 0, z: 0 };
    for (let attempt = 0; attempt < 4; attempt++) {
      const m = this.rng.range(T.director.spawnMarginMin, T.director.spawnMarginMax);
      const w = HALF_W + m;
      const h = HALF_H + m;
      const r = this.rng.next() * (4 * w + 4 * h);
      let sx: number;
      let sy: number;
      if (r < 2 * w) {
        sx = r - w;
        sy = h;
      } else if (r < 4 * w) {
        sx = r - 3 * w;
        sy = -h;
      } else if (r < 4 * w + 2 * h) {
        sx = w;
        sy = r - 4 * w - h;
      } else {
        sx = -w;
        sy = r - 4 * w - 3 * h;
      }
      const g = toGround(sx, sy);
      best = { x: this.camX + g.dx, z: this.camZ + g.dz };
      if (Math.abs(best.x) <= lim && Math.abs(best.z) <= lim) return best;
    }
    return { x: clampAbs(best.x, lim), z: clampAbs(best.z, lim) };
  }

  spawnEnemy(kind: EnemyKind, x: number, z: number, surge: number): Enemy | null {
    if (this.enemies.length >= T.sim.maxEnemies) return null;
    const def = T.enemies[kind];
    const e: Enemy = this.enemyPool.pop() ?? {
      id: 0,
      kind,
      x: 0,
      z: 0,
      px: 0,
      pz: 0,
      r: 0,
      hp: 0,
      maxHp: 0,
      speed: 0,
      damage: 0,
      xp: 0,
      alive: true,
      lastHit: -99,
      surge: 0,
      gate: new Float64Array(MAX_PART_SLOTS),
    };
    const tMin = this.tMin;
    e.id = this.nextEnemyId++;
    e.kind = kind;
    e.x = e.px = x;
    e.z = e.pz = z;
    e.r = def.radius;
    e.maxHp = e.hp = def.hp * hpMult(tMin) * this.benchHpMult;
    e.speed = def.speed;
    e.damage = def.damage * damageMult(tMin);
    e.xp = def.xp;
    e.alive = true;
    e.lastHit = -99;
    e.surge = surge;
    e.gate.fill(-1);
    this.enemies.push(e);
    return e;
  }

  private maintainBench(): void {
    while (this.enemies.length < this.benchCount) {
      const a = this.rng.next() * Math.PI * 2;
      const r = this.rng.range(3, 14);
      this.spawnEnemy('mite', clampAbs(this.x + Math.cos(a) * r, 99), clampAbs(this.z + Math.sin(a) * r, 99), 0);
    }
  }

  // ---------------------------------------------------------------- enemies

  private rebuildGrid(): void {
    const g = this.grid;
    g.clear();
    const es = this.enemies;
    for (let i = 0; i < es.length; i++) g.insert(i, es[i].x, es[i].z);
  }

  private moveEnemies(dt: number): void {
    const es = this.enemies;
    const n = es.length;
    const lim = T.arena.halfSize - 0.5;
    const dW = T.director.despawnScreens * T.camera.viewWidth;
    const dH = T.director.despawnScreens * T.camera.viewHeight;
    // Seek the mech
    for (let i = 0; i < n; i++) {
      const e = es[i];
      const dx = this.x - e.x;
      const dz = this.z - e.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-6) {
        const s = (e.speed * dt) / d;
        e.x += dx * s;
        e.z += dz * s;
      }
      // Too far away: respawn near the player (keeps its Surge membership)
      const ox = e.x - this.camX;
      const oz = e.z - this.camZ;
      const sx = ox * RIGHT.x + oz * RIGHT.z;
      const sy = (ox * UP.x + oz * UP.z) * FORESHORTEN;
      if (Math.abs(sx) > dW || Math.abs(sy) > dH) {
        const p = this.spawnPoint();
        e.x = e.px = p.x;
        e.z = e.pz = p.z;
      }
    }
    // Soft separation
    this.rebuildGrid();
    if (this.pushX.length < n) {
      this.pushX = new Float32Array(n * 2);
      this.pushZ = new Float32Array(n * 2);
    }
    const px = this.pushX;
    const pz = this.pushZ;
    px.fill(0, 0, n);
    pz.fill(0, 0, n);
    const k = T.crowd.separation * 0.5;
    for (let i = 0; i < n; i++) {
      const a = es[i];
      const reach = a.r + 0.9;
      this.grid.query(a.x, a.z, reach, (j) => {
        if (j <= i) return;
        const b = es[j];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const rr = a.r + b.r;
        const d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr) return;
        let d = Math.sqrt(d2);
        let nx: number;
        let nz: number;
        if (d < 1e-5) {
          // Coincident: separate along a direction derived from the ids (deterministic)
          const ang = ((a.id * 7919 + b.id * 104729) % 628) / 100;
          nx = Math.cos(ang);
          nz = Math.sin(ang);
          d = 0;
        } else {
          nx = dx / d;
          nz = dz / d;
        }
        const push = (rr - d) * k;
        px[i] -= nx * push;
        pz[i] -= nz * push;
        px[j] += nx * push;
        pz[j] += nz * push;
      });
    }
    for (let i = 0; i < n; i++) {
      const e = es[i];
      e.x = clampAbs(e.x + px[i], lim);
      e.z = clampAbs(e.z + pz[i], lim);
    }
    this.rebuildGrid();
  }

  /** Contact damage, knockback and shouldering through the horde. */
  private contact(): void {
    const es = this.enemies;
    const mr = T.mech.radius;
    const touching: number[] = [];
    if (!this.dead) {
      this.grid.query(this.x, this.z, mr + 1, (i) => {
        const e = es[i];
        const rr = mr + e.r + 0.05;
        const dx = e.x - this.x;
        const dz = e.z - this.z;
        if (dx * dx + dz * dz < rr * rr) touching.push(i);
      });
    }
    let knock = false;
    if (touching.length && this.invuln <= 0 && !this.god) {
      let dmg = 0;
      for (const i of touching) dmg = Math.max(dmg, es[i].damage);
      this.hull -= dmg;
      this.invuln = T.mech.invulnTime;
      knock = true;
      this.events.push({ type: 'hurt' });
      if (this.hull <= 0) this.die();
    }
    for (const i of touching) {
      const e = es[i];
      let dx = e.x - this.x;
      let dz = e.z - this.z;
      let d = Math.hypot(dx, dz);
      if (d < 1e-5) {
        dx = UP.x;
        dz = UP.z;
        d = 1;
      }
      const rr = mr + e.r;
      // Shoulder the Mite out of the way; knock it back 1 u after a hit.
      const out = Math.max(0, rr - d) + (knock ? T.mech.knockback : 0);
      e.x = clampAbs(e.x + (dx / d) * out, T.arena.halfSize - 0.5);
      e.z = clampAbs(e.z + (dz / d) * out, T.arena.halfSize - 0.5);
    }
  }

  private die(): void {
    this.hull = 0;
    this.dead = true;
    this.deathTimer = T.death.slowTime;
    this.vx = this.vz = 0;
    this.events.push({ type: 'death' });
  }

  private damage(e: Enemy, amount: number): void {
    if (!e.alive) return;
    e.hp -= amount;
    e.lastHit = this.tick;
    if (e.hp > 0) return;
    e.alive = false;
    this.kills++;
    this.killTimes.push(this.time);
    if (e.surge && e.surge === this.surgeId && this.surgePhase === 'surge') this.surgeKilled++;
    this.dropCores(e.x, e.z, e.xp);
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
  }

  // ---------------------------------------------------------------- weapons

  private fireWeapons(dt: number): void {
    refillLimiters(this.build, dt);
    if (this.dead) return;
    const rate = this.build.stats.rate;
    for (const chain of this.build.hardpoints) {
      if (!chain) continue;
      const head = chain.parts[0].weapon; // only the head fires on its own
      head.cooldown -= dt;
      if (head.cooldown > 0) continue;
      let fired = false;
      if (head.id === 'pulse') fired = this.firePulse(chain);
      else if (head.id === 'tesla') fired = this.fireTesla(chain);
      if (fired) head.cooldown = this.cooldownOf(head.id, head.level) / rate;
      else head.cooldown = 0;
    }
  }

  private cooldownOf(id: WeaponId, level: number): number {
    if (id === 'pulse') return T.weapons.pulse.levels[level]!.cooldown;
    return T.weapons.tesla.cooldown;
  }

  /** Up to k nearest live enemies within range of (x, z), nearest first. */
  private nearest(x: number, z: number, range: number, k: number, exclude?: Set<number>): Enemy[] {
    if (k === 1) {
      const e = this.nearestOne(x, z, range, exclude);
      return e ? [e] : [];
    }
    const es = this.enemies;
    const found: { e: Enemy; d: number }[] = [];
    const r2 = range * range;
    this.grid.query(x, z, range, (i) => {
      const e = es[i];
      if (!e || !e.alive || (exclude && exclude.has(e.id))) return;
      const dx = e.x - x;
      const dz = e.z - z;
      const d = dx * dx + dz * dz;
      if (d > r2) return;
      found.push({ e, d });
    });
    found.sort((a, b) => a.d - b.d || a.e.id - b.e.id);
    const out: Enemy[] = [];
    for (let i = 0; i < found.length && i < k; i++) out.push(found[i].e);
    return out;
  }

  private nearestOne(x: number, z: number, range: number, exclude?: Set<number>): Enemy | null {
    const es = this.enemies;
    let best: Enemy | null = null;
    let bd = range * range;
    this.grid.query(x, z, range, (i) => {
      const e = es[i];
      if (!e || !e.alive || (exclude && exclude.has(e.id))) return;
      const dx = e.x - x;
      const dz = e.z - z;
      const d = dx * dx + dz * dz;
      if (d < bd || (d === bd && best && e.id < best.id)) {
        bd = d;
        best = e;
      }
    });
    return best;
  }

  private firePulse(chain: Chain): boolean {
    const P = T.weapons.pulse;
    const w = chain.parts[0].weapon;
    const lv = P.levels[w.level]!;
    const targets = this.nearest(this.x, this.z, P.acquireRange, lv.bolts);
    if (!targets.length) return false;
    const damage = P.damage * lv.damageMult * this.build.stats.power;
    for (let i = 0; i < lv.bolts; i++) {
      const t = targets[i % targets.length];
      let dx = t.x - this.x;
      let dz = t.z - this.z;
      const d = Math.hypot(dx, dz) || 1;
      dx /= d;
      dz /= d;
      if (i >= targets.length) {
        // More bolts than targets: fan the extras around the nearest
        const a = ((i - targets.length + 1) * 8 * Math.PI) / 180 * (i % 2 ? 1 : -1);
        const c = Math.cos(a);
        const s = Math.sin(a);
        [dx, dz] = [dx * c - dz * s, dx * s + dz * c];
      }
      this.bolts.push({
        x: this.x,
        z: this.z,
        px: this.x,
        pz: this.z,
        dx,
        dz,
        speed: P.speed,
        travelled: 0,
        range: P.range,
        radius: P.boltRadius,
        damage,
        pierce: lv.pierce,
        hits: [],
        chain,
        part: 0,
        triggered: false,
        alive: true,
      });
    }
    return true;
  }

  private fireTesla(chain: Chain): boolean {
    const TS = T.weapons.tesla;
    const w = chain.parts[0].weapon;
    const lv = TS.levels[w.level]!;
    const firsts = this.nearest(this.x, this.z, TS.acquireRange, lv.chains);
    if (!firsts.length) return false;
    const hit = new Set<number>();
    const damage = TS.damage * lv.damageMult * this.build.stats.power;
    const range = TS.jumpRange * this.build.stats.area;
    for (const first of firsts) {
      if (hit.has(first.id)) continue;
      this.teslaWalk(this.x, this.z, first, lv.jumps, 0, lv.fork, damage, range, hit, chain, 0, false);
    }
    return true;
  }

  /** Walk a Tesla chain: each jump hits one enemy and is one hit event. */
  private teslaWalk(
    fromX: number,
    fromZ: number,
    first: Enemy,
    jumps: number,
    hitNo: number,
    fork: boolean,
    damage: number,
    range: number,
    hit: Set<number>,
    chain: Chain,
    part: number,
    triggered: boolean,
  ): void {
    let cx = fromX;
    let cz = fromZ;
    let e: Enemy | undefined = first;
    let left = jumps;
    let n = hitNo;
    while (e && left > 0) {
      hit.add(e.id);
      this.arcs.push({
        x1: cx,
        z1: cz,
        x2: e.x,
        z2: e.z,
        life: T.weapons.tesla.arcLife,
        maxLife: T.weapons.tesla.arcLife,
        weapon: 'tesla',
        triggered,
      });
      this.damage(e, damage);
      this.hitEvent(chain, part, e);
      left--;
      n++;
      cx = e.x;
      cz = e.z;
      if (fork && n === T.weapons.tesla.forkAtJump && left > 0) {
        for (let b = 0; b < 2; b++) {
          const nb = this.nearest(cx, cz, range, 1, hit)[0];
          if (nb) this.teslaWalk(cx, cz, nb, left, n, false, damage, range, hit, chain, part, triggered);
        }
        return;
      }
      e = this.nearest(cx, cz, range, 1, hit)[0];
    }
  }

  // ---------------------------------------------------------------- Links

  /** A hit by part `part` of `chain` on enemy e: roll for the next part. */
  private hitEvent(chain: Chain | null, part: number, e: Enemy): void {
    if (!chain || part >= chain.parts.length - 1) return; // the tail rolls for nothing
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
    const grant = takeTrigger(p, this.triggeredEffects >= T.links.maxTriggeredEffects);
    if (!grant) return;
    const power = triggerMult(chain.level) * (1 + grant.power) * this.build.stats.power;
    const size = 1 + grant.size;
    this.fireTrigger(chain, next, e, power, size);
  }

  /** Fire a part's trigger form from the hit point, using its L5 stats. */
  private fireTrigger(chain: Chain, part: number, src: Enemy, power: number, size: number): void {
    const id = chain.parts[part].weapon.id;
    if (id === 'pulse') {
      const P = T.weapons.pulse;
      const l5 = P.levels[5]!;
      // Directional: aim along the line from the mech through the hit point.
      let dx = src.x - this.x;
      let dz = src.z - this.z;
      const d = Math.hypot(dx, dz);
      if (d < 1e-5) {
        dx = UP.x;
        dz = UP.z;
      } else {
        dx /= d;
        dz /= d;
      }
      const n = P.trigger.bolts;
      const spread = (P.trigger.spreadDeg * Math.PI) / 180;
      for (let i = 0; i < n; i++) {
        const a = n > 1 ? -spread / 2 + (spread * i) / (n - 1) : 0;
        const c = Math.cos(a);
        const s = Math.sin(a);
        this.bolts.push({
          x: src.x,
          z: src.z,
          px: src.x,
          pz: src.z,
          dx: dx * c - dz * s,
          dz: dx * s + dz * c,
          speed: P.speed,
          travelled: 0,
          range: P.trigger.range,
          radius: P.boltRadius * size,
          damage: P.damage * l5.damageMult * power,
          pierce: l5.pierce,
          hits: [src.id],
          chain,
          part,
          triggered: true,
          alive: true,
        });
      }
    } else if (id === 'tesla') {
      const TS = T.weapons.tesla;
      const l5 = TS.levels[5]!;
      const range = TS.jumpRange * this.build.stats.area * size;
      const hit = new Set<number>([src.id]);
      const first = this.nearest(src.x, src.z, range, 1, hit)[0];
      this.triggeredArcsExpire.push(this.time + TS.arcLife);
      if (first) {
        this.teslaWalk(src.x, src.z, first, TS.trigger.jumps, 0, false, TS.damage * l5.damageMult * power, range, hit, chain, part, true);
      }
    }
  }

  private updateBolts(dt: number): void {
    const es = this.enemies;
    for (const b of this.bolts) {
      if (!b.alive) continue;
      const step = b.speed * dt;
      b.x += b.dx * step;
      b.z += b.dz * step;
      b.travelled += step;
      if (b.travelled >= b.range) {
        b.alive = false;
        continue;
      }
      const reach = b.radius + 1;
      const cands = this.cands;
      cands.length = 0;
      this.grid.query(b.x, b.z, reach, this.collect);
      if (cands.length > 1) cands.sort((i, j) => i - j);
      for (const i of cands) {
        const e = es[i];
        if (!e || !e.alive || b.hits.includes(e.id)) continue;
        const rr = b.radius + e.r;
        const dx = e.x - b.x;
        const dz = e.z - b.z;
        if (dx * dx + dz * dz >= rr * rr) continue;
        b.hits.push(e.id);
        this.damage(e, b.damage);
        this.hitEvent(b.chain, b.part, e);
        if (b.pierce-- <= 0) {
          b.alive = false;
          break;
        }
      }
    }
    // Compact
    let w = 0;
    for (let i = 0; i < this.bolts.length; i++) if (this.bolts[i].alive) this.bolts[w++] = this.bolts[i];
    this.bolts.length = w;
  }

  private updateArcs(dt: number): void {
    let w = 0;
    for (let i = 0; i < this.arcs.length; i++) {
      const a = this.arcs[i];
      a.life -= dt;
      if (a.life > 0) this.arcs[w++] = a;
    }
    this.arcs.length = w;
    const ex = this.triggeredArcsExpire;
    let k = 0;
    for (let i = 0; i < ex.length; i++) if (ex[i] > this.time) ex[k++] = ex[i];
    ex.length = k;
  }

  // ---------------------------------------------------------------- XP

  private dropCores(x: number, z: number, xp: number): void {
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
    const state: 0 | 2 = this.overflowTicks > 0 ? 2 : 0;
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
    cs.push({ x, z, px: x, pz: z, value, state });
  }

  private updateCores(dt: number): void {
    const cs = this.cores;
    const mag = this.build.stats.magnet;
    const mag2 = mag * mag;
    const pick2 = T.xp.pickupRadius * T.xp.pickupRadius;
    let w = 0;
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      const dx = this.x - c.x;
      const dz = this.z - c.z;
      const d2 = dx * dx + dz * dz;
      if (!this.dead) {
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

  addXp(v: number): void {
    this.xp += v;
    while (this.xp >= xpNext(this.level)) {
      this.xp -= xpNext(this.level);
      this.level++;
      this.pendingLevels++;
      this.events.push({ type: 'levelup' });
    }
  }

  // ---------------------------------------------------------------- drafting

  private maybeOpenDraft(): void {
    if (this.draft || this.pendingLevels <= 0 || this.dead || this.overflowTicks > 0) return;
    if (this.benchCount > 0) return; // benchmarks run uninterrupted
    const withLink = linkOptions(this.build, this.linkLevel).length > 0 && !this.lastDraftHadLink;
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

  private formLink(opt: LinkOption, order: WeaponId[]): void {
    const chain = applyLink(this.build, opt, order);
    this.hitStopTicks = Math.round(T.sim.linkHitStop * T.sim.tickRate);
    this.events.push({ type: 'link', chain: chain.parts.map((p) => p.weapon.id) });
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
        // Grant every part at the Link level, then Link them in the given order.
        for (const id of c.chain) {
          const w = findWeapon(b, id) ?? addWeapon(b, id);
          if (w) w.level = Math.max(w.level, this.linkLevel);
        }
        const [h, t, third] = c.chain;
        let opt = linkOptions(b, this.linkLevel).find(
          (o) => o.kind === 'pair' && o.orders.some((ord) => ord[0] === h && ord[1] === t),
        );
        if (!opt) break;
        this.formLink(opt, [h, t]);
        const chain = b.hardpoints.find((ch) => ch && ch.parts[0].weapon.id === h)!;
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
        if (this.surgePhase !== 'surge') this.startSurge();
        break;
      case 'spawn':
        for (let i = 0; i < c.count; i++) {
          const p = this.spawnPoint();
          this.spawnEnemy('mite', p.x, p.z, 0);
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
        while (this.surgeIndex < T.surge.schedule.length && T.surge.schedule[this.surgeIndex].time < this.time) this.surgeIndex++;
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
      this.bolts.length,
      this.cores.length,
      weapons,
      this.rng.state().join(':'),
    ].join('|');
  }
}

function clampAbs(v: number, lim: number): number {
  return v < -lim ? -lim : v > lim ? lim : v;
}

/** Decode a logged input code back to (mx, my). */
export function decodeInput(code: number): [number, number] {
  return [Math.floor(code / 3) - 1, (code % 3) - 1];
}

/** Rebuild a run from its seed and logs. */
export function replay(seed: number, inputs: number[], log: LogEvent[]): World {
  const w = new World({ seed });
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
