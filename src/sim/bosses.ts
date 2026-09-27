// Brood Mother (7:30) and Overmind (15:00), and the hazards they leave.
import { len2 } from './math';
import { TUNING } from '../tuning';
import { linkOptions } from './build';
import type { Enemy } from './types';
import type { World } from './world';

const T = TUNING;
const BM = T.bosses.brood;
const OM = T.bosses.overmind;

export function updateBosses(w: World, dt: number): void {
  for (const b of w.bosses) {
    if (!b.alive || !b.boss) continue;
    if (b.kind === 'brood') brood(w, b, dt);
    else overmind(w, b, dt);
  }
  updateHazards(w, dt);
}

function toward(w: World, b: Enemy): { x: number; z: number } {
  const dx = w.x - b.x;
  const dz = w.z - b.z;
  const d = len2(dx, dz) || 1;
  return { x: dx / d, z: dz / d };
}

function brood(w: World, b: Enemy, dt: number): void {
  const s = b.boss!;
  s.burstT -= dt;
  s.spitT -= dt;
  if (s.telegraph > 0) {
    // Charge telegraph: stand still, red line shown by the renderer
    s.telegraph -= dt;
    if (s.telegraph <= 0) s.dashLeft = BM.chargeDistance;
  } else if (s.dashLeft > 0) {
    const step = Math.min(s.dashLeft, BM.chargeSpeed * dt);
    b.x += s.dirX * step;
    b.z += s.dirZ * step;
    s.dashLeft -= step;
    b.damage = BM.chargeDamage;
    if (s.dashLeft <= 0) {
      b.damage = BM.contactDamage;
      s.chargesLeft--;
      if (s.chargesLeft > 0) startTelegraph(w, b);
    }
  } else {
    s.chargeT -= dt;
    const d = toward(w, b);
    b.fx = d.x;
    b.fz = d.z;
    b.x += d.x * b.speed * dt;
    b.z += d.z * b.speed * dt;
    if (s.chargeT <= 0) {
      s.chargeT = BM.chargeEvery;
      // Below 50% HP she charges twice in a row
      s.chargesLeft = b.hp < b.maxHp * BM.enrageHp ? 2 : 1;
      startTelegraph(w, b);
    }
    if (s.spitT <= 0) {
      s.spitT = BM.spitEvery;
      const base = Math.atan2(d.z, d.x);
      const spread = (BM.spitSpreadDeg * Math.PI) / 180;
      for (let i = 0; i < BM.spitGlobs; i++) {
        const a = base - spread / 2 + (spread * i) / Math.max(1, BM.spitGlobs - 1);
        w.hazards.push({
          kind: 'glob',
          x: b.x,
          z: b.z,
          px: b.x,
          pz: b.z,
          dx: Math.cos(a),
          dz: Math.sin(a),
          speed: BM.globSpeed,
          r: 0.35,
          life: 99,
          damage: BM.globDamage,
          travelled: 0,
          range: BM.globRange,
          alive: true,
        });
      }
    }
  }
  if (s.burstT <= 0) {
    s.burstT = BM.burstEvery;
    for (let i = 0; i < BM.burstMites; i++) {
      const a = (i / BM.burstMites) * Math.PI * 2;
      const p = { x: b.x + Math.cos(a) * BM.burstRadius, z: b.z + Math.sin(a) * BM.burstRadius };
      w.clampToArena(p, 0.5);
      w.spawnEnemy('mite', p.x, p.z, 0);
    }
  }
  w.clampToArena(b, b.r);
}

function startTelegraph(w: World, b: Enemy): void {
  const s = b.boss!;
  const d = toward(w, b);
  s.dirX = d.x;
  s.dirZ = d.z;
  b.fx = d.x;
  b.fz = d.z;
  s.telegraph = BM.chargeTelegraph;
}

/** The Overmind's beams as segments from its centre. */
export function overmindBeams(b: Enemy): { x1: number; z1: number; x2: number; z2: number }[] {
  const s = b.boss!;
  const n = s.phase >= 3 ? 4 : 2;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = s.beamAngle + (i / n) * Math.PI * 2;
    out.push({ x1: b.x, z1: b.z, x2: b.x + Math.cos(a) * OM.beamLength, z2: b.z + Math.sin(a) * OM.beamLength });
  }
  return out;
}

function overmind(w: World, b: Enemy, dt: number): void {
  const s = b.boss!;
  const frac = b.hp / b.maxHp;
  s.phase = frac > OM.phase2 ? 1 : frac > OM.phase3 ? 2 : 3;
  const enraged = w.time >= OM.enrageAt;
  s.beamAngle += ((OM.beamSpeedDeg * Math.PI) / 180) * (enraged ? 2 : 1) * dt;
  // Beams: 20 damage per touch
  const mr = T.mech.radius;
  for (const seg of overmindBeams(b)) {
    if (segDist(w.x, w.z, seg.x1, seg.z1, seg.x2, seg.z2) < OM.beamWidth / 2 + mr) {
      w.hurt(OM.beamDamage, 'beam');
      break;
    }
  }
  if (s.phase >= 2) {
    s.summonT -= dt;
    if (s.summonT <= 0) {
      s.summonT = OM.summonEvery;
      for (let i = 0; i < OM.summonElites; i++) summonElite(w, b);
    }
    s.orbT -= dt;
    if (s.orbT <= 0) {
      s.orbT = OM.orbEvery;
      const d = toward(w, b);
      w.hazards.push({
        kind: 'orb',
        x: b.x + d.x * (b.r + 0.5),
        z: b.z + d.z * (b.r + 0.5),
        px: b.x,
        pz: b.z,
        dx: d.x,
        dz: d.z,
        speed: OM.orbSpeed,
        r: 0.45,
        life: OM.orbLife,
        damage: OM.orbDamage,
        travelled: 0,
        range: Infinity,
        alive: true,
      });
    }
  }
  if (s.phase >= 3) {
    if (w.arenaRadius === Infinity) w.arenaRadius = T.arena.halfSize;
    w.arenaRadius = Math.max(OM.collapseMin, w.arenaRadius - OM.collapseSpeed * dt);
  }
}

function summonElite(w: World, b: Enemy): void {
  const a = w.rng.next() * Math.PI * 2;
  const p = { x: b.x + Math.cos(a) * (b.r + 5), z: b.z + Math.sin(a) * (b.r + 5) };
  w.clampToArena(p, 3);
  const kinds = ['mite', 'skitter', 'carapace', 'splitter'] as const;
  const e = w.spawnEnemy(kinds[w.rng.int(kinds.length)], p.x, p.z, 0, w.rng.chance(0.5) ? 1 : 2);
  if (e) w.events.push({ type: 'elite' });
}

function segDist(px: number, pz: number, x1: number, z1: number, x2: number, z2: number): number {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const l2 = dx * dx + dz * dz;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - x1) * dx + (pz - z1) * dz) / l2)) : 0;
  return len2(px - (x1 + dx * t), pz - (z1 + dz * t));
}

function updateHazards(w: World, dt: number): void {
  const mr = T.mech.radius;
  for (const h of w.hazards) {
    if (!h.alive) continue;
    h.life -= dt;
    if (h.life <= 0) {
      h.alive = false;
      continue;
    }
    if (h.kind === 'puddle') {
      if (len2(w.x - h.x, w.z - h.z) < h.r + mr * 0.5) w.hurt(h.damage, 'puddle');
      continue;
    }
    if (h.kind === 'orb') {
      const want = Math.atan2(w.z - h.z, w.x - h.x);
      const cur = Math.atan2(h.dz, h.dx);
      let da = want - cur;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      const a = cur + Math.max(-OM.orbTurn * dt, Math.min(OM.orbTurn * dt, da));
      h.dx = Math.cos(a);
      h.dz = Math.sin(a);
    }
    const step = h.speed * dt;
    h.x += h.dx * step;
    h.z += h.dz * step;
    h.travelled += step;
    const hitMech = len2(w.x - h.x, w.z - h.z) < h.r + mr;
    if (hitMech) w.hurt(h.damage, h.kind);
    if (h.kind === 'glob' && (hitMech || h.travelled >= h.range)) {
      // An acid glob leaves a puddle where it lands
      h.kind = 'puddle';
      h.r = BM.puddleRadius;
      h.life = BM.puddleLife;
      h.damage = BM.puddleDamage;
      h.speed = 0;
    } else if (h.kind === 'orb' && hitMech) h.alive = false;
  }
  w.hazards = w.hazards.filter((h) => h.alive);
}

export function onBossKilled(w: World, b: Enemy): void {
  w.bossSlowTicks = Math.round(T.sim.bossDeathSlow * T.sim.tickRate);
  w.events.push({ type: 'bossDown', kind: b.kind as 'brood' | 'overmind' });
  if (b.kind === 'brood') {
    w.addFeat('broodBeaten');
    if (w.surgePhase === 'boss') w.surgePhase = 'build';
    if (linkOptions(w.build, w.linkLevel).length > 0) {
      // A guaranteed Link card: one extra draft that holds a Link card
      w.forceLinkDraft = true;
      w.pendingLevels++;
    } else {
      for (let i = 0; i < 2; i++) w.pickups.push({ kind: 'cache', x: b.x + (i ? 1 : -1), z: b.z, state: 0 });
    }
  } else {
    w.winRun();
  }
}
