// The build: hardpoints holding chains. A solo weapon is a chain of one part.
// Pure data rules for Links live here (eligibility, forming, Chain Levels, limiter).
import { TUNING, type WeaponId, type StatId } from '../tuning';

const L = TUNING.links;

export interface Weapon {
  id: WeaponId;
  level: number;
  cooldown: number; // s until the next solo shot (head only)
}

export interface Part {
  weapon: Weapon;
  // Cascade limiter: token bucket plus the bank of skipped triggers.
  tokens: number;
  bankPower: number;
  bankSize: number;
  // Counters for the dev readout and run summary.
  fired: number;
  skipped: number;
  damage: number;
}

export interface Chain {
  parts: Part[];
  /** 0 for a solo weapon, 1..5 once Linked. */
  level: number;
}

export interface Build {
  hardpoints: (Chain | null)[];
  stats: Record<StatId, number>;
  maxHull: number;
}

export function makePart(weapon: Weapon): Part {
  return { weapon, tokens: L.limiterBurst, bankPower: 0, bankSize: 0, fired: 0, skipped: 0, damage: 0 };
}

export function makeBuild(hardpoints: number, hull: number, speed: number): Build {
  const s = TUNING.stats;
  return {
    hardpoints: new Array(hardpoints).fill(null),
    stats: { hull, speed, power: s.power.base, rate: s.rate.base, area: s.area.base, magnet: s.magnet.base },
    maxHull: hull,
  };
}

export function allWeapons(b: Build): Weapon[] {
  const out: Weapon[] = [];
  for (const c of b.hardpoints) if (c) for (const p of c.parts) out.push(p.weapon);
  return out;
}

export function findWeapon(b: Build, id: WeaponId): Weapon | undefined {
  return allWeapons(b).find((w) => w.id === id);
}

export function freeSlot(b: Build): number {
  return b.hardpoints.indexOf(null);
}

/** Mount a new weapon at L1. Each weapon is owned at most once per run. */
export function addWeapon(b: Build, id: WeaponId, level = 1): Weapon | null {
  if (findWeapon(b, id)) return null;
  const slot = freeSlot(b);
  if (slot < 0) return null;
  const w: Weapon = { id, level, cooldown: 0 };
  b.hardpoints[slot] = { parts: [makePart(w)], level: 0 };
  return w;
}

export interface LinkOption {
  kind: 'pair' | 'apex';
  /** Hardpoint slots joined: for 'apex', a is the chain and b the solo weapon. */
  a: number;
  b: number;
  /** The two orders the player can pick from, as weapon id lists head -> tail. */
  orders: WeaponId[][];
}

function isSoloAtLinkLevel(c: Chain | null, linkLevel: number): c is Chain {
  return !!c && c.parts.length === 1 && c.parts[0].weapon.level >= linkLevel;
}

/** Every Link the build can make right now (parts must be at `linkLevel`). */
export function linkOptions(b: Build, linkLevel: number): LinkOption[] {
  const out: LinkOption[] = [];
  const hp = b.hardpoints;
  for (let i = 0; i < hp.length; i++) {
    for (let j = i + 1; j < hp.length; j++) {
      const ci = hp[i];
      const cj = hp[j];
      if (isSoloAtLinkLevel(ci, linkLevel) && isSoloAtLinkLevel(cj, linkLevel)) {
        const x = ci.parts[0].weapon.id;
        const y = cj.parts[0].weapon.id;
        out.push({ kind: 'pair', a: i, b: j, orders: [[x, y], [y, x]] });
      }
    }
  }
  for (let i = 0; i < hp.length; i++) {
    const chain = hp[i];
    if (!chain || chain.parts.length < 2 || chain.parts.length >= L.maxParts) continue;
    if (chain.level < L.apexMinChainLevel) continue;
    for (let j = 0; j < hp.length; j++) {
      const solo = hp[j];
      if (j === i || !isSoloAtLinkLevel(solo, linkLevel)) continue;
      const ids = chain.parts.map((p) => p.weapon.id);
      const w = solo.parts[0].weapon.id;
      out.push({ kind: 'apex', a: i, b: j, orders: [[w, ...ids], [...ids, w]] });
    }
  }
  return out;
}

/**
 * Form a Link. `order` is one of option.orders. The chain takes the first slot
 * involved and frees the other. A new pair starts at Chain Level 1; an Apex keeps
 * the Chain Level of the chain it extends.
 */
export function applyLink(b: Build, opt: LinkOption, order: WeaponId[]): Chain {
  const ca = b.hardpoints[opt.a]!;
  const cb = b.hardpoints[opt.b]!;
  const partsById = new Map<WeaponId, Part>();
  for (const p of [...ca.parts, ...cb.parts]) partsById.set(p.weapon.id, p);
  const parts = order.map((id) => {
    const p = partsById.get(id);
    if (!p) throw new Error(`weapon ${id} not in link`);
    return makePart(p.weapon);
  });
  if (parts.length > L.maxParts) throw new Error('chain too long');
  if (new Set(order).size !== order.length) throw new Error('chain repeats a weapon');
  const level = opt.kind === 'pair' ? 1 : ca.level;
  const chain: Chain = { parts, level };
  const slot = Math.min(opt.a, opt.b);
  b.hardpoints[opt.a] = null;
  b.hardpoints[opt.b] = null;
  b.hardpoints[slot] = chain;
  // The head keeps its own cooldown; linked-in parts never fire on their own.
  return chain;
}

/** Refill every limiter bucket by dt seconds. */
export function refillLimiters(b: Build, dt: number): void {
  for (const c of b.hardpoints) {
    if (!c || c.parts.length < 2) continue;
    for (let i = 1; i < c.parts.length; i++) {
      const p = c.parts[i];
      p.tokens = Math.min(L.limiterBurst, p.tokens + L.limiterRate * dt);
    }
  }
}

export interface TriggerGrant {
  power: number; // extra power fraction from the bank (0..2)
  size: number; // extra size fraction from the bank (0..0.5)
}

/**
 * Ask the limiter for one trigger on a part. Returns the bank bonus to apply, or
 * null when the trigger is skipped (and banked for the part's next trigger).
 * `capped` is true when the global triggered-effect cap is reached.
 */
export function takeTrigger(p: Part, capped: boolean): TriggerGrant | null {
  if (p.tokens >= 1 && !capped) {
    p.tokens -= 1;
    const g = { power: p.bankPower, size: p.bankSize };
    p.bankPower = 0;
    p.bankSize = 0;
    p.fired++;
    return g;
  }
  p.bankPower = Math.min(L.bankPowerCap, p.bankPower + L.bankPower);
  p.bankSize = Math.min(L.bankSizeCap, p.bankSize + L.bankSize);
  p.skipped++;
  return null;
}
