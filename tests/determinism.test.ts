import { describe, expect, it } from 'vitest';
import { runBot } from '../src/sim/bot';
import { World, replay } from '../src/sim/world';

describe('reproducibility', () => {
  it('the same seed and the same inputs reproduce the same run', () => {
    const a = new World({ seed: 42 });
    a.dev({ cmd: 'grant', weapon: 'tesla', level: 3 });
    runBot(a, 100);
    const b = replay(42, a.inputs, a.log);
    expect(b.tick).toBe(a.tick);
    expect(b.fingerprint()).toBe(a.fingerprint());
    expect(a.surgeCount).toBe(1); // the run reached Surge 1
  });

  it('a different seed gives a different run', () => {
    const a = runBot(new World({ seed: 1 }), 30);
    const b = runBot(new World({ seed: 2 }), 30);
    expect(a.fingerprint()).not.toBe(b.fingerprint());
  });

  it('a Link cascade replays exactly', () => {
    const a = new World({ seed: 5 });
    a.dev({ cmd: 'link', chain: ['pulse', 'tesla'], chainLevel: 3 });
    a.dev({ cmd: 'bench', count: 400, minutes: 5 });
    runBot(a, 8);
    const b = replay(5, a.inputs, a.log);
    expect(b.fingerprint()).toBe(a.fingerprint());
    expect(b.build.hardpoints[0]!.parts[1].fired).toBe(a.build.hardpoints[0]!.parts[1].fired);
  });
});
