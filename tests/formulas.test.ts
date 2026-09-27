import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/tuning';
import {
  damageMult,
  expectedKillsPerMinute,
  hpMult,
  onScreenTarget,
  surgeSize,
  threatPerSecond,
  triggerChance,
  triggerMult,
  xpNext,
  xpTotal,
} from '../src/sim/formulas';

describe('XP curve', () => {
  const { base, perLevel } = TUNING.xp;
  it('XP_next(L) = base + perLevel x L (design form 10 + 12L; tuned values in src/tuning.ts)', () => {
    for (const L of [1, 2, 11, 40]) expect(xpNext(L)).toBe(base + perLevel * L);
    expect(base).toBe(10);
    expect(perLevel).toBe(16);
  });
  it('cumulative XP is the sum of the steps', () => {
    expect(xpTotal(1)).toBe(0);
    expect(xpTotal(2)).toBe(xpNext(1));
    let sum = 0;
    for (let L = 1; L < 41; L++) sum += base + perLevel * L;
    expect(xpTotal(41)).toBe(sum);
  });
  it('with the design values (10 + 12L) the curve gives the design table: ~10,000 XP for L41', () => {
    const design = (L: number) => {
      let s = 0;
      for (let l = 1; l < L; l++) s += 10 + 12 * l;
      return s;
    };
    expect(design(12)).toBe(902);
    expect(design(23)).toBe(3256);
    expect(design(41)).toBe(10240);
  });
});

describe('enemy scaling', () => {
  it('matches the appendix table', () => {
    expect(hpMult(0)).toBeCloseTo(1, 5);
    expect(hpMult(3)).toBeCloseTo(1.63, 5);
    expect(hpMult(7.5)).toBeCloseTo(3.25, 5);
    expect(hpMult(15)).toBeCloseTo(7.75, 5);
    expect(damageMult(0)).toBeCloseTo(1, 5);
    expect(damageMult(3)).toBeCloseTo(1.15, 5);
    expect(damageMult(7.5)).toBeCloseTo(1.375, 5);
    expect(damageMult(15)).toBeCloseTo(1.75, 5);
  });
});

describe('director formulas', () => {
  it('threat per second = 2 + 0.6t (660 kills/min budget at 15:00)', () => {
    expect(threatPerSecond(0)).toBe(2);
    expect(threatPerSecond(15)).toBeCloseTo(11, 5);
    expect(threatPerSecond(15) * 60).toBeCloseTo(660, 5);
  });
  it('on-screen target = min(50 + 40t, 650)', () => {
    expect(onScreenTarget(0)).toBe(50);
    expect(onScreenTarget(5)).toBe(250);
    expect(onScreenTarget(15)).toBe(650);
    expect(onScreenTarget(20)).toBe(650);
  });
  it('expected kills per minute = 60 + 40t', () => {
    expect(expectedKillsPerMinute(0)).toBe(60);
    expect(expectedKillsPerMinute(1.5)).toBe(120);
    expect(expectedKillsPerMinute(15)).toBe(660);
  });
  it('Surge size = (150 + 30n) x clamp(kills / expected, 0.8, 1.5)', () => {
    // on pace
    expect(surgeSize(1, 120, 1.5)).toBe(180);
    // weak build: clamped at 0.8
    expect(surgeSize(1, 10, 1.5)).toBe(144);
    // strong build: clamped at 1.5
    expect(surgeSize(1, 1000, 1.5)).toBe(270);
    // base sizes of the schedule
    expect([1, 2, 3, 4, 6, 7, 8, 9].map((n) => surgeSize(n, 1, 1 / 60 / 1e9) / 0.8)).toEqual([
      180, 210, 240, 270, 330, 360, 390, 420,
    ]);
  });
});

describe('trigger power and chance', () => {
  it('trigger multiplier: x0.6 at CL1, +0.1 per level, x1.0 at CL5', () => {
    expect(triggerMult(1)).toBeCloseTo(0.6, 9);
    expect(triggerMult(3)).toBeCloseTo(0.8, 9);
    expect(triggerMult(5)).toBeCloseTo(1.0, 9);
  });
  it('trigger chance: base x (1 + 0.15 per CL above 1), +60% at CL5', () => {
    expect(triggerChance(0.25, 1)).toBeCloseTo(0.25, 9);
    expect(triggerChance(0.25, 2)).toBeCloseTo(0.2875, 9);
    expect(triggerChance(0.25, 5)).toBeCloseTo(0.4, 9);
    expect(triggerChance(0.3, 5) / 0.3).toBeCloseTo(1.6, 9);
  });
});
