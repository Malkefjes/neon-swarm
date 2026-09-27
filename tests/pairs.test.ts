import { describe, expect, it } from 'vitest';
import { TUNING, type WeaponId } from '../src/tuning';
import { World } from '../src/sim/world';

const WEAPONS = TUNING.startingWeapons;
const PAIRS: [WeaponId, WeaponId][] = [];
for (const h of WEAPONS) for (const t of WEAPONS) if (h !== t) PAIRS.push([h, t]);

/** Tough, still enemies scattered around the mech. */
function arena(w: World): void {
  for (let i = 0; i < 48; i++) {
    const a = i * 2.399;
    const r = 1.4 + (i % 8) * 1.1;
    const e = w.spawnEnemy('mite', Math.cos(a) * r, Math.sin(a) * r, 0)!;
    e.hp = e.maxHp = 1e9;
    e.speed = 0;
  }
}

describe('all 30 ordered pairs of the 6 starting weapons', () => {
  it('there are 30 ordered pairs', () => expect(PAIRS).toHaveLength(30));

  for (const [h, t] of PAIRS) {
    it(`${h} -> ${t}: head hits fire the tail's trigger form; the tail never fires on its own`, () => {
      const w = new World({ seed: 3 });
      w.dev({ cmd: 'director', on: false });
      w.dev({ cmd: 'god', on: true });
      w.dev({ cmd: 'link', chain: [h, t], chainLevel: 5 });
      w.dev({ cmd: 'stress', on: true });
      arena(w);
      const chain = w.build.hardpoints.find((c) => c && c.parts.length === 2)!;
      expect(chain.parts.map((p) => p.weapon.id)).toEqual([h, t]);
      let soloTail = 0;
      for (let i = 0; i < 6 * 60; i++) {
        w.step(0, 0);
        for (const list of [w.bolts, w.missiles, w.shells, w.zones]) {
          for (const fx of list as { src: { weapon: WeaponId; triggered: boolean } }[]) {
            if (fx.src.weapon === t && !fx.src.triggered) soloTail++;
          }
        }
        for (const a of w.arcs) if (a.weapon === t && !a.triggered) soloTail++;
        for (const r of w.rings) if (r.weapon === t && !r.triggered) soloTail++;
        if (t === 'blades') soloTail += w.soloBlades.length;
      }
      expect(soloTail).toBe(0);
      expect(w.codex.has(`${h}>${t}`)).toBe(true);
      expect(chain.parts[0].damage).toBeGreaterThan(0);
      expect(chain.parts[1].fired).toBeGreaterThan(0);
      expect(chain.parts[1].damage).toBeGreaterThan(0);
      // The tail rolls for nothing: no reverse pair, nothing else logged
      expect([...w.codex]).toEqual([`${h}>${t}`]);
    });
  }
});
