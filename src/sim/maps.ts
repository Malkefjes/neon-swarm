// Biomes: the Orbital Station (bounded, box and cylinder obstacles, airlock vents that
// pull enemies into clumps) and the Crystal Mining Moon (wraps around; crystals shatter
// into shrapnel whose hits count for triggers).
import { TUNING, type BiomeId } from '../tuning';
import { len2 } from './math';
import { Rng } from './rng';
import type { Crystal, Obstacle, Src, Vent } from './types';
import type { World } from './world';

const T = TUNING;
const ST = T.maps.station;
const MO = T.maps.moon;

export interface MapLayout {
  obstacles: Obstacle[];
  vents: Vent[];
  crystals: Crystal[];
}

/** Fixed layouts (the same every run), so a biome is learnable. */
export function buildLayout(biome: BiomeId): MapLayout {
  return biome === 'station' ? station() : moon();
}

function station(): MapLayout {
  const rng = new Rng(ST.layoutSeed);
  const vents: Vent[] = [];
  for (let i = 0; i < ST.vents; i++) {
    const a = (i / ST.vents) * Math.PI * 2 + 0.3;
    const r = i % 2 ? 35 : 65;
    vents.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, phase: (i / ST.vents) * ST.ventPeriod, active: false });
  }
  // Keep-out circles: the start area, vents, and placed obstacles (with the escape-lane gap)
  const taken: { x: number; z: number; r: number }[] = [{ x: 0, z: 0, r: ST.clearRadius }];
  for (const v of vents) taken.push({ x: v.x, z: v.z, r: 4 });
  const obstacles: Obstacle[] = [];
  const lim = T.arena.halfSize - 8;
  for (let tries = 0; obstacles.length < ST.obstacles && tries < 2000; tries++) {
    const box = rng.chance(0.6);
    const hx = box ? rng.range(ST.boxMin, ST.boxMax) / 2 : rng.range(ST.cylMin, ST.cylMax);
    const hz = box ? rng.range(ST.boxMin, ST.boxMax) / 2 : hx;
    const x = rng.range(-lim, lim);
    const z = rng.range(-lim, lim);
    const r = Math.hypot(hx, hz);
    if (taken.some((t) => len2(t.x - x, t.z - z) < t.r + r + ST.gap)) continue;
    obstacles.push({ kind: box ? 'box' : 'cyl', x, z, hx, hz });
    taken.push({ x, z, r });
  }
  return { obstacles, vents, crystals: [] };
}

function moon(): MapLayout {
  const rng = new Rng(MO.layoutSeed);
  const half = MO.size / 2;
  const crystals: Crystal[] = [];
  for (let tries = 0; crystals.length < MO.crystals && tries < 3000; tries++) {
    const x = rng.range(-half, half);
    const z = rng.range(-half, half);
    if (len2(x, z) < 8) continue;
    if (crystals.some((c) => len2(wrapD(c.x - x), wrapD(c.z - z)) < 7)) continue;
    crystals.push({ x, z, r: MO.crystalRadius, regrow: 0 });
  }
  return { obstacles: [], vents: [], crystals };
}

/** Shortest signed offset on the Moon's wrapped axis. */
export function wrapD(d: number): number {
  const s = MO.size;
  return d - s * Math.round(d / s);
}

/** Coarse buckets of obstacles so collision checks only look at nearby ones. */
const BUCKET = 16;
const bucketCache = new WeakMap<Obstacle[], Map<number, Obstacle[]>>();
function bucketKey(cx: number, cz: number): number {
  return (cx + 64) * 1024 + (cz + 64);
}
function buckets(list: Obstacle[]): Map<number, Obstacle[]> {
  let m = bucketCache.get(list);
  if (m) return m;
  m = new Map();
  for (const o of list) {
    const ext = Math.max(o.hx, o.hz) + 3; // + the largest grid enemy radius and some
    for (let cx = Math.floor((o.x - ext) / BUCKET); cx <= Math.floor((o.x + ext) / BUCKET); cx++) {
      for (let cz = Math.floor((o.z - ext) / BUCKET); cz <= Math.floor((o.z + ext) / BUCKET); cz++) {
        const k = bucketKey(cx, cz);
        let arr = m.get(k);
        if (!arr) m.set(k, (arr = []));
        arr.push(o);
      }
    }
  }
  bucketCache.set(list, m);
  return m;
}

/** Push a circle out of every obstacle it overlaps. Returns true if it moved. */
export function pushOut(w: World, p: { x: number; z: number }, r: number): boolean {
  if (!w.obstacles.length) return false;
  const near = r > 2.5 ? w.obstacles : buckets(w.obstacles).get(bucketKey(Math.floor(p.x / BUCKET), Math.floor(p.z / BUCKET)));
  if (!near) return false;
  let moved = false;
  for (const o of near) {
    if (o.kind === 'cyl') {
      const dx = p.x - o.x;
      const dz = p.z - o.z;
      const d = len2(dx, dz);
      const min = o.hx + r;
      if (d >= min) continue;
      const k = d > 1e-6 ? min / d : 0;
      p.x = d > 1e-6 ? o.x + dx * k : o.x + min;
      p.z = d > 1e-6 ? o.z + dz * k : o.z;
      moved = true;
    } else {
      const cx = Math.max(o.x - o.hx, Math.min(p.x, o.x + o.hx));
      const cz = Math.max(o.z - o.hz, Math.min(p.z, o.z + o.hz));
      const dx = p.x - cx;
      const dz = p.z - cz;
      const d = len2(dx, dz);
      if (d >= r) continue;
      if (d > 1e-6) {
        p.x = cx + (dx / d) * r;
        p.z = cz + (dz / d) * r;
      } else {
        // Centre inside the box: leave by the nearest face
        const ex = o.hx - Math.abs(p.x - o.x);
        const ez = o.hz - Math.abs(p.z - o.z);
        if (ex < ez) p.x = o.x + Math.sign(p.x - o.x || 1) * (o.hx + r);
        else p.z = o.z + Math.sign(p.z - o.z || 1) * (o.hz + r);
      }
      moved = true;
    }
  }
  return moved;
}

/** Station vents: while active, pull nearby enemies toward the vent. */
export function updateVents(w: World, dt: number): void {
  if (!w.vents.length) return;
  for (const v of w.vents) {
    v.active = (w.time + v.phase) % ST.ventPeriod < ST.ventActive;
    if (!v.active) continue;
    w.near(v.x, v.z, ST.ventRadius, (e) => {
      if (e.boss) return;
      const dx = v.x - e.x;
      const dz = v.z - e.z;
      const d = len2(dx, dz);
      if (d > ST.ventRadius || d < 0.3) return;
      const step = Math.min(d - 0.3, ST.ventPull * dt);
      e.x += (dx / d) * step;
      e.z += (dz / d) * step;
    });
  }
}

/**
 * Moon: keep the mech near the origin by shifting the whole world in fixed steps, and
 * wrap everything to within half a map of the mech. Every interaction happens near the
 * mech, so plain distances stay correct.
 */
export function recentre(w: World): void {
  if (w.biome !== 'moon') return;
  const step = MO.recentre;
  const sx = Math.abs(w.x) > step ? step * Math.trunc(w.x / step) : 0;
  const sz = Math.abs(w.z) > step ? step * Math.trunc(w.z / step) : 0;
  if (sx || sz) shiftWorld(w, -sx, -sz);
  const half = MO.size / 2;
  const wrap = (p: { x: number; z: number }, extra?: { x: string; z: string }[]) => {
    let ox = 0;
    let oz = 0;
    if (p.x - w.x > half) ox = -MO.size;
    else if (p.x - w.x < -half) ox = MO.size;
    if (p.z - w.z > half) oz = -MO.size;
    else if (p.z - w.z < -half) oz = MO.size;
    if (!ox && !oz) return;
    const r = p as unknown as Record<string, number>;
    r.x += ox;
    r.z += oz;
    for (const k of extra ?? []) {
      r[k.x] += ox;
      r[k.z] += oz;
    }
  };
  const PX = [{ x: 'px', z: 'pz' }];
  for (const e of w.enemies) wrap(e, PX);
  for (const c of w.cores) wrap(c, PX);
  for (const p of w.pickups) wrap(p);
  for (const c of w.crystals) wrap(c);
  for (const m of w.mines) wrap(m);
}

function shiftWorld(w: World, dx: number, dz: number): void {
  const mv = (p: Record<string, number>, keys: [string, string][]) => {
    for (const [a, b] of keys) {
      p[a] += dx;
      p[b] += dz;
    }
  };
  const XZ: [string, string][] = [['x', 'z']];
  const XZP: [string, string][] = [
    ['x', 'z'],
    ['px', 'pz'],
  ];
  const any = (o: object) => o as unknown as Record<string, number>;
  mv(any(w), [
    ['x', 'z'],
    ['px', 'pz'],
    ['camX', 'camZ'],
    ['pcamX', 'pcamZ'],
    ['arenaCX', 'arenaCZ'],
  ]);
  for (const e of w.enemies) mv(any(e), XZP);
  for (const b of w.bolts) mv(any(b), XZP);
  for (const m of w.missiles) mv(any(m), XZP);
  for (const c of w.cores) mv(any(c), XZP);
  for (const h of w.hazards) mv(any(h), XZP);
  for (const s of w.shells) mv(any(s), [
    ['x0', 'z0'],
    ['x1', 'z1'],
  ]);
  for (const z of w.zones) mv(any(z), XZ);
  for (const b of w.orbitBlades) mv(any(b), [
    ['cx', 'cz'],
    ['x', 'z'],
  ]);
  for (const b of w.soloBlades) mv(any(b), XZ);
  for (const a of w.arcs) mv(any(a), [
    ['x1', 'z1'],
    ['x2', 'z2'],
  ]);
  for (const r of w.rails) mv(any(r), [
    ['x1', 'z1'],
    ['x2', 'z2'],
  ]);
  for (const r of w.rings) mv(any(r), XZ);
  for (const p of w.pickups) mv(any(p), XZ);
  for (const m of w.mines) mv(any(m), XZ);
  for (const s of w.singularities) mv(any(s), XZ);
  for (const f of w.freezes) mv(any(f), XZ);
  for (const c of w.cones) mv(any(c), XZ);
  for (const c of w.crystals) mv(any(c), XZ);
  for (const d of w.delayed) mv(any(d.from), XZ);
  w.shiftX += dx;
  w.shiftZ += dz;
}

/** Moon crystals: any weapon effect touching one shatters it into shrapnel. */
export function hitCrystals(w: World, x: number, z: number, r: number, src: Src): void {
  if (!w.crystals.length) return;
  for (const c of w.crystals) {
    if (c.regrow > 0) continue;
    const dx = c.x - x;
    const dz = c.z - z;
    const rr = c.r + r;
    if (dx * dx + dz * dz > rr * rr) continue;
    shatter(w, c, src);
  }
}

/** Along a line segment (rails). */
export function hitCrystalsOnLine(w: World, x1: number, z1: number, x2: number, z2: number, width: number, src: Src): void {
  if (!w.crystals.length) return;
  const lx = x2 - x1;
  const lz = z2 - z1;
  const l2 = lx * lx + lz * lz || 1;
  for (const c of w.crystals) {
    if (c.regrow > 0) continue;
    const t = Math.max(0, Math.min(1, ((c.x - x1) * lx + (c.z - z1) * lz) / l2));
    if (len2(c.x - (x1 + lx * t), c.z - (z1 + lz * t)) <= c.r + width / 2) shatter(w, c, src);
  }
}

function shatter(w: World, c: Crystal, src: Src): void {
  c.regrow = MO.regrow;
  w.events.push({ type: 'shatter', x: c.x, z: c.z });
  const n = MO.shards;
  const off = w.rng.next() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const a = off + (i / n) * Math.PI * 2;
    // Each shard hits like the effect that shattered the crystal: its hits roll for the next part
    w.bolts.push({
      x: c.x,
      z: c.z,
      px: c.x,
      pz: c.z,
      dx: Math.cos(a),
      dz: Math.sin(a),
      speed: MO.shardSpeed,
      travelled: 0,
      range: MO.shardRange,
      radius: 0.25,
      damage: MO.shardDamage * w.build.stats.power,
      pierce: 0,
      hits: [],
      src,
      alive: true,
      shard: true,
    });
  }
}

export function updateCrystals(w: World, dt: number): void {
  for (const c of w.crystals) if (c.regrow > 0) c.regrow = Math.max(0, c.regrow - dt);
}
