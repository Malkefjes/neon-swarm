// Weapons: solo fire for chain heads, trigger forms for Linked parts, and the
// effects they leave in the world. Hit events follow Link rules §1:
//   projectile (Pulse, Seeker)          one roll per enemy hit
//   chain (Tesla)                       one roll per jump
//   area pulse (Arc ring, Mortar shell) up to 3 rolls on random enemies hit
//   continuous (Blades, pools, fields)  one roll per enemy per 0.5 s of contact
import { len2 } from './math';
import { TUNING, type WeaponId } from '../tuning';
import type { Chain } from './build';
import type { Enemy, Src } from './types';
import { UP } from './view';
import type { World } from './world';

const T = TUNING;
const W = T.weapons;

function makeSrc(chain: Chain, part: number, triggered: boolean, pair: string | null): Src {
  return { chain, part, weapon: chain.parts[part].weapon.id, triggered, pair };
}

// ------------------------------------------------------------------ solo fire

/** Auto-aim: a boss in range takes the first shot, then the nearest enemies. */
function targets(w: World, range: number, k: number): Enemy[] {
  const near = w.nearest(w.x, w.z, range, k);
  for (const b of w.bosses) {
    if (!b.alive) continue;
    if (len2(b.x - w.x, b.z - w.z) - b.r > range) continue;
    const i = near.indexOf(b);
    if (i > 0) near.splice(i, 1);
    if (i !== 0) {
      near.unshift(b);
      if (near.length > k) near.pop();
    }
    break;
  }
  return near;
}

/** Heads fire on their own; linked-in parts only fire through triggers. */
export function fireHeads(w: World, dt: number): void {
  const stats = w.build.stats;
  w.soloBlades.length = 0;
  for (const chain of w.build.hardpoints) {
    if (!chain) continue;
    const head = chain.parts[0].weapon;
    if (head.id === 'blades') {
      soloBlades(w, chain, dt);
      continue;
    }
    head.cooldown -= dt;
    if (head.cooldown > 0) continue;
    const src = makeSrc(chain, 0, false, null);
    let fired = false;
    switch (head.id) {
      case 'pulse':
        fired = firePulse(w, src, head.level);
        break;
      case 'arc':
        fired = fireArc(w, src, head.level);
        break;
      case 'tesla':
        fired = fireTesla(w, src, head.level);
        break;
      case 'seeker':
        fired = fireSeeker(w, src, head.level);
        break;
      case 'mortar':
        fired = fireMortar(w, src, head.level);
        break;
    }
    head.cooldown = fired ? cooldownOf(head.id, head.level) / stats.rate : 0;
  }
}

function cooldownOf(id: WeaponId, level: number): number {
  switch (id) {
    case 'pulse':
      return W.pulse.levels[level]!.cooldown;
    case 'arc':
      return W.arc.levels[level]!.cooldown;
    case 'tesla':
      return W.tesla.cooldown;
    case 'seeker':
      return W.seeker.cooldown;
    case 'mortar':
      return W.mortar.levels[level]!.cooldown;
    default:
      return 1;
  }
}

function firePulse(w: World, src: Src, level: number): boolean {
  const P = W.pulse;
  const lv = P.levels[level]!;
  const aim = targets(w, P.acquireRange, lv.bolts);
  if (!aim.length) return false;
  const damage = P.damage * lv.damageMult * w.build.stats.power;
  for (let i = 0; i < lv.bolts; i++) {
    const t = aim[i % aim.length];
    let dx = t.x - w.x;
    let dz = t.z - w.z;
    const d = len2(dx, dz) || 1;
    dx /= d;
    dz /= d;
    if (i >= aim.length) {
      // More bolts than targets: fan the extras around the nearest
      const a = (((i - aim.length + 1) * 8 * Math.PI) / 180) * (i % 2 ? 1 : -1);
      const c = Math.cos(a);
      const s = Math.sin(a);
      const rx = dx * c - dz * s;
      dz = dx * s + dz * c;
      dx = rx;
    }
    pushBolt(w, w.x, w.z, dx, dz, P.range, P.boltRadius * w.build.stats.area, damage, lv.pierce, src, []);
  }
  return true;
}

function pushBolt(w: World, x: number, z: number, dx: number, dz: number, range: number, radius: number, damage: number, pierce: number, src: Src, hits: number[]): void {
  w.bolts.push({ x, z, px: x, pz: z, dx, dz, speed: W.pulse.speed, travelled: 0, range, radius, damage, pierce, hits, src, alive: true });
}

function fireArc(w: World, src: Src, level: number): boolean {
  const A = W.arc;
  const lv = A.levels[level]!;
  const radius = lv.radius * w.build.stats.area;
  const hit = w.inDisc(w.x, w.z, radius);
  if (!hit.length) return false;
  arcPulse(w, w.x, w.z, radius, A.damage * lv.damageMult * w.build.stats.power, src, hit);
  if (lv.field) {
    const F = A.field;
    pushZone(w, w.x, w.z, radius, F.damage * w.build.stats.power, F.tick, F.duration, src);
  }
  return true;
}

function arcPulse(w: World, x: number, z: number, radius: number, damage: number, src: Src, hit: Enemy[]): void {
  for (const e of hit) w.damage(e, damage, src, x, z);
  w.rings.push({ x, z, r: radius, life: W.arc.ringLife, maxLife: W.arc.ringLife, weapon: src.weapon, triggered: src.triggered });
  if (src.triggered) w.triggeredInstant.push(w.time + W.arc.ringLife);
  w.areaHits(src, hit);
}

function pushZone(w: World, x: number, z: number, r: number, damage: number, tick: number, life: number, src: Src): void {
  w.zones.push({ x, z, r, damage, tick, nextTick: w.time, life, maxLife: life, born: w.time, src, alive: true });
}

function fireTesla(w: World, src: Src, level: number): boolean {
  const TS = W.tesla;
  const lv = TS.levels[level]!;
  const firsts = targets(w, TS.acquireRange, lv.chains);
  if (!firsts.length) return false;
  const hit = new Set<number>();
  const damage = TS.damage * lv.damageMult * w.build.stats.power;
  const range = TS.jumpRange * w.build.stats.area;
  for (const first of firsts) {
    if (hit.has(first.id)) continue;
    teslaWalk(w, w.x, w.z, first, lv.jumps, 0, lv.fork, damage, range, hit, src);
  }
  return true;
}

/** Walk a Tesla chain: each jump hits one new enemy and is one hit event. */
function teslaWalk(w: World, fromX: number, fromZ: number, first: Enemy, jumps: number, hitNo: number, fork: boolean, damage: number, range: number, hit: Set<number>, src: Src): void {
  let cx = fromX;
  let cz = fromZ;
  let e: Enemy | null = first;
  let left = jumps;
  let n = hitNo;
  while (e && left > 0) {
    hit.add(e.id);
    w.arcs.push({ x1: cx, z1: cz, x2: e.x, z2: e.z, life: W.tesla.arcLife, maxLife: W.tesla.arcLife, weapon: 'tesla', triggered: src.triggered });
    w.damage(e, damage, src, cx, cz);
    w.hit(src, e);
    left--;
    n++;
    cx = e.x;
    cz = e.z;
    if (fork && n === W.tesla.forkAtJump && left > 0) {
      for (let b = 0; b < 2; b++) {
        const nb = w.nearestOne(cx, cz, range, hit);
        if (nb) teslaWalk(w, cx, cz, nb, left, n, false, damage, range, hit, src);
      }
      return;
    }
    e = w.nearestOne(cx, cz, range, hit);
  }
}

function fireSeeker(w: World, src: Src, level: number): boolean {
  const S = W.seeker;
  const lv = S.levels[level]!;
  const aim = targets(w, S.acquireRange, lv.missiles);
  if (!aim.length) return false;
  const damage = S.damage * lv.damageMult * w.build.stats.power;
  const blast = lv.blast * w.build.stats.area;
  for (let i = 0; i < lv.missiles; i++) {
    const t = aim[i % aim.length];
    // Launch fanned out, then home in
    const base = Math.atan2(t.z - w.z, t.x - w.x);
    const spread = lv.missiles > 1 ? -1 + (2 * i) / (lv.missiles - 1) : 0;
    const a = base + spread * 1.1;
    pushMissile(w, w.x, w.z, Math.cos(a), Math.sin(a), t, damage, blast, -1, src);
  }
  return true;
}

function pushMissile(w: World, x: number, z: number, dx: number, dz: number, target: Enemy | null, damage: number, blast: number, exclude: number, src: Src): void {
  w.missiles.push({ x, z, px: x, pz: z, dx, dz, target, targetId: target ? target.id : -1, life: W.seeker.life, damage, blast, exclude, src, alive: true });
}

function fireMortar(w: World, src: Src, level: number): boolean {
  const M = W.mortar;
  const lv = M.levels[level]!;
  const cands = targets(w, M.acquireRange, 16);
  if (!cands.length) return false;
  const area = w.build.stats.area;
  for (let i = 0; i < lv.shells; i++) {
    // The first shell goes to a boss in range; the rest land on random nearby enemies
    const t = i === 0 && cands[0].boss ? cands[0] : cands[w.rng.int(cands.length)];
    w.shells.push({
      x0: w.x,
      z0: w.z,
      x1: t.x,
      z1: t.z,
      t: 0,
      flight: M.flight,
      damage: M.shellDamage * lv.damageMult * w.build.stats.power,
      blast: lv.blast * area,
      poolDamage: M.poolDamage * lv.damageMult * w.build.stats.power,
      poolRadius: lv.blast * M.poolRadiusScale * area,
      poolLife: lv.pool,
      src,
      alive: true,
    });
  }
  return true;
}

function soloBlades(w: World, chain: Chain, dt: number): void {
  const B = W.blades;
  const head = chain.parts[0].weapon;
  const lv = B.levels[head.level]!;
  const stats = w.build.stats;
  w.bladeAngle += B.spin * lv.spinMult * stats.rate * dt;
  const orbit = lv.orbit * stats.area;
  const radius = B.radius * stats.area;
  const damage = B.damage * lv.damageMult * stats.power;
  const src = makeSrc(chain, 0, false, null);
  const hits = w.soloBladeHits;
  for (let i = 0; i < lv.blades; i++) {
    const a = w.bladeAngle + (i / lv.blades) * Math.PI * 2;
    const x = w.x + Math.cos(a) * orbit;
    const z = w.z + Math.sin(a) * orbit;
    w.soloBlades.push({ x, z, weapon: 'blades' });
    for (const e of w.inDisc(x, z, radius)) {
      const last = hits.get(e.id);
      if (last !== undefined && w.time - last < B.hitCooldown) continue;
      hits.set(e.id, w.time);
      w.damage(e, damage, src, x, z);
      w.hit(src, e);
    }
  }
  if (w.tick % 60 === 0) for (const [id, t] of hits) if (w.time - t > 1) hits.delete(id);
}

// ------------------------------------------------------------------ trigger forms

/** Fire part `part` of `chain` in its trigger form from the hit point, using its L5 stats. */
export function fireTrigger(w: World, chain: Chain, part: number, srcEnemy: Enemy, power: number, size: number, pair: string): void {
  const src = makeSrc(chain, part, true, pair);
  const id = src.weapon;
  const area = w.build.stats.area;
  const x = srcEnemy.x;
  const z = srcEnemy.z;
  switch (id) {
    case 'pulse': {
      const P = W.pulse;
      const l5 = P.levels[5]!;
      // Directional: aim along the line from the mech through the hit point.
      let dx = x - w.x;
      let dz = z - w.z;
      const d = len2(dx, dz);
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
        pushBolt(w, x, z, dx * c - dz * s, dx * s + dz * c, P.trigger.range, P.boltRadius * area * size, P.damage * l5.damageMult * power, l5.pierce, src, [srcEnemy.id]);
      }
      break;
    }
    case 'arc': {
      const A = W.arc;
      const l5 = A.levels[5]!;
      const radius = l5.radius * A.trigger.radiusScale * area * size;
      arcPulse(w, x, z, radius, A.damage * l5.damageMult * power, src, w.inDisc(x, z, radius));
      break;
    }
    case 'tesla': {
      const TS = W.tesla;
      const l5 = TS.levels[5]!;
      const range = TS.jumpRange * area * size;
      const hit = new Set<number>([srcEnemy.id]);
      const first = w.nearestOne(x, z, range, hit);
      w.triggeredInstant.push(w.time + TS.arcLife);
      if (first) teslaWalk(w, x, z, first, TS.trigger.jumps, 0, false, TS.damage * l5.damageMult * power, range, hit, src);
      break;
    }
    case 'seeker': {
      const S = W.seeker;
      const l5 = S.levels[5]!;
      const targets = w.nearest(x, z, S.acquireRange, S.trigger.missiles, srcEnemy.id);
      for (let i = 0; i < S.trigger.missiles; i++) {
        const t = targets.length ? targets[i % targets.length] : null;
        const a = t ? Math.atan2(t.z - z, t.x - x) + (i ? 0.8 : -0.8) : (i * Math.PI * 2) / S.trigger.missiles;
        pushMissile(w, x, z, Math.cos(a), Math.sin(a), t, S.damage * l5.damageMult * power, l5.blast * area * size, srcEnemy.id, src);
      }
      break;
    }
    case 'blades': {
      const B = W.blades;
      const l5 = B.levels[5]!;
      w.orbitBlades.push({
        cx: x,
        cz: z,
        x,
        z,
        angle: w.rng.next() * Math.PI * 2,
        orbit: B.trigger.orbit * area * size,
        radius: B.radius * area * size,
        spin: B.spin * l5.spinMult,
        life: B.trigger.duration,
        damage: B.damage * l5.damageMult * power,
        hits: new Map(),
        born: w.time,
        src,
        alive: true,
      });
      break;
    }
    case 'mortar': {
      const M = W.mortar;
      const l5 = M.levels[5]!;
      pushZone(w, x, z, M.trigger.radius * area * size, M.poolDamage * l5.damageMult * power, M.poolTick, M.trigger.duration, src);
      break;
    }
  }
}

/** At the triggered-effect cap: end the oldest triggered continuous effect. */
export function endOldestContinuous(w: World): boolean {
  let oldest = Infinity;
  let kind: 'zone' | 'blade' | null = null;
  let idx = -1;
  w.zones.forEach((z, i) => {
    if (z.alive && z.src.triggered && z.born < oldest) {
      oldest = z.born;
      kind = 'zone';
      idx = i;
    }
  });
  w.orbitBlades.forEach((b, i) => {
    if (b.alive && b.born < oldest) {
      oldest = b.born;
      kind = 'blade';
      idx = i;
    }
  });
  if (kind === 'zone') w.zones.splice(idx, 1);
  else if (kind === 'blade') w.orbitBlades.splice(idx, 1);
  return kind !== null;
}

// ------------------------------------------------------------------ effects

export function updateEffects(w: World, dt: number): void {
  if (dt <= 0) return;
  updateBolts(w, dt);
  updateMissiles(w, dt);
  updateShells(w, dt);
  updateZones(w, dt);
  updateOrbitBlades(w, dt);
  // Visual lifetimes
  w.arcs = w.arcs.filter((a) => (a.life -= dt) > 0);
  w.rings = w.rings.filter((r) => (r.life -= dt) > 0);
  w.triggeredInstant = w.triggeredInstant.filter((t) => t > w.time);
}

function updateBolts(w: World, dt: number): void {
  for (const b of w.bolts) {
    if (!b.alive) continue;
    const step = b.speed * dt;
    b.x += b.dx * step;
    b.z += b.dz * step;
    b.travelled += step;
    if (b.travelled >= b.range) {
      b.alive = false;
      continue;
    }
    for (const e of w.inDisc(b.x, b.z, b.radius)) {
      if (b.hits.includes(e.id)) continue;
      b.hits.push(e.id);
      w.damage(e, b.damage, b.src, b.x - b.dx, b.z - b.dz);
      w.hit(b.src, e);
      if (b.pierce-- <= 0) {
        b.alive = false;
        break;
      }
    }
  }
  w.bolts = w.bolts.filter((b) => b.alive);
}

function updateMissiles(w: World, dt: number): void {
  const S = W.seeker;
  for (const m of w.missiles) {
    if (!m.alive) continue;
    m.life -= dt;
    if (m.target && !m.target.alive) m.target = null;
    if (!m.target) {
      m.target = w.nearestOne(m.x, m.z, 8, m.exclude >= 0 ? m.exclude : undefined);
      if (m.target) m.targetId = m.target.id;
    }
    if (m.target) {
      // Turn toward the target at a limited rate
      const want = Math.atan2(m.target.z - m.z, m.target.x - m.x);
      const cur = Math.atan2(m.dz, m.dx);
      let da = want - cur;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      const maxTurn = S.turnRate * dt;
      const a = cur + Math.max(-maxTurn, Math.min(maxTurn, da));
      m.dx = Math.cos(a);
      m.dz = Math.sin(a);
    }
    m.x += m.dx * S.speed * dt;
    m.z += m.dz * S.speed * dt;
    let boom = m.life <= 0;
    if (!boom) {
      for (const e of w.inDisc(m.x, m.z, S.hitRadius)) {
        if (e.id !== m.exclude) {
          boom = true;
          break;
        }
      }
    }
    if (boom) {
      m.alive = false;
      // Projectile: one roll per enemy the blast hits
      for (const e of w.inDisc(m.x, m.z, m.blast)) {
        w.damage(e, m.damage, m.src, m.x, m.z);
        w.hit(m.src, e);
      }
      w.rings.push({ x: m.x, z: m.z, r: m.blast, life: 0.18, maxLife: 0.18, weapon: 'seeker', triggered: m.src.triggered });
    }
  }
  w.missiles = w.missiles.filter((m) => m.alive);
}

function updateShells(w: World, dt: number): void {
  for (const s of w.shells) {
    s.t += dt / s.flight;
    if (s.t < 1) continue;
    s.alive = false;
    if (!s.src.triggered || s.damage > 0) {
      const hit = w.inDisc(s.x1, s.z1, s.blast);
      for (const e of hit) w.damage(e, s.damage, s.src, s.x1, s.z1);
      w.rings.push({ x: s.x1, z: s.z1, r: s.blast, life: 0.22, maxLife: 0.22, weapon: 'mortar', triggered: s.src.triggered });
      w.areaHits(s.src, hit);
    }
    pushZone(w, s.x1, s.z1, s.poolRadius, s.poolDamage, W.mortar.poolTick, s.poolLife, s.src);
  }
  w.shells = w.shells.filter((s) => s.alive);
}

function updateZones(w: World, dt: number): void {
  for (const z of w.zones) {
    if (!z.alive) continue;
    z.life -= dt;
    if (z.life <= 0) {
      z.alive = false;
      continue;
    }
    if (w.time >= z.nextTick) {
      z.nextTick += z.tick;
      // Continuous: each tick is 0.5 s, so each enemy inside rolls once per 0.5 s of contact
      for (const e of w.inDisc(z.x, z.z, z.r)) {
        w.damage(e, z.damage, z.src, z.x, z.z);
        w.hit(z.src, e);
      }
    }
  }
  w.zones = w.zones.filter((z) => z.alive);
}

function updateOrbitBlades(w: World, dt: number): void {
  const cd = W.blades.hitCooldown;
  for (const b of w.orbitBlades) {
    b.life -= dt;
    if (b.life <= 0) {
      b.alive = false;
      continue;
    }
    b.angle += b.spin * dt;
    b.x = b.cx + Math.cos(b.angle) * b.orbit;
    b.z = b.cz + Math.sin(b.angle) * b.orbit;
    for (const e of w.inDisc(b.x, b.z, b.radius)) {
      const last = b.hits.get(e.id);
      if (last !== undefined && w.time - last < cd) continue;
      b.hits.set(e.id, w.time);
      w.damage(e, b.damage, b.src, b.x, b.z);
      w.hit(b.src, e);
    }
  }
  w.orbitBlades = w.orbitBlades.filter((b) => b.alive);
}
