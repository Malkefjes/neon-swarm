// Level-up drafts: 3 cards from four types plus the Link card.
import { TUNING, type StatId, type WeaponId } from '../tuning';
import { allWeapons, freeSlot, linkOptions, type Build, type LinkOption } from './build';
import type { Rng } from './rng';

const DR = TUNING.draft;

export type Card =
  | { type: 'level'; weapon: WeaponId; to: number }
  | { type: 'new'; weapon: WeaponId }
  | { type: 'stat'; stat: StatId }
  | { type: 'chain'; slot: number; to: number }
  | { type: 'link'; option: LinkOption };

export const STAT_ORDER: StatId[] = ['hull', 'speed', 'power', 'rate', 'area', 'magnet'];

export interface DraftContext {
  build: Build;
  unlocked: readonly WeaponId[];
  weaponCap: number;
  linkLevel: number;
}

function cardKey(c: Card): string {
  switch (c.type) {
    case 'level':
      return `level:${c.weapon}`;
    case 'new':
      return `new:${c.weapon}`;
    case 'stat':
      return `stat:${c.stat}`;
    case 'chain':
      return `chain:${c.slot}`;
    case 'link':
      return `link:${c.option.a}:${c.option.b}`;
  }
}

/** Every non-Link card that could be offered right now, grouped by type. */
export function cardPool(ctx: DraftContext): Record<'level' | 'new' | 'stat' | 'chain', Card[]> {
  const b = ctx.build;
  const owned = allWeapons(b);
  const level: Card[] = [];
  for (const w of owned) if (w.level < ctx.weaponCap) level.push({ type: 'level', weapon: w.id, to: w.level + 1 });
  const nw: Card[] = [];
  if (freeSlot(b) >= 0) {
    for (const id of ctx.unlocked) if (!owned.some((w) => w.id === id)) nw.push({ type: 'new', weapon: id });
  }
  const stat: Card[] = [];
  for (const s of STAT_ORDER) {
    const def = TUNING.stats[s];
    const v = s === 'hull' ? b.maxHull : b.stats[s];
    if (v + def.step <= def.cap + 1e-9) stat.push({ type: 'stat', stat: s });
  }
  const chain: Card[] = [];
  b.hardpoints.forEach((c, slot) => {
    if (c && c.parts.length >= 2 && c.level < TUNING.links.maxChainLevel) chain.push({ type: 'chain', slot, to: c.level + 1 });
  });
  return { level, new: nw, stat, chain };
}

/**
 * Build one draft. `withLink` puts a Link card in the first slot; the remaining
 * slots are drawn by type weight, never repeating a card.
 */
export function makeDraft(ctx: DraftContext, rng: Rng, withLink: boolean): Card[] {
  const cards: Card[] = [];
  if (withLink) {
    const opts = linkOptions(ctx.build, ctx.linkLevel);
    if (opts.length) cards.push({ type: 'link', option: opts[rng.int(opts.length)] });
  }
  const pool = cardPool(ctx);
  const weights: Record<keyof typeof pool, number> = {
    level: DR.weights.weaponLevel,
    new: DR.weights.newWeapon,
    stat: DR.weights.statBoost,
    chain: DR.weights.chainLevel,
  };
  const types = ['level', 'new', 'stat', 'chain'] as const;
  const seen = new Set(cards.map(cardKey));
  while (cards.length < DR.cards) {
    let total = 0;
    for (const t of types) if (pool[t].length) total += weights[t];
    if (total <= 0) break;
    let r = rng.next() * total;
    let pick: (typeof types)[number] = types[0];
    for (const t of types) {
      if (!pool[t].length) continue;
      pick = t;
      r -= weights[t];
      if (r < 0) break;
    }
    const list = pool[pick];
    const card = list.splice(rng.int(list.length), 1)[0];
    const key = cardKey(card);
    if (seen.has(key)) continue;
    seen.add(key);
    cards.push(card);
  }
  return cards;
}
