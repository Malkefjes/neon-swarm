// Fast simulated runs with the autopilot, compared against the design's checkpoints.
//   npm run sim -- --runs 20 --seconds 900 --seed 1
import { runBot } from '../src/sim/bot';
import { World } from '../src/sim/world';
import { TUNING, type BiomeId, type FrameId } from '../src/tuning';

const args = process.argv.slice(2);
function arg(name: string, def: number): number {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : def;
}
const runs = arg('runs', 10);
const seconds = arg('seconds', 900);
const seed0 = arg('seed', 1);
function sarg(name: string, def: string): string {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
}
// --all-weapons: all 10 weapons unlocked (default: the starting 6)
const weapons = args.includes('--all-weapons') ? TUNING.codexOrder : TUNING.startingWeapons;
const frame = sarg('frame', 'vanguard') as FrameId;
const biome = sarg('biome', 'station') as BiomeId;
const threat = arg('threat', 0);

// Balance targets from docs/game-design.md (level at time, +-3)
const CHECKPOINTS = [
  { t: 180, level: 12 },
  { t: 450, level: 23 },
  { t: 900, level: 41 },
];

interface Result {
  seed: number;
  levels: (number | null)[];
  xpLevels: (number | null)[];
  xp: (number | null)[];
  end: number;
  level: number;
  kills: number;
  died: boolean;
  won: boolean;
  surgeBreaks: number[];
  links: string[];
  ms: number;
}

const results: Result[] = [];
const linkPairs: Set<string>[] = [];
for (let r = 0; r < runs; r++) {
  const seed = seed0 + r;
  const w = new World({ seed, weapons, frame, biome, threat });
  if (args.includes('--god')) w.dev({ cmd: 'god', on: true });
  const levels: (number | null)[] = CHECKPOINTS.map(() => null);
  const xpLevels: (number | null)[] = CHECKPOINTS.map(() => null);
  const xp: (number | null)[] = CHECKPOINTS.map(() => null);
  const surgeBreaks: number[] = [];
  const t0 = performance.now();
  runBot(w, seconds, (wd) => {
    CHECKPOINTS.forEach((c, i) => {
      if (levels[i] === null && wd.time >= c.t) {
        levels[i] = wd.level;
        xpLevels[i] = wd.level - wd.cacheLevels;
        xp[i] = wd.xpEarned;
      }
    });
    for (const ev of wd.events) if (ev.type === 'overflow') surgeBreaks.push(+ev.breakTime.toFixed(1));
  });
  const won = w.won;
  const links = w.build.hardpoints.filter((c) => c && c.parts.length > 1).map((c) => c!.parts.map((p) => p.weapon.id).join('>'));
  linkPairs.push(new Set(w.build.hardpoints.filter((c) => c && c.parts.length > 1).flatMap((c) => c!.parts.slice(1).map((p, i) => `${c!.parts[i].weapon.id}>${p.weapon.id}`))));
  results.push({
    seed,
    levels,
    xpLevels,
    xp,
    end: +w.time.toFixed(1),
    level: w.level,
    kills: w.kills,
    died: w.dead,
    won,
    surgeBreaks,
    links,
    ms: Math.round(performance.now() - t0),
  });
}

const fmt = (v: number | null) => (v === null ? '  -' : String(v).padStart(3));
// Checkpoints compare the XP level (levels from XP, without Overflow Cache levels): see DECISIONS.md
console.log('seed | XP level (shown level, XP) at ' + CHECKPOINTS.map((c) => `${c.t}s [${c.level}]`).join(', ') + ' | end s  lvl  kills result | surge breaks (s) | links');
for (const r of results) {
  const cp = CHECKPOINTS.map((_, i) => `${fmt(r.xpLevels[i])} (${fmt(r.levels[i])}, ${r.xp[i] ?? '-'})`).join('  ');
  console.log(
    `${String(r.seed).padStart(4)} | ${cp} | ${String(r.end).padStart(6)} ${fmt(r.level)} ${String(r.kills).padStart(6)} ${r.won ? 'WON ' : r.died ? 'died' : 'time'} | ${r.surgeBreaks.join(',')} | ${r.links.join(' ')}`,
  );
}
let allOk = true;
CHECKPOINTS.forEach((c, i) => {
  const vals = results.map((r) => r.xpLevels[i]).filter((v): v is number => v !== null);
  if (!vals.length) return;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const within = vals.filter((v) => Math.abs(v - c.level) <= 3).length;
  if (within < vals.length) allOk = false;
  console.log(`checkpoint ${c.t}s: mean XP level ${mean.toFixed(1)} (target ${c.level} +-3), ${within}/${vals.length} runs within`);
});
const breaks = results.flatMap((r) => r.surgeBreaks);
if (breaks.length) {
  const inBand = breaks.filter((b) => b >= 8 && b <= 20).length;
  const slow = breaks.filter((b) => b > 25).length;
  console.log(`surge breaks: ${inBand}/${breaks.length} in 8-20 s, ${slow} over 25 s`);
}
// Build variety: how many builds each Link (ordered pair) appears in
const freq = new Map<string, number>();
for (const set of linkPairs) for (const p of set) freq.set(p, (freq.get(p) ?? 0) + 1);
const top = [...freq.entries()].sort((a, b) => b[1] - a[1]);
if (top.length) {
  const share = top[0][1] / results.length;
  console.log(`links: ${freq.size} different in ${results.length} builds; most common ${top.slice(0, 5).map(([p, n]) => `${p} ${n}`).join(', ')} (max share ${(share * 100).toFixed(0)}%)`);
  if (args.includes('--check-variety') && share > 0.2) allOk = false;
}
const done = results.filter((r) => r.won || r.died).length;
console.log(`runs: ${results.filter((r) => r.won).length} won, ${results.filter((r) => r.died).length} died, ${results.length - done} still running at the time limit`);
if (args.includes('--check')) process.exit(allOk ? 0 : 1);
