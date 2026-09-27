// The director: threat budget spawning, forced elites, and the authored Surge schedule.
import { len2 } from './math';
import { TUNING, type EnemyKind, type Formation, type UnitEnemy, type UnitKind } from '../tuning';
import { onScreenTarget, surgeSize, threatPerSecond } from './formulas';
import type { Enemy } from './types';
import { HALF_H, HALF_W, toGround } from './view';
import type { World } from './world';

const T = TUNING;
const SU = T.surge;

const IMPLEMENTED: Record<UnitKind, UnitEnemy | null> = {
  mite: 'mite',
  skitter: 'skitter',
  carapace: 'carapace',
  spitter: 'spitter',
  splitter: 'splitter',
};

export function direct(w: World, dt: number): void {
  // Kill window for Surge sizing
  while (w.killHead < w.killTimes.length && w.killTimes[w.killHead] < w.time - 60) w.killHead++;
  if (w.killHead > 4096) {
    w.killTimes = w.killTimes.slice(w.killHead);
    w.killHead = 0;
  }
  if (w.benchCount > 0) {
    maintainBench(w);
    return;
  }
  if (!w.directorOn || w.dead || w.won) return;

  schedule(w);

  // Forced elites (Threat 2: every 45 s)
  if (w.time >= w.nextElite) {
    w.nextElite += w.threat >= 2 ? T.threat.eliteEvery : T.elite.every;
    spawnElite(w);
  }

  if (w.surgePhase === 'breath') return; // spawns pause during Breath
  const tMin = w.tMin;
  const overmind = w.bosses.some((b) => b.kind === 'overmind');
  const income = threatPerSecond(tMin) * (overmind ? T.bosses.overmind.spawnBudget : 1);
  w.budget = Math.min(w.budget + income * dt, income * T.director.maxBankedSeconds);
  const target = onScreenTarget(tMin) * (overmind ? T.bosses.overmind.spawnBudget : 1);
  let guard = 0;
  while (w.enemies.length < target && w.enemies.length < T.sim.maxEnemies && guard++ < 50) {
    const kind = pickUnit(w);
    const cost = T.enemies[kind].cost;
    if (w.budget < cost) break;
    w.budget -= cost;
    const p = spawnPoint(w);
    w.spawnEnemy(kind, p.x, p.z, 0);
  }
}

function currentMix(w: World): Record<UnitKind, number> {
  let mix = T.director.mix[0].weights;
  for (const m of T.director.mix) if (w.time >= m.from) mix = m.weights;
  // Threat 5: Spitters from 0:00
  if (w.threat >= 5 && mix.spitter === 0) mix = { ...mix, spitter: T.threat.spitterWeight };
  return mix;
}

/** A unit kind drawn from the current window's weights (unimplemented kinds dropped). */
export function pickUnit(w: World, weights: Partial<Record<UnitKind, number>> = currentMix(w)): UnitEnemy {
  let total = 0;
  for (const k of Object.keys(weights) as UnitKind[]) if (IMPLEMENTED[k]) total += weights[k] ?? 0;
  if (total <= 0) return 'mite';
  let r = w.rng.next() * total;
  for (const k of Object.keys(weights) as UnitKind[]) {
    const kind = IMPLEMENTED[k];
    if (!kind) continue;
    r -= weights[k] ?? 0;
    if (r < 0) return kind;
  }
  return 'mite';
}

function spawnElite(w: World, near?: { x: number; z: number }): Enemy | null {
  const kind = pickUnit(w);
  const affix: 1 | 2 = w.rng.chance(0.5) ? 1 : 2;
  let p = near ?? spawnPoint(w);
  if (near) {
    const a = w.rng.next() * Math.PI * 2;
    p = { x: near.x + Math.cos(a) * 6, z: near.z + Math.sin(a) * 6 };
    w.clampToArena(p, 3);
  }
  const e = w.spawnEnemy(kind, p.x, p.z, 0, affix);
  if (e) w.events.push({ type: 'elite' });
  return e;
}

export function devElite(w: World): void {
  spawnElite(w);
}

// ------------------------------------------------------------------ Surges

function schedule(w: World): void {
  const next = SU.schedule[w.surgeIndex];
  if (next) {
    // A living Brood Mother doesn't hold back the next Surge
    if ((w.surgePhase === 'build' || w.surgePhase === 'boss') && w.time >= next.time - SU.breath) {
      w.surgePhase = 'breath';
      w.events.push({ type: 'breath', boss: next.formation === 'brood' });
    }
    if (w.surgePhase === 'breath' && w.time >= next.time) {
      w.surgeIndex++;
      startSurge(w, next.formation, w.surgeIndex);
    }
    return;
  }
  if (!w.overmindSpawned) {
    if (!w.overmindBreath && w.time >= SU.overmindAt - SU.breath) {
      w.overmindBreath = true;
      if (w.surgePhase === 'build') w.surgePhase = 'breath';
      w.events.push({ type: 'breath', boss: true });
    }
    if (w.time >= SU.overmindAt) spawnOvermind(w);
    return;
  }
  // Endless: Surges keep coming every 90 s, cycling the formations
  if (w.endless) {
    const E = T.endless;
    const k = Math.floor((w.time - E.firstAfter) / E.surgeEvery);
    if (k < 0) return;
    const at = E.firstAfter + k * E.surgeEvery;
    const n = SU.schedule.length + 1 + k;
    if (w.surgeCount >= n) return;
    if (w.surgePhase !== 'surge' && w.surgePhase !== 'breath' && w.time >= at - SU.breath && w.time < at) {
      w.surgePhase = 'breath';
      w.events.push({ type: 'breath', boss: false });
    }
    if (w.time >= at && w.surgePhase !== 'surge') startSurge(w, E.formations[k % E.formations.length], n);
  }
}

/** The Overmind: the arena centre on the Station; 20 u from the mech on the wrap-around Moon. */
function spawnOvermind(w: World): void {
  w.overmindSpawned = true;
  w.surgePhase = 'boss';
  let x = 0;
  let z = 0;
  if (w.biome === 'moon') {
    const a = w.rng.next() * Math.PI * 2;
    x = w.x + Math.cos(a) * 20;
    z = w.z + Math.sin(a) * 20;
  }
  const e = w.spawnEnemy('overmind', x, z, 0);
  if (e) w.events.push({ type: 'boss', kind: 'overmind' });
}

function killsLast60(w: World): number {
  return w.killTimes.length - w.killHead;
}

/** Start Surge slot n (1-based) with a formation. */
export function startSurge(w: World, formation: Formation, n: number): void {
  w.surgeCount = Math.max(w.surgeCount, n);
  if (formation === 'brood') {
    w.surgePhase = 'boss';
    const a = w.rng.next() * Math.PI * 2;
    const p = { x: w.x + Math.cos(a) * 16, z: w.z + Math.sin(a) * 16 };
    w.clampToArena(p, 3);
    const e = w.spawnEnemy('brood', p.x, p.z, 0);
    if (e) w.events.push({ type: 'boss', kind: 'brood' });
    return;
  }
  const size = Math.round(surgeSize(n, killsLast60(w), w.tMin) * w.surgeSizeMult * (w.threat >= 3 ? 1 + T.threat.surgeSize : 1));
  w.surgeId++;
  w.surgePhase = 'surge';
  w.surgeKilled = 0;
  w.surgeStart = w.time;
  const room = T.sim.maxEnemies - w.enemies.length;
  const units = formationUnits(w, formation, Math.min(size, room));
  // Threat 9: every Surge includes Carapaces
  if (w.threat >= 9) {
    const every = Math.round(1 / T.threat.surgeCarapace);
    units.forEach((u, i) => {
      if (i % every === every - 1) u.kind = 'carapace';
    });
  }
  for (const u of units) {
    const p = { x: u.x, z: u.z };
    w.clampToArena(p, 1);
    const e = w.spawnEnemy(u.kind, p.x, p.z, w.surgeId);
    if (e && u.march) {
      e.marchX = u.march.x;
      e.marchZ = u.march.z;
      e.marchLeft = SU.wallMarch;
    }
  }
  w.surgeSize = units.length;
  w.events.push({ type: 'surge', n, size: units.length });
}

export function onSurgeUnitKilled(w: World, e: Enemy): void {
  if (w.surgePhase !== 'surge' || e.surge !== w.surgeId) return;
  w.surgeKilled++;
  if (w.surgeKilled < Math.ceil(w.surgeSize * SU.breakFraction)) return;
  // Broken: Overflow
  w.surgePhase = 'build';
  const t = w.time - w.surgeStart;
  w.lastBreakTime = t;
  w.breakTimes.push(t);
  w.surgeSizeMult = t > SU.slowSurgeTime ? SU.slowSurgeMult : 1;
  if (t < 8) w.addFeat('fastSurge');
  w.surgeId++; // survivors keep an id that no longer counts
  w.pullAllCores();
  if (!w.dead && w.threat < 7) w.hull = Math.min(w.build.maxHull, w.hull + T.overflow.heal); // Threat 7: no heal
  w.overflowTicks = Math.round(T.overflow.slowTime * T.sim.tickRate);
  w.events.push({ type: 'overflow', n: w.surgeCount, breakTime: t });
}

export function devSurge(w: World, n?: number): void {
  if (w.surgePhase === 'surge') return;
  const slot = n ?? Math.max(1, w.surgeCount + 1);
  const entry = SU.schedule[Math.min(SU.schedule.length, slot) - 1];
  startSurge(w, entry.formation === 'brood' ? 'ring' : entry.formation, slot);
}

export function devBoss(w: World, kind: 'brood' | 'overmind'): void {
  if (kind === 'brood') startSurge(w, 'brood', 5);
  else if (!w.bosses.some((b) => b.kind === 'overmind')) spawnOvermind(w);
}

interface Placement {
  kind: EnemyKind;
  x: number;
  z: number;
  march?: { x: number; z: number };
}

type Mix = Partial<Record<UnitKind, number>>;

function formationUnits(w: World, f: Formation, size: number): Placement[] {
  const out: Placement[] = [];
  const a = w.rng.next() * Math.PI * 2;
  const dir = { x: Math.cos(a), z: Math.sin(a) }; // a wall or tide moves along dir, arriving from -dir
  switch (f) {
    case 'ring':
      ring(w, out, size, SU.ringRadius, { mite: 1 });
      break;
    case 'wall':
      wall(w, out, size, dir, { mite: 70, skitter: 30 });
      break;
    case 'tide':
      tide(w, out, size, dir, SU.tideDistance, { mite: 90, carapace: 10 });
      break;
    case 'ringCarapace': {
      // Carapace outer ring, Mites inside
      const carapaces = Math.round(size * 0.15);
      ring(w, out, size - carapaces, SU.ringRadius - 1.5, { mite: 1 });
      const inner = out.reduce((m, p) => Math.max(m, len2(p.x - w.x, p.z - w.z)), 0);
      ring(w, out, carapaces, inner + 2, { carapace: 1 }, 2);
      break;
    }
    case 'twoWalls': {
      const half = Math.floor(size / 2);
      wall(w, out, half, dir, { skitter: 50, splitter: 50 });
      wall(w, out, size - half, { x: -dir.x, z: -dir.z }, { skitter: 50, splitter: 50 });
      break;
    }
    case 'mixed7': {
      // Carapace front line, Spitters behind, Mite tide
      const front = Math.round(size * 0.15);
      const spitters = Math.round(size * 0.15);
      wall(w, out, front, dir, { carapace: 1 }, 2);
      wall(w, out, spitters, dir, { spitter: 1 }, 1.6, 3);
      tide(w, out, size - front - spitters, dir, SU.tideDistance + 7, { mite: 1 });
      break;
    }
    case 'doubleRing': {
      const inner = Math.round(size * 0.3);
      ring(w, out, inner, SU.ringRadius - 2, { splitter: 1 }, 1.4);
      const r = out.reduce((m, p) => Math.max(m, len2(p.x - w.x, p.z - w.z)), 0);
      ring(w, out, size - inner, r + 2, { mite: 1 });
      break;
    }
    case 'mixed9': {
      // Wall plus closing Ring, every unit type
      const half = Math.floor(size / 2);
      const every: Mix = { mite: 40, skitter: 20, carapace: 15, spitter: 10, splitter: 15 };
      wall(w, out, half, dir, every);
      ring(w, out, size - half, SU.ringRadius, every);
      break;
    }
    case 'brood':
      break;
  }
  return out;
}

function ring(w: World, out: Placement[], count: number, startRadius: number, mix: Mix, spacingMult = 1): void {
  let placed = 0;
  let radius = startRadius;
  const spacing = SU.ringSpacing * spacingMult;
  while (placed < count) {
    const perRow = Math.max(8, Math.floor((2 * Math.PI * radius) / spacing));
    const n = Math.min(perRow, count - placed);
    const offset = w.rng.next() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const a = offset + (i / n) * Math.PI * 2;
      out.push({ kind: pickUnit(w, mix), x: w.x + Math.cos(a) * radius, z: w.z + Math.sin(a) * radius });
    }
    placed += n;
    radius += spacing;
  }
}

/** A thick line starting off-screen on the -dir side, sweeping along dir. */
function wall(w: World, out: Placement[], count: number, dir: { x: number; z: number }, mix: Mix, spacingMult = 1, extraBack = 0): void {
  const spacing = SU.wallSpacing * spacingMult;
  const perRow = Math.max(4, Math.floor(SU.wallLength / spacing));
  const px = -dir.z;
  const pz = dir.x;
  let row = 0;
  let placed = 0;
  while (placed < count) {
    const n = Math.min(perRow, count - placed);
    const back = SU.wallDistance + extraBack + row * spacing;
    for (let i = 0; i < n; i++) {
      const s = (i - (n - 1) / 2) * spacing;
      out.push({
        kind: pickUnit(w, mix),
        x: w.x - dir.x * back + px * s,
        z: w.z - dir.z * back + pz * s,
        march: dir,
      });
    }
    placed += n;
    row++;
  }
}

/** A dense mass off-screen on the -dir side that hunts the mech. */
function tide(w: World, out: Placement[], count: number, dir: { x: number; z: number }, distance: number, mix: Mix): void {
  const cx = w.x - dir.x * (distance + Math.sqrt(count) * 0.35);
  const cz = w.z - dir.z * (distance + Math.sqrt(count) * 0.35);
  // Sunflower packing in a disc
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const r = Math.sqrt(i + 0.5) * 0.5;
    const a = i * golden;
    out.push({ kind: pickUnit(w, mix), x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r });
  }
}

// ------------------------------------------------------------------ spawn points

/** A point 2-4 u beyond the edge of the nominal camera view, inside the arena. */
export function spawnPoint(w: World): { x: number; z: number } {
  const lim = T.arena.halfSize - 1;
  let best = { x: 0, z: 0 };
  for (let attempt = 0; attempt < 4; attempt++) {
    const m = w.rng.range(T.director.spawnMarginMin, T.director.spawnMarginMax);
    const hw = HALF_W + m;
    const hh = HALF_H + m;
    const r = w.rng.next() * (4 * hw + 4 * hh);
    let sx: number;
    let sy: number;
    if (r < 2 * hw) {
      sx = r - hw;
      sy = hh;
    } else if (r < 4 * hw) {
      sx = r - 3 * hw;
      sy = -hh;
    } else if (r < 4 * hw + 2 * hh) {
      sx = hw;
      sy = r - 4 * hw - hh;
    } else {
      sx = -hw;
      sy = r - 4 * hw - 3 * hh;
    }
    const g = toGround(sx, sy);
    best = { x: w.camX + g.dx, z: w.camZ + g.dz };
    const inCircle = w.arenaRadius === Infinity || len2(best.x, best.z) < w.arenaRadius - 1;
    if (Math.abs(best.x) <= lim && Math.abs(best.z) <= lim && inCircle) return best;
  }
  w.clampToArena(best, 1);
  return best;
}

function maintainBench(w: World): void {
  while (w.enemies.length < w.benchCount) {
    const a = w.rng.next() * Math.PI * 2;
    const r = w.rng.range(3, 14);
    const p = { x: w.x + Math.cos(a) * r, z: w.z + Math.sin(a) * r };
    w.clampToArena(p, 1);
    // Mixed benches cycle through every unit kind, to check silhouettes in a crowd
    const kinds = ['mite', 'skitter', 'carapace', 'spitter', 'splitter'] as const;
    w.spawnEnemy(w.benchMixed ? kinds[w.enemies.length % kinds.length] : 'mite', p.x, p.z, 0);
  }
}

