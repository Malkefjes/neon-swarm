// Meta progression: unlocks by feat, the Link Codex, and saved progress.
// Grows the menu, never the numbers. Persisted in localStorage.
import { TUNING, type AnyWeaponId, type WeaponId } from './tuning';
import type { Feat } from './sim/world';

const KEY = 'neonSwarm.profile.v1';

export type UnlockId = 'cryo' | 'ion' | 'rail' | 'singularity' | 'spark' | 'colossus' | 'moon' | 'endless';

export interface Profile {
  version: 1;
  unlocks: UnlockId[];
  /** Ordered pair "head>tail" -> best kills with that Link in one run. */
  codex: Record<string, number>;
  /** Apex chain "a>b>c" -> best kills in one run. */
  apex: Record<string, number>;
  threatWon: number; // highest Threat Level won, -1 for none
  wins: number;
  runs: number;
}

export const UNLOCKS: { id: UnlockId; name: string; feat: string }[] = [
  { id: 'cryo', name: 'Cryo Emitter', feat: 'Beat the Brood Mother' },
  { id: 'ion', name: 'Ion Mines', feat: 'Make your first Link' },
  { id: 'rail', name: 'Railgun', feat: 'Break a Surge in under 8 s' },
  { id: 'singularity', name: 'Singularity Core', feat: 'Discover 10 different Links' },
  { id: 'spark', name: 'SPARK frame', feat: 'Make 3 Links in one run' },
  { id: 'colossus', name: 'COLOSSUS frame', feat: 'Build a 3-part Apex chain' },
  { id: 'moon', name: 'Crystal Mining Moon', feat: 'Win on the Station' },
  { id: 'endless', name: 'Endless mode and Threat Level 1', feat: 'Win once' },
];

const FEAT_UNLOCKS: Partial<Record<Feat, UnlockId[]>> = {
  broodBeaten: ['cryo'],
  firstLink: ['ion'],
  fastSurge: ['rail'],
  threeLinks: ['spark'],
  apex: ['colossus'],
  win: ['moon', 'endless'],
};

export function emptyProfile(): Profile {
  return { version: 1, unlocks: [], codex: {}, apex: {}, threatWon: -1, wins: 0, runs: 0 };
}

export interface Store {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

function defaultStore(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadProfile(store: Store | null = defaultStore()): Profile {
  try {
    const raw = store?.getItem(KEY);
    if (!raw) return emptyProfile();
    const p = JSON.parse(raw) as Partial<Profile>;
    const base = emptyProfile();
    return {
      ...base,
      ...p,
      version: 1,
      unlocks: Array.isArray(p.unlocks) ? p.unlocks.filter((u) => UNLOCKS.some((x) => x.id === u)) : [],
      codex: typeof p.codex === 'object' && p.codex ? p.codex : {},
      apex: typeof p.apex === 'object' && p.apex ? p.apex : {},
    };
  } catch {
    return emptyProfile();
  }
}

export function saveProfile(p: Profile, store: Store | null = defaultStore()): void {
  try {
    store?.setItem(KEY, JSON.stringify(p));
  } catch {
    // Storage full or blocked: progress stays in memory for this session.
  }
}

function unlock(p: Profile, id: UnlockId, fresh: UnlockId[]): void {
  if (p.unlocks.includes(id)) return;
  p.unlocks.push(id);
  fresh.push(id);
}

/** Apply a feat as soon as it happens. Returns unlocks it earned. */
export function applyFeat(p: Profile, feat: Feat): UnlockId[] {
  const fresh: UnlockId[] = [];
  for (const id of FEAT_UNLOCKS[feat] ?? []) unlock(p, id, fresh);
  if (feat === 'win') {
    p.wins++;
    p.threatWon = Math.max(p.threatWon, 0);
  }
  return fresh;
}

/** Log a Link to the Codex on first trigger. Returns unlocks it earned (10 Links discovered). */
export function applyCodex(p: Profile, pair: string): { isNew: boolean; unlocks: UnlockId[] } {
  const fresh: UnlockId[] = [];
  const isNew = !(pair in p.codex);
  if (isNew) p.codex[pair] = 0;
  if (Object.keys(p.codex).length >= 10) unlock(p, 'singularity', fresh);
  return { isNew, unlocks: fresh };
}

/** End of run: keep the best kill counts per Link and Apex. */
export function applyRunEnd(p: Profile, pairKills: Map<string, number>, apexKills: Map<string, number>): void {
  p.runs++;
  for (const [pair, k] of pairKills) p.codex[pair] = Math.max(p.codex[pair] ?? 0, k);
  for (const [apex, k] of apexKills) p.apex[apex] = Math.max(p.apex[apex] ?? 0, k);
}

/** Weapons unlocked for drafting that this build implements. */
export function draftWeapons(p: Profile): WeaponId[] {
  const implemented = new Set<string>(Object.keys(TUNING.weapons));
  const out: WeaponId[] = [...TUNING.startingWeapons];
  for (const id of ['cryo', 'ion', 'rail', 'singularity'] as const) {
    if (p.unlocks.includes(id) && implemented.has(id)) out.push(id as unknown as WeaponId);
  }
  return out;
}

export function weaponUnlocked(p: Profile, id: AnyWeaponId): boolean {
  return (TUNING.startingWeapons as readonly string[]).includes(id) || p.unlocks.includes(id as UnlockId);
}

export function isImplemented(id: string): boolean {
  return id in TUNING.weapons;
}
