// The design's formulas, as pure functions of TUNING. Covered by tests/formulas.test.ts.
import { TUNING } from '../tuning';

const X = TUNING.xp;
const S = TUNING.scaling;
const D = TUNING.director;
const SU = TUNING.surge;
const L = TUNING.links;

/** XP needed to go from level L to L + 1. */
export function xpNext(level: number): number {
  return X.base + X.perLevel * level;
}

/** Total XP needed to reach `level` from level 1. */
export function xpTotal(level: number): number {
  let sum = 0;
  for (let l = 1; l < level; l++) sum += xpNext(l);
  return sum;
}

/** Enemy HP multiplier at run time t (minutes). */
export function hpMult(tMin: number): number {
  return 1 + S.hpLinear * tMin + S.hpQuad * tMin * tMin;
}

/** Enemy contact damage multiplier at run time t (minutes). */
export function damageMult(tMin: number): number {
  return 1 + S.damageLinear * tMin;
}

export function threatPerSecond(tMin: number): number {
  return D.threatBase + D.threatPerMin * tMin;
}

export function onScreenTarget(tMin: number): number {
  return Math.min(D.onScreenBase + D.onScreenPerMin * tMin, D.onScreenCap);
}

export function expectedKillsPerMinute(tMin: number): number {
  return D.expectedKpmBase + D.expectedKpmPerMin * tMin;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Surge size for the n-th Surge (1-based), given kills in the last 60 s at time t. */
export function surgeSize(n: number, killsLast60s: number, tMin: number): number {
  const ratio = clamp(killsLast60s / expectedKillsPerMinute(tMin), SU.ratioMin, SU.ratioMax);
  return Math.round((SU.sizeBase + SU.sizePerSurge * n) * ratio);
}

/** Power multiplier of a triggered effect at a Chain Level (x0.6 at CL1 ... x1.0 at CL5). */
export function triggerMult(chainLevel: number): number {
  return L.triggerMultBase + L.triggerMultPerLevel * (chainLevel - 1);
}

/** Trigger chance of a part at a Chain Level: base x (1 + 0.15 per CL above 1). */
export function triggerChance(baseChance: number, chainLevel: number): number {
  return baseChance * (1 + L.chancePerLevel * (chainLevel - 1));
}
