// A simple autopilot for simulated runs: keeps the horde inside its build's reach
// without being touched, dodges boss attacks, collects XP, and drafts by a fixed
// priority. Used by tools/simulate.ts, the tests and ?dev&bot=1.
import { len2 } from './math';
import { TUNING } from '../tuning';
import type { Card } from './draft';
import { overmindBeams } from './bosses';
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

/** How close the build needs enemies to be: the shortest reach among chain heads. */
function engageRange(w: World): number {
  let r = 12;
  for (const c of w.build.hardpoints) {
    if (!c) continue;
    const h = c.parts[0].weapon;
    const area = w.build.stats.area;
    let reach = 12;
    if (h.id === 'blades') reach = TUNING.weapons.blades.levels[h.level]!.orbit * area + 0.5;
    else if (h.id === 'arc') reach = TUNING.weapons.arc.levels[h.level]!.radius * area;
    else if (h.id === 'tesla') reach = TUNING.weapons.tesla.acquireRange;
    r = Math.min(r, reach);
  }
  return Math.max(2.2, r);
}

export function botMove(w: World): [number, number] {
  let fx = 0;
  let fz = 0;
  const engage = engageRange(w);
  // Danger: enemies about to touch the mech push hard; bosses and elites from further out.
  let nearest = Infinity;
  let nx = 0;
  let nz = 0;
  let cx = 0;
  let cz = 0;
  let cn = 0;
  for (const e of w.enemies) {
    const dx = w.x - e.x;
    const dz = w.z - e.z;
    const d = len2(dx, dz);
    const edge = Math.max(0.05, d - e.r);
    if (edge < nearest) {
      nearest = edge;
      nx = -dx;
      nz = -dz;
    }
    if (edge < 14) {
      cx += e.x;
      cz += e.z;
      cn++;
    }
    const danger = e.boss ? 5 : e.elite ? 4 : 3.2;
    if (edge > danger) continue;
    const weight = e.boss ? 8 : e.elite ? 3 : e.blocks ? 1.5 : 1;
    const f = (danger - edge) / danger;
    const k = (weight * f * f * 3) / Math.max(0.1, d);
    fx += dx * k;
    fz += dz * k;
  }
  // Surrounded (a closing ring): push out through the weakest sector
  const SECT = 16;
  const load = new Array(SECT).fill(0);
  for (const e of w.enemies) {
    const dx = e.x - w.x;
    const dz = e.z - w.z;
    const d = len2(dx, dz);
    if (d > 6 || d < 0.01) continue;
    const a = Math.floor(((Math.atan2(dz, dx) + Math.PI) / (2 * Math.PI)) * SECT) % SECT;
    load[a] += (e.hp + e.shield) * (e.blocks ? 3 : 1) / (d + 1);
  }
  const covered = load.filter((v) => v > 0).length;
  if (covered >= SECT - 3) {
    let best = 0;
    for (let i = 1; i < SECT; i++) {
      const v = load[i] + load[(i + 1) % SECT] + load[(i + SECT - 1) % SECT];
      const b = load[best] + load[(best + 1) % SECT] + load[(best + SECT - 1) % SECT];
      if (v < b) best = i;
    }
    const a = ((best + 0.5) / SECT) * 2 * Math.PI - Math.PI;
    fx += Math.cos(a) * 1.2;
    fz += Math.sin(a) * 1.2;
  }
  // Engage: close in when nothing is inside the build's reach
  if (nearest > engage * 0.8 && nearest < 30) {
    const d = len2(nx, nz) || 1;
    fx += (nx / d) * 0.5;
    fz += (nz / d) * 0.5;
  }
  // Don't sit in the middle of the crowd: drift away from its centre
  if (cn > 20) {
    const dx = w.x - cx / cn;
    const dz = w.z - cz / cn;
    const d = len2(dx, dz) || 1;
    fx += (dx / d) * 0.25;
    fz += (dz / d) * 0.25;
  }
  for (const h of w.hazards) {
    const dx = w.x - h.x;
    const dz = w.z - h.z;
    const d = len2(dx, dz) || 0.1;
    if (d > h.r + 3) continue;
    fx += (dx / d) * 2.5;
    fz += (dz / d) * 2.5;
  }
  for (const b of w.bosses) {
    if (b.kind === 'brood' && b.boss && b.boss.telegraph > 0) {
      // Sidestep the charge line
      const px = -b.boss.dirZ;
      const pz = b.boss.dirX;
      const side = (w.x - b.x) * px + (w.z - b.z) * pz >= 0 ? 1 : -1;
      fx += px * side * 3;
      fz += pz * side * 3;
    }
    if (b.kind !== 'overmind') continue;
    const dx = b.x - w.x;
    const dz = b.z - w.z;
    const d = len2(dx, dz) || 1;
    if (d > b.r + 6) {
      fx += (dx / d) * 1.2;
      fz += (dz / d) * 1.2;
    }
    // Step away from the nearest beam line
    for (const s of overmindBeams(b, w.threat)) {
      const bx = s.x2 - s.x1;
      const bz = s.z2 - s.z1;
      const l2 = bx * bx + bz * bz;
      const t = Math.max(0, Math.min(1, ((w.x - s.x1) * bx + (w.z - s.z1) * bz) / l2));
      const qx = w.x - (s.x1 + bx * t);
      const qz = w.z - (s.z1 + bz * t);
      const q = len2(qx, qz) || 0.1;
      if (q > 4) continue;
      fx += (qx / q) * (4 / (q + 0.2));
      fz += (qz / q) * (4 / (q + 0.2));
    }
  }
  // Keep off the walls and inside a collapsing arena
  const lim = TUNING.arena.halfSize - 6;
  if (Math.abs(w.x) > lim) fx -= Math.sign(w.x) * 1.5;
  if (Math.abs(w.z) > lim) fz -= Math.sign(w.z) * 1.5;
  if (w.arenaRadius < Infinity) {
    const d = len2(w.x, w.z);
    if (d > w.arenaRadius - 4) {
      fx -= (w.x / d) * 2;
      fz -= (w.z / d) * 2;
    }
  }
  // XP: every core within 12 u attracts by value / distance, more when it's calm
  const threat = len2(fx, fz);
  let gx = 0;
  let gz = 0;
  for (const c of w.cores) {
    const dx = c.x - w.x;
    const dz = c.z - w.z;
    const d = len2(dx, dz);
    if (d < 0.01 || c.state === 2) continue;
    // Near cores, and big merged cores from further away
    if (d > 12 && c.value < 25) continue;
    if (d > 60) continue;
    const k = Math.sqrt(c.value) / (d * d + 1);
    gx += dx * k;
    gz += dz * k;
  }
  for (const p of w.pickups) {
    const dx = p.x - w.x;
    const dz = p.z - w.z;
    const d = len2(dx, dz) || 1;
    if (d > 20) continue;
    gx += (dx / d) * 0.5;
    gz += (dz / d) * 0.5;
  }
  const g = len2(gx, gz);
  if (g > 0 && nearest > 2) {
    const calm = 1 / (1 + threat);
    fx += (gx / g) * 0.9 * calm;
    fz += (gz / g) * 0.9 * calm;
  }
  if (len2(fx, fz) < 0.05) return [0, 0];
  let pick: [number, number] = [0, 0];
  let score = -Infinity;
  for (const [mx, my] of DIRS) {
    const gd = inputToGround(mx, my);
    const len = len2(gd.x, gd.z);
    const sc = (gd.x * fx + gd.z * fz) / len;
    if (sc > score) {
      score = sc;
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
      return 58;
    case 'stat':
      return c.stat === 'hull' ? 32 : c.stat === 'power' ? 30 : c.stat === 'rate' ? 29 : 20;
  }
}

export function botChoose(cards: Card[]): number {
  let best = 0;
  for (let i = 1; i < cards.length; i++) if (cardScore(cards[i]) > cardScore(cards[best])) best = i;
  return best;
}

/** Which order to take a Link in: alternates with the level, so builds vary. */
export function botOrder(w: World): number {
  return w.level % 2;
}

/** Run a full simulated run with the bot until `seconds` of game time or death. */
export function runBot(w: World, seconds: number, onTick?: (w: World) => void): World {
  let guard = 0;
  while (!w.runOver && w.time < seconds && guard++ < seconds * 200) {
    if (w.draft) {
      w.choose(botChoose(w.draft), botOrder(w));
      continue;
    }
    const [mx, my] = botMove(w);
    w.step(mx, my);
    onTick?.(w);
    w.events.length = 0;
  }
  return w;
}
