// A simple autopilot for simulated runs: kites away from the crowd, drifts toward
// XP, and drafts by a fixed priority. Used by tools/simulate.ts and the tests.
import type { Card } from './draft';
import { inputToGround } from './view';
import type { World } from './world';

const DIRS: [number, number][] = [
  [0, 1],
  [1, 1],
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, -1],
  [-1, 0],
  [-1, 1],
];

export function botMove(w: World): [number, number] {
  // Threat field: sum of inverse-square pushes from nearby enemies, plus a pull
  // toward the arena centre and toward the nearest core.
  let fx = 0;
  let fz = 0;
  for (const e of w.enemies) {
    const dx = w.x - e.x;
    const dz = w.z - e.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > 100) continue;
    const inv = 1 / (d2 + 0.25);
    fx += dx * inv;
    fz += dz * inv;
  }
  fx += -w.x * 0.004;
  fz += -w.z * 0.004;
  let best = Infinity;
  let cx = 0;
  let cz = 0;
  for (const c of w.cores) {
    const dx = c.x - w.x;
    const dz = c.z - w.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < best) {
      best = d2;
      cx = dx;
      cz = dz;
    }
  }
  if (best < 400) {
    // Go for XP harder when the crowd is thin
    const d = Math.sqrt(best) || 1;
    const calm = 1 / (1 + Math.hypot(fx, fz) * 4);
    fx += (cx / d) * 0.6 * calm;
    fz += (cz / d) * 0.6 * calm;
  }
  if (Math.hypot(fx, fz) < 0.02) return [0, 0];
  let pick: [number, number] = [0, 0];
  let score = -Infinity;
  for (const [mx, my] of DIRS) {
    const g = inputToGround(mx, my);
    const len = Math.hypot(g.x, g.z);
    const s = (g.x * fx + g.z * fz) / len;
    if (s > score) {
      score = s;
      pick = [mx, my];
    }
  }
  return pick;
}

function cardScore(c: Card): number {
  switch (c.type) {
    case 'link':
      return 100;
    case 'chain':
      return 60;
    case 'level':
      return 50 + c.to;
    case 'new':
      return 45;
    case 'stat':
      return c.stat === 'power' ? 30 : c.stat === 'rate' ? 29 : c.stat === 'hull' ? 25 : 20;
  }
}

export function botChoose(cards: Card[]): number {
  let best = 0;
  for (let i = 1; i < cards.length; i++) if (cardScore(cards[i]) > cardScore(cards[best])) best = i;
  return best;
}

/** Run a full simulated run with the bot until `seconds` of game time or death. */
export function runBot(w: World, seconds: number, onTick?: (w: World) => void): World {
  let guard = 0;
  while (!w.runOver && w.time < seconds && guard++ < seconds * 200) {
    if (w.draft) {
      w.choose(botChoose(w.draft), 0);
      continue;
    }
    const [mx, my] = botMove(w);
    w.step(mx, my);
    onTick?.(w);
    w.events.length = 0;
  }
  return w;
}
