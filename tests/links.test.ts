import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/tuning';
import { addWeapon, applyLink, linkOptions, makeBuild, makePart, refillLimiters, takeTrigger } from '../src/sim/build';
import { World } from '../src/sim/world';
import { triggerMult } from '../src/sim/formulas';

const L = TUNING.links;

function quietWorld(seed = 7): World {
  const w = new World({ seed });
  w.dev({ cmd: 'director', on: false });
  w.dev({ cmd: 'god', on: true });
  return w;
}

function run(w: World, seconds: number): void {
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) {
    while (w.draft) w.choose(0);
    w.step(0, 0);
  }
}

function toughEnemy(w: World, x: number, z: number, hp = 1e9) {
  const e = w.spawnEnemy('mite', x, z, 0)!;
  e.hp = e.maxHp = hp;
  e.speed = 0;
  return e;
}

describe('Link eligibility and structure', () => {
  it('only two L5 weapons can be Linked; the player picks the head', () => {
    const b = makeBuild(4, 100, 5);
    const p = addWeapon(b, 'pulse')!;
    const t = addWeapon(b, 'tesla')!;
    expect(linkOptions(b, 5)).toHaveLength(0);
    p.level = 5;
    expect(linkOptions(b, 5)).toHaveLength(0);
    t.level = 4;
    expect(linkOptions(b, 5)).toHaveLength(0);
    t.level = 5;
    const opts = linkOptions(b, 5);
    expect(opts).toHaveLength(1);
    expect(opts[0].orders).toEqual([
      ['pulse', 'tesla'],
      ['tesla', 'pulse'],
    ]);
  });

  it('a Link takes one hardpoint and frees the other, starting at Chain Level 1', () => {
    const b = makeBuild(4, 100, 5);
    addWeapon(b, 'pulse', 5);
    addWeapon(b, 'tesla', 5);
    const opt = linkOptions(b, 5)[0];
    const chain = applyLink(b, opt, ['tesla', 'pulse']);
    expect(chain.parts.map((p) => p.weapon.id)).toEqual(['tesla', 'pulse']);
    expect(chain.level).toBe(1);
    expect(b.hardpoints.filter((h) => h === null)).toHaveLength(3);
  });

  it('each weapon is owned at most once, so a chain never repeats a weapon', () => {
    const b = makeBuild(4, 100, 5);
    expect(addWeapon(b, 'pulse')).not.toBeNull();
    expect(addWeapon(b, 'pulse')).toBeNull();
  });

  it('an Apex needs a two-part chain at Chain Level 3+ plus an L5 weapon; three parts max', () => {
    const b = makeBuild(4, 100, 5);
    const p = addWeapon(b, 'pulse', 5)!;
    addWeapon(b, 'tesla', 5);
    const chain = applyLink(b, linkOptions(b, 5)[0], ['pulse', 'tesla']);
    // A stand-in third weapon (only two are implemented in milestone 1)
    const third = { id: 'pulse' as const, level: 5, cooldown: 0 };
    b.hardpoints[1] = { parts: [makePart(third)], level: 0 };
    chain.level = 2;
    expect(linkOptions(b, 5).filter((o) => o.kind === 'apex')).toHaveLength(0);
    chain.level = 3;
    const apex = linkOptions(b, 5).filter((o) => o.kind === 'apex');
    expect(apex).toHaveLength(1);
    expect(apex[0].orders.map((o) => o.length)).toEqual([3, 3]);
    // A three-part chain can't grow further
    chain.parts.push(makePart({ ...p, id: 'tesla' }));
    expect(linkOptions(b, 5).filter((o) => o.kind === 'apex')).toHaveLength(0);
  });
});

describe('cascade limiter', () => {
  it('allows bursts of 60, then refills at 150 per second', () => {
    const part = makePart({ id: 'tesla', level: 5, cooldown: 0 });
    let ok = 0;
    for (let i = 0; i < 100; i++) if (takeTrigger(part, false)) ok++;
    expect(ok).toBe(L.limiterBurst);
    const b = makeBuild(4, 100, 5);
    b.hardpoints[0] = { parts: [makePart({ id: 'pulse', level: 5, cooldown: 0 }), part], level: 1 };
    refillLimiters(b, 0.1);
    ok = 0;
    for (let i = 0; i < 100; i++) if (takeTrigger(part, false)) ok++;
    expect(ok).toBe(15); // 150/s x 0.1 s
  });

  it('skipped triggers bank +10% power and +5% size, capped at +200% / +50%, spent on the next trigger', () => {
    const part = makePart({ id: 'tesla', level: 5, cooldown: 0 });
    part.tokens = 0;
    for (let i = 0; i < 3; i++) expect(takeTrigger(part, false)).toBeNull();
    expect(part.bankPower).toBeCloseTo(0.3, 9);
    expect(part.bankSize).toBeCloseTo(0.15, 9);
    for (let i = 0; i < 100; i++) takeTrigger(part, false);
    expect(part.bankPower).toBeCloseTo(2.0, 9);
    expect(part.bankSize).toBeCloseTo(0.5, 9);
    part.tokens = 1;
    const g = takeTrigger(part, false)!;
    expect(g.power).toBeCloseTo(2.0, 9);
    expect(g.size).toBeCloseTo(0.5, 9);
    expect(part.bankPower).toBe(0);
    expect(part.bankSize).toBe(0);
  });

  it('past the 1,500 triggered-effect cap a trigger is skipped and banked', () => {
    const part = makePart({ id: 'tesla', level: 5, cooldown: 0 });
    expect(takeTrigger(part, true)).toBeNull();
    expect(part.bankPower).toBeCloseTo(0.1, 9);
    expect(part.tokens).toBe(L.limiterBurst);
  });

  it('never lets a part fire more than 150 triggers per second in play', () => {
    const w = quietWorld();
    w.dev({ cmd: 'link', chain: ['tesla', 'pulse'], chainLevel: 5 });
    w.dev({ cmd: 'stress', on: true });
    // Far past the Rate cap, only reachable with dev tools, to saturate the limiter
    w.dev({ cmd: 'stat', stat: 'rate', value: 30 });
    w.dev({ cmd: 'bench', count: 800, minutes: 15 });
    run(w, 1);
    const pulse = w.build.hardpoints[0]!.parts[1];
    const before = pulse.fired;
    run(w, 4);
    const perSecond = (pulse.fired - before) / 4;
    expect(perSecond).toBeLessThanOrEqual(L.limiterRate + 1);
    expect(perSecond).toBeGreaterThan(L.limiterRate * 0.9);
    expect(pulse.skipped).toBeGreaterThan(0);
  });
});

describe('trigger resolution in play', () => {
  it('only the head fires on its own; triggers flow head to tail; the tail rolls for nothing', () => {
    const w = quietWorld();
    w.dev({ cmd: 'link', chain: ['pulse', 'tesla'], chainLevel: 5 });
    for (let i = 0; i < 30; i++) toughEnemy(w, 3 + (i % 6), -3 + Math.floor(i / 6));
    let untriggeredArcs = 0;
    let triggeredArcs = 0;
    let triggeredBolts = 0;
    for (let i = 0; i < 300; i++) {
      w.step(0, 0);
      for (const a of w.arcs) if (a.triggered) triggeredArcs++;
      else untriggeredArcs++;
      for (const b of w.bolts) if (b.src.triggered) triggeredBolts++;
    }
    expect(untriggeredArcs).toBe(0); // Tesla is linked in: no solo fire
    expect(triggeredArcs).toBeGreaterThan(0); // Pulse hits trigger Tesla
    expect(triggeredBolts).toBe(0); // Tesla (tail) never triggers Pulse back
    expect([...w.codex]).toEqual(['pulse>tesla']);
  });

  it('reversed order plays differently: Tesla hits launch Pulse bursts', () => {
    const w = quietWorld();
    w.dev({ cmd: 'link', chain: ['tesla', 'pulse'], chainLevel: 1 });
    for (let i = 0; i < 30; i++) toughEnemy(w, 3 + (i % 6), -3 + Math.floor(i / 6));
    let soloBolts = 0;
    let triggeredBolts = 0;
    let soloArcs = 0;
    for (let i = 0; i < 300; i++) {
      w.step(0, 0);
      for (const b of w.bolts) if (b.src.triggered) triggeredBolts++;
      else soloBolts++;
      for (const a of w.arcs) if (!a.triggered) soloArcs++;
    }
    expect(soloBolts).toBe(0);
    expect(soloArcs).toBeGreaterThan(0);
    expect(triggeredBolts).toBeGreaterThan(0);
    expect([...w.codex]).toEqual(['tesla>pulse']);
  });

  it("a triggered effect uses the part's L5 stats x the Chain Level multiplier", () => {
    for (const cl of [1, 3, 5]) {
      const w = quietWorld(11);
      w.dev({ cmd: 'link', chain: ['pulse', 'tesla'], chainLevel: cl });
      w.dev({ cmd: 'stress', on: true });
      const src = toughEnemy(w, 12.9, 0);
      // Out of the rifle's reach and off the bolt line, within Tesla jump range of the source
      const side = toughEnemy(w, 14.5, 2.5);
      run(w, 3);
      const lost = side.maxHp - side.hp;
      const per = 14 * 1.3 * triggerMult(cl);
      expect(lost).toBeGreaterThan(0);
      expect(src.maxHp - src.hp).toBeGreaterThan(0);
      expect(lost / per).toBeCloseTo(Math.round(lost / per), 6);
    }
  });

  it('one enemy sources at most one trigger per Link part every 0.25 s', () => {
    const w = quietWorld();
    w.dev({ cmd: 'link', chain: ['pulse', 'tesla'], chainLevel: 5 });
    w.dev({ cmd: 'stress', on: true }); // every roll succeeds
    w.dev({ cmd: 'stat', stat: 'rate', value: 2 });
    toughEnemy(w, 4, 0);
    run(w, 5);
    const tesla = w.build.hardpoints[0]!.parts[1];
    const total = tesla.fired + tesla.skipped;
    expect(total).toBeGreaterThan(10);
    expect(total).toBeLessThanOrEqual(5 / L.enemyGate + 1);
  });
});

describe('Link card in drafts', () => {
  it('is guaranteed in the next draft, then offered in every other draft until taken', () => {
    const w = quietWorld();
    w.dev({ cmd: 'grant', weapon: 'pulse', level: 5 });
    w.dev({ cmd: 'grant', weapon: 'tesla', level: 5 });
    const seen: boolean[] = [];
    for (let i = 0; i < 6; i++) {
      w.dev({ cmd: 'xp', amount: w.xpToNext - w.xp });
      expect(w.draft).not.toBeNull();
      const linkAt = w.draft!.findIndex((c) => c.type === 'link');
      seen.push(linkAt >= 0);
      // take anything but the Link
      w.choose(linkAt === 0 ? 1 : 0);
    }
    expect(seen).toEqual([true, false, true, false, true, false]);
    w.dev({ cmd: 'xp', amount: w.xpToNext - w.xp });
    const idx = w.draft!.findIndex((c) => c.type === 'link');
    expect(idx).toBeGreaterThanOrEqual(0);
    w.choose(idx, 1); // second order: Tesla -> Pulse
    expect(w.build.hardpoints[0]!.parts.map((p) => p.weapon.id)).toEqual(['tesla', 'pulse']);
  });

  it('never shows the same card twice in one draft', () => {
    const w = quietWorld();
    for (let i = 0; i < 40; i++) {
      w.dev({ cmd: 'xp', amount: w.xpToNext - w.xp });
      const keys = w.draft!.map((c) => JSON.stringify(c));
      expect(new Set(keys).size).toBe(keys.length);
      w.choose(i % w.draft!.length);
    }
  });
});
