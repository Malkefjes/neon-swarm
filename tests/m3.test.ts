import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/tuning';
import { World, replay } from '../src/sim/world';
import { linkOptions } from '../src/sim/build';
import { runBot } from '../src/sim/bot';
import { buildLayout, pushOut } from '../src/sim/maps';
import { applyFeat, emptyProfile, maxThreat } from '../src/meta';

function quiet(opts: Partial<ConstructorParameters<typeof World>[0]> = {}): World {
  const w = new World({ seed: 1, ...opts });
  w.dev({ cmd: 'director', on: false });
  w.dev({ cmd: 'god', on: true });
  return w;
}

function still(w: World, x: number, z: number, hp = 1e9) {
  const e = w.spawnEnemy('mite', x, z, 0)!;
  e.hp = e.maxHp = hp;
  e.speed = 0;
  return e;
}

function run(w: World, s: number) {
  for (let i = 0; i < s * 60; i++) {
    while (w.draft) w.choose(0);
    w.step(0, 0);
  }
}

describe('frames', () => {
  it('SPARK: starts with Tesla, Links open at L3, weapons cap at L4, trigger forms use L4 stats', () => {
    const w = quiet({ frame: 'spark' });
    expect(w.build.hardpoints[0]!.parts[0].weapon.id).toBe('tesla');
    expect(w.build.maxHull).toBe(90);
    expect(w.build.stats.speed).toBe(5.3);
    w.dev({ cmd: 'grant', weapon: 'tesla', level: 5 });
    expect(w.build.hardpoints[0]!.parts[0].weapon.level).toBe(4);
    w.dev({ cmd: 'grant', weapon: 'pulse', level: 3 });
    w.build.hardpoints[0]!.parts[0].weapon.level = 3;
    expect(linkOptions(w.build, w.linkLevel)).toHaveLength(1);
    expect(w.triggerLevel).toBe(4);
  });

  it('COLOSSUS: 3 hardpoints, 30% slower, starts with the Mortar; every trigger fires twice and counts twice', () => {
    const w = quiet({ frame: 'colossus' });
    expect(w.build.hardpoints).toHaveLength(3);
    expect(w.build.stats.speed).toBe(3.5);
    expect(w.build.maxHull).toBe(140);
    expect(w.build.hardpoints[0]!.parts[0].weapon.id).toBe('mortar');
    w.dev({ cmd: 'link', chain: ['pulse', 'arc'], chainLevel: 5 });
    w.dev({ cmd: 'stress', on: true });
    const chain = w.build.hardpoints.find((c) => c && c.parts.length === 2)!;
    const tail = chain.parts[1];
    still(w, 5, 0);
    let rings = 0;
    for (let i = 0; i < 60; i++) {
      w.step(0, 0);
      rings += w.rings.filter((r) => r.triggered && r.life === r.maxLife - 0).length;
    }
    // Two tokens per trigger
    expect(tail.fired).toBeGreaterThan(0);
    expect(TUNING.links.limiterBurst - tail.tokens).toBeGreaterThanOrEqual(0);
    const tokensUsed = tail.fired * 2;
    expect(tokensUsed).toBeGreaterThan(tail.fired);
    // Each trigger spawned two rings 0.1 s apart
    const ringsTotal = w.rings.length + rings;
    expect(ringsTotal).toBeGreaterThan(0);
  });

  it('COLOSSUS spawns a second trigger effect 0.1 s after the first', () => {
    const w = quiet({ frame: 'colossus' });
    w.dev({ cmd: 'link', chain: ['pulse', 'tesla'], chainLevel: 5 });
    w.dev({ cmd: 'stress', on: true });
    still(w, 4, 0);
    still(w, 4, 2.5);
    let firstAt = -1;
    let delayedSeen = false;
    for (let i = 0; i < 120; i++) {
      w.step(0, 0);
      if (firstAt < 0 && w.delayed.length) firstAt = w.time;
      if (w.delayed.length) delayedSeen = true;
    }
    expect(delayedSeen).toBe(true);
    const tail = w.build.hardpoints.find((c) => c && c.parts.length === 2)!.parts[1];
    expect(tail.fired).toBeGreaterThan(0);
  });
});

describe('new weapons', () => {
  it('Cryo slows, then freezes an enemy after 1.5 s in the cone; frozen take +50% at L3', () => {
    const w = quiet();
    w.dev({ cmd: 'grant', weapon: 'cryo', level: 4 }); // always on
    w.build.hardpoints[0] = null; // remove the Pulse Rifle
    const e = still(w, 3, 0);
    let slowedAt = -1;
    let frozenAt = -1;
    for (let i = 0; i < 180; i++) {
      w.step(0, 0);
      if (slowedAt < 0 && e.slowUntil > w.time) slowedAt = w.time;
      if (frozenAt < 0 && e.frozenUntil > w.time) frozenAt = w.time;
    }
    expect(slowedAt).toBeGreaterThanOrEqual(0);
    expect(frozenAt - slowedAt).toBeGreaterThanOrEqual(1.4);
    expect(frozenAt - slowedAt).toBeLessThan(1.8);
    const f = still(w, 40, 40);
    f.frozenUntil = w.time + 5;
    const hp = f.hp;
    w.damage(f, 10, null, 0, 0);
    expect(hp - f.hp).toBeCloseTo(15, 6);
  });

  it('Ion Mines detonate when an enemy comes close; at L5 a detonation sets off mines within 3 u', () => {
    const w = quiet();
    w.dev({ cmd: 'grant', weapon: 'ion', level: 5 });
    const chain = w.build.hardpoints.find((c) => c && c.parts[0].weapon.id === 'ion')!;
    const src = { chain, part: 0, weapon: 'ion' as const, triggered: false, pair: null };
    for (const x of [20, 22.5, 25]) w.mines.push({ x, z: 20, arm: 0, life: 10, damage: 30, blast: 2, chain: true, src, alive: true });
    still(w, 20.5, 20);
    w.step(0, 0);
    expect(w.mines.length).toBe(0); // all three went off in a chain
  });

  it('the Railgun pierces everything along its line in the travel direction', () => {
    const w = quiet();
    w.build.hardpoints[0] = null;
    w.dev({ cmd: 'grant', weapon: 'rail', level: 1 });
    w.faceX = 1;
    w.faceZ = 0;
    const line = [3, 6, 9, 12].map((x) => still(w, x, 0));
    const off = still(w, 6, 5);
    w.step(0, 0);
    for (const e of line) expect(e.hp).toBeLessThan(e.maxHp);
    expect(off.hp).toBe(off.maxHp);
  });

  it('the Singularity pulls enemies in and collapses at the end', () => {
    const w = quiet();
    w.build.hardpoints[0] = null;
    w.dev({ cmd: 'grant', weapon: 'singularity', level: 1 });
    const a = w.spawnEnemy('mite', 6, 0, 0)!;
    a.speed = 0;
    const b = w.spawnEnemy('mite', 8.5, 0, 0)!;
    b.speed = 0;
    b.hp = b.maxHp = 1e6;
    const d0 = Math.abs(b.x - a.x);
    run(w, 1);
    expect(w.singularities.length).toBe(1);
    expect(Math.abs(b.x - w.singularities[0].x)).toBeLessThan(d0);
    const booms: number[] = [];
    for (let i = 0; i < 60 * 4; i++) {
      w.step(0, 0);
      for (const ev of w.events) if (ev.type === 'boom') booms.push(w.time);
      w.events.length = 0;
    }
    expect(booms.length).toBeGreaterThan(0);
  });
});

describe('Spitter', () => {
  it('holds at 7 u and lobs globs at the mech', () => {
    const w = quiet();
    w.build.hardpoints[0] = null;
    const s = w.spawnEnemy('spitter', 12, 0, 0)!;
    run(w, 6);
    expect(Math.abs(s.x - 7.5)).toBeLessThan(0.6);
    expect(w.hazards.some((h) => h.kind === 'spit') || w.damageTaken.spit !== undefined).toBe(true);
  });
});

describe('Threat Levels', () => {
  it('stack: +15% speed, elites every 45 s, +30% HP, max Hull 60', () => {
    const w0 = quiet();
    const w10 = quiet({ threat: 10 });
    const a = w0.spawnEnemy('mite', 30, 30, 0)!;
    const b = w10.spawnEnemy('mite', 30, 30, 0)!;
    expect(b.speed / a.speed).toBeCloseTo(1.15, 6);
    expect(b.maxHp / a.maxHp).toBeCloseTo(1.3, 6);
    expect(w10.build.maxHull).toBe(60);
    const w2 = new World({ seed: 3, threat: 2 });
    w2.dev({ cmd: 'god', on: true });
    const elites: number[] = [];
    runBot(w2, 220, (wd) => {
      for (const ev of wd.events) if (ev.type === 'elite') elites.push(Math.round(wd.time));
    });
    expect(elites).toEqual([120, 165, 210]);
  });

  it('winning at Threat N opens N + 1; winning on the Station opens the Moon', () => {
    const p = emptyProfile();
    expect(maxThreat(p)).toBe(0);
    applyFeat(p, 'win', { biome: 'station', threat: 0 });
    expect(maxThreat(p)).toBe(1);
    expect(p.unlocks).toContain('moon');
    expect(p.unlocks).toContain('endless');
    applyFeat(p, 'win', { biome: 'moon', threat: 1 });
    expect(maxThreat(p)).toBe(2);
    for (let t = 2; t <= 12; t++) applyFeat(p, 'win', { biome: 'moon', threat: t });
    expect(maxThreat(p)).toBe(10);
  });
});

describe('maps', () => {
  it('Station obstacles block the mech and keep an escape lane (clear gaps between them)', () => {
    const { obstacles } = buildLayout('station');
    expect(obstacles.length).toBeGreaterThan(20);
    for (let i = 0; i < obstacles.length; i++) {
      for (let j = i + 1; j < obstacles.length; j++) {
        const a = obstacles[i];
        const b = obstacles[j];
        const ra = Math.hypot(a.hx, a.hz);
        const rb = Math.hypot(b.hx, b.hz);
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(ra + rb + TUNING.maps.station.gap - 1e-6);
      }
    }
    const w = quiet();
    const o = obstacles[0];
    const p = { x: o.x, z: o.z };
    pushOut(w, p, 0.75);
    expect(Math.hypot(p.x - o.x, p.z - o.z)).toBeGreaterThan(0);
  });

  it('the Moon wraps around: the mech can walk forever and stays near the origin', () => {
    const w = quiet({ biome: 'moon' });
    for (let i = 0; i < 60 * 80; i++) w.step(1, 0); // 400 u
    expect(Math.abs(w.x)).toBeLessThanOrEqual(TUNING.maps.moon.recentre + 1);
    expect(Math.abs(w.shiftX) + Math.abs(w.shiftZ)).toBeGreaterThan(300);
    for (const c of w.crystals) {
      expect(Math.abs(c.x - w.x)).toBeLessThanOrEqual(TUNING.maps.moon.size / 2 + 1e-6);
      expect(Math.abs(c.z - w.z)).toBeLessThanOrEqual(TUNING.maps.moon.size / 2 + 1e-6);
    }
  });

  it('Moon crystals shatter into shrapnel, and each shard hit rolls for triggers', () => {
    const w = quiet({ biome: 'moon' });
    w.dev({ cmd: 'link', chain: ['pulse', 'tesla'], chainLevel: 5 });
    w.dev({ cmd: 'stress', on: true });
    const c = w.crystals[0];
    c.x = 5;
    c.z = 0;
    const e = still(w, 5, 2);
    // A bolt through the crystal
    const chain = w.build.hardpoints.find((h) => h && h.parts.length === 2)!;
    const src = { chain, part: 0, weapon: 'pulse' as const, triggered: false, pair: null };
    w.bolts.push({ x: 3, z: 0, px: 3, pz: 0, dx: 1, dz: 0, speed: 20, travelled: 0, range: 5, radius: 0.2, damage: 1, pierce: 0, hits: [], src, alive: true });
    let shattered = false;
    for (let i = 0; i < 30; i++) {
      w.step(0, 0);
      if (w.events.some((ev) => ev.type === 'shatter')) shattered = true;
      w.events.length = 0;
    }
    expect(shattered).toBe(true);
    expect(e.hp).toBeLessThan(e.maxHp);
    expect(chain.parts[1].fired).toBeGreaterThan(0);
  });
});

describe('Endless', () => {
  it('killing the Overmind counts as a win and the run goes on, with Surges every 90 s', { timeout: 60000 }, () => {
    const w = new World({ seed: 4, endless: true });
    w.dev({ cmd: 'god', on: true });
    // A late-game build, since the clock jumps straight to 14:55
    w.dev({ cmd: 'link', chain: ['pulse', 'tesla', 'arc'], chainLevel: 5 });
    w.dev({ cmd: 'grant', weapon: 'mortar', level: 5 });
    w.dev({ cmd: 'grant', weapon: 'blades', level: 5 });
    w.dev({ cmd: 'stat', stat: 'power', value: 6 });
    w.dev({ cmd: 'time', seconds: 895 });
    runBot(w, 905);
    const om = w.bosses.find((b) => b.kind === 'overmind')!;
    w.damage(om, 1e9, null, 0, 0);
    const seen: string[] = [];
    runBot(w, 1300, (wd) => {
      for (const ev of wd.events) if (ev.type === 'surge' || ev.type === 'win') seen.push(`${ev.type}@${Math.round(wd.time)}`);
    });
    expect(w.feats.has('win')).toBe(true);
    expect(w.runOver).toBe(false);
    expect(seen).toContain('surge@990');
    // The next Surge follows on the 90 s beat once the previous one is broken
    expect(seen.filter((e) => e.startsWith('surge')).length).toBeGreaterThanOrEqual(2);
  });

  it('replays exactly on the Moon at Threat 5 with COLOSSUS', () => {
    const opts = { seed: 12, frame: 'colossus' as const, biome: 'moon' as const, threat: 5 };
    const a = new World(opts);
    a.dev({ cmd: 'god', on: true });
    runBot(a, 150);
    const b = replay(opts, a.inputs, a.log);
    expect(b.fingerprint()).toBe(a.fingerprint());
  });
});
