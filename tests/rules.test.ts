import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/tuning';
import { World, replay } from '../src/sim/world';
import { runBot } from '../src/sim/bot';
import { applyCodex, applyFeat, applyRunEnd, emptyProfile, loadProfile, saveProfile, type Store } from '../src/meta';

function quiet(seed = 1): World {
  const w = new World({ seed });
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

describe('hit events (Link rules §1)', () => {
  it('an area pulse rolls for at most 3 random enemies per activation', () => {
    const w = quiet();
    w.dev({ cmd: 'link', chain: ['arc', 'pulse'], chainLevel: 5 });
    w.dev({ cmd: 'stress', on: true }); // every roll succeeds
    const chain = w.build.hardpoints[0]!;
    const hit = Array.from({ length: 20 }, (_, i) => still(w, 30 + i, 30));
    const src = { chain, part: 0, weapon: 'arc' as const, triggered: false, pair: null };
    w.areaHits(src, hit);
    expect(chain.parts[1].fired).toBe(TUNING.links.areaRolls);
    // Fewer enemies than 3: one roll each
    const w2 = quiet();
    w2.dev({ cmd: 'link', chain: ['arc', 'pulse'], chainLevel: 5 });
    w2.dev({ cmd: 'stress', on: true });
    const c2 = w2.build.hardpoints[0]!;
    w2.areaHits({ ...src, chain: c2 }, [still(w2, 30, 30), still(w2, 32, 30)]);
    expect(c2.parts[1].fired).toBe(2);
  });

  it('a continuous weapon rolls once per enemy per 0.5 s of contact', () => {
    const w = quiet();
    w.dev({ cmd: 'link', chain: ['mortar', 'pulse'], chainLevel: 5 });
    w.dev({ cmd: 'stress', on: true });
    const e = still(w, 5, 0);
    for (let i = 0; i < 60 * 8; i++) w.step(0, 0);
    // One enemy: shells (area, up to 3 rolls but one enemy) plus pool ticks every 0.5 s,
    // and the 0.25 s per-enemy gate: never more than 4 triggers per second from it.
    const p = w.build.hardpoints[0]!.parts[1];
    expect(p.fired).toBeGreaterThan(0);
    expect(p.fired + p.skipped).toBeLessThanOrEqual(8 / TUNING.links.enemyGate + 1);
    expect(e.alive).toBe(true);
  });

  it('past the 1,500 triggered-effect cap, the oldest continuous effects end first', () => {
    const w = quiet();
    w.dev({ cmd: 'link', chain: ['pulse', 'mortar'], chainLevel: 5 });
    const chain = w.build.hardpoints[0]!;
    const src = { chain, part: 1, weapon: 'mortar' as const, triggered: true, pair: 'pulse>mortar' };
    for (let i = 0; i < TUNING.links.maxTriggeredEffects; i++) {
      w.zones.push({ x: 50, z: 50, r: 1, damage: 1, tick: 0.5, nextTick: 0, life: 60, maxLife: 60, born: i, src, alive: true });
    }
    expect(w.triggeredEffects).toBe(TUNING.links.maxTriggeredEffects);
    w.dev({ cmd: 'stress', on: true });
    still(w, 4, 0);
    for (let i = 0; i < 60; i++) w.step(0, 0);
    expect(chain.parts[1].fired).toBeGreaterThan(0);
    // The oldest pools (born 0, 1, ...) were ended to make room
    expect(w.zones.some((z) => z.born === 0)).toBe(false);
    expect(w.triggeredEffects).toBeLessThanOrEqual(TUNING.links.maxTriggeredEffects);
  });
});

describe('director and Surges', () => {
  it('runs the full Surge schedule, Breath 10 s before each, then the Overmind at 15:00', () => {
    const w = new World({ seed: 2 });
    w.dev({ cmd: 'god', on: true });
    const seen: { type: string; t: number }[] = [];
    runBot(w, 905, (wd) => {
      for (const ev of wd.events) if (['breath', 'surge', 'boss'].includes(ev.type)) seen.push({ type: ev.type === 'boss' ? `boss:${ev.kind}` : ev.type, t: Math.round(wd.time) });
    });
    const surges = seen.filter((e) => e.type === 'surge').map((e) => e.t);
    expect(surges).toEqual([90, 180, 270, 360, 540, 630, 720, 810]);
    expect(seen.find((e) => e.type === 'boss:brood')?.t).toBe(450);
    expect(seen.find((e) => e.type === 'boss:overmind')?.t).toBe(900);
    const breaths = seen.filter((e) => e.type === 'breath').map((e) => e.t);
    expect(breaths).toEqual([80, 170, 260, 350, 440, 530, 620, 710, 800, 890]);
  });

  it('forces one elite every 90 s from 2:00', () => {
    const w = new World({ seed: 3 });
    w.dev({ cmd: 'god', on: true });
    const elites: number[] = [];
    runBot(w, 400, (wd) => {
      for (const ev of wd.events) if (ev.type === 'elite') elites.push(Math.round(wd.time));
    });
    expect(elites).toEqual([120, 210, 300, 390]);
  });

  it('a Surge that takes over 25 s to break makes the next one smaller', () => {
    const w = quiet();
    w.dev({ cmd: 'director', on: true });
    w.surgeSizeMult = 1;
    // Simulate a slow break
    w.surgePhase = 'surge';
    w.surgeId = 7;
    w.surgeSize = 10;
    w.surgeStart = 0;
    w.time = 30;
    for (let i = 0; i < 7; i++) {
      const e = w.spawnEnemy('mite', 50, 50, 7)!;
      w.damage(e, 1e6, null, 0, 0);
    }
    expect(w.surgePhase).toBe('build');
    expect(w.surgeSizeMult).toBe(TUNING.surge.slowSurgeMult);
  });

  it('a Splitter splits into 4 Mites on death', () => {
    const w = quiet();
    const s = w.spawnEnemy('splitter', 10, 10, 0)!;
    const before = w.enemies.length;
    w.damage(s, 1e6, null, 0, 0);
    expect(w.enemies.filter((e) => e.alive && e.kind === 'mite').length).toBe(4);
    expect(w.enemies.length).toBe(before + 4);
  });

  it('Carapace fronts take 50% damage from their front 90°', () => {
    const w = quiet();
    const c = w.spawnEnemy('carapace', 10, 0, 0)!;
    c.fx = -1; // facing the mech at the origin
    c.fz = 0;
    const hp = c.hp;
    w.damage(c, 10, null, 0, 0); // from the front
    expect(hp - c.hp).toBeCloseTo(5, 6);
    w.damage(c, 10, null, 20, 0); // from behind
    expect(hp - c.hp).toBeCloseTo(15, 6);
  });

  it('elites: 3x size, 10x HP, 2x damage, 25 XP; Shielded absorbs 50% of scaled HP first; each drops an Overflow Cache', () => {
    const w = quiet();
    const base = w.spawnEnemy('mite', 20, 0, 0)!;
    const e = w.spawnEnemy('mite', 30, 0, 0, 2)!;
    expect(e.r).toBeCloseTo(base.r * 3, 6);
    expect(e.maxHp).toBeCloseTo(base.maxHp * 10, 6);
    expect(e.damage).toBeCloseTo(base.damage * 2, 6);
    expect(e.shield).toBeCloseTo(e.maxHp * 0.5, 6);
    w.damage(e, e.shield, null, 0, 0);
    expect(e.hp).toBeCloseTo(e.maxHp, 6);
    w.damage(e, 1e9, null, 0, 0);
    expect(w.pickups.some((p) => p.kind === 'cache')).toBe(true);
  });
});

describe('bosses', () => {
  it('the Brood Mother drops a guaranteed Link card when a Link is possible', () => {
    const w = quiet();
    w.dev({ cmd: 'grant', weapon: 'pulse', level: 5 });
    w.dev({ cmd: 'grant', weapon: 'tesla', level: 5 });
    w.lastDraftHadLink = true; // cadence would skip the Link card this time
    w.dev({ cmd: 'boss', kind: 'brood' });
    const b = w.bosses[0];
    w.damage(b, 1e9, null, 0, 0);
    w.step(0, 0);
    // After the boss-death slow-mo the extra draft opens with a Link card
    for (let i = 0; i < 200 && !w.draft; i++) w.step(0, 0);
    expect(w.draft?.some((c) => c.type === 'link')).toBe(true);
    expect(w.feats.has('broodBeaten')).toBe(true);
  });

  it('killing the Overmind wins the run', () => {
    const w = quiet();
    w.dev({ cmd: 'boss', kind: 'overmind' });
    w.damage(w.bosses[0], 1e9, null, 0, 0);
    for (let i = 0; i < 600 && !w.runOver; i++) w.step(0, 0);
    expect(w.won).toBe(true);
    expect(w.runOver).toBe(true);
  });
});

describe('saved progress', () => {
  function memStore(): Store & { data: Record<string, string> } {
    const data: Record<string, string> = {};
    return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
  }

  it('unlocks, the Codex and best kills survive a save and reload', () => {
    const store = memStore();
    const p = emptyProfile();
    expect(applyFeat(p, 'firstLink')).toEqual(['ion']);
    expect(applyFeat(p, 'broodBeaten')).toEqual(['cryo']);
    expect(applyFeat(p, 'win')).toEqual(['moon', 'endless']);
    expect(applyCodex(p, 'pulse>tesla').isNew).toBe(true);
    expect(applyCodex(p, 'pulse>tesla').isNew).toBe(false);
    applyRunEnd(p, new Map([['pulse>tesla', 42]]), new Map([['seeker>tesla>mortar', 7]]));
    saveProfile(p, store);
    const q = loadProfile(store);
    expect(q.unlocks.sort()).toEqual(['cryo', 'endless', 'ion', 'moon']);
    expect(q.codex['pulse>tesla']).toBe(42);
    expect(q.apex['seeker>tesla>mortar']).toBe(7);
    expect(q.wins).toBe(1);
    expect(q.threatWon).toBe(0);
  });

  it('discovering 10 different Links unlocks the Singularity Core', () => {
    const p = emptyProfile();
    const ids = TUNING.startingWeapons;
    let unlocked: string[] = [];
    let n = 0;
    for (const h of ids) for (const t of ids) if (h !== t && n < 10) {
      n++;
      unlocked = unlocked.concat(applyCodex(p, `${h}>${t}`).unlocks);
    }
    expect(unlocked).toEqual(['singularity']);
  });

  it('a corrupt or missing save starts fresh', () => {
    const store = memStore();
    expect(loadProfile(store).unlocks).toEqual([]);
    store.data['neonSwarm.profile.v1'] = '{not json';
    expect(loadProfile(store).runs).toBe(0);
    expect(loadProfile(null).runs).toBe(0);
  });
});

describe('reproducibility with the full roster', () => {
  it('replays a run through elites and the Brood Mother exactly', () => {
    const a = new World({ seed: 9 });
    a.dev({ cmd: 'god', on: true });
    a.dev({ cmd: 'time', seconds: 430 });
    runBot(a, 470);
    const b = replay({ seed: 9 }, a.inputs, a.log);
    expect(b.fingerprint()).toBe(a.fingerprint());
  });
});
