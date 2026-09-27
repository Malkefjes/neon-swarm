// Fast simulated runs with the autopilot, compared against the design's checkpoints.
//   npm run sim -- --runs 20 --seconds 900 --seed 1
import { runBot } from '../src/sim/bot';
import { World } from '../src/sim/world';

const args = process.argv.slice(2);
function arg(name: string, def: number): number {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : def;
}
const runs = arg('runs', 10);
const seconds = arg('seconds', 900);
const seed0 = arg('seed', 1);

// Balance targets from docs/game-design.md (level at time, +-3)
const CHECKPOINTS = [
  { t: 180, level: 12 },
  { t: 450, level: 23 },
  { t: 900, level: 41 },
];

interface Result {
  seed: number;
  levels: (number | null)[];
  end: number;
  level: number;
  kills: number;
  died: boolean;
  surgeBreaks: number[];
  links: string[];
  ms: number;
}

const results: Result[] = [];
for (let r = 0; r < runs; r++) {
  const seed = seed0 + r;
  const w = new World({ seed });
  const levels: (number | null)[] = CHECKPOINTS.map(() => null);
  const surgeBreaks: number[] = [];
  const t0 = performance.now();
  runBot(w, seconds, (wd) => {
    CHECKPOINTS.forEach((c, i) => {
      if (levels[i] === null && wd.time >= c.t) levels[i] = wd.level;
    });
    for (const ev of wd.events) if (ev.type === 'overflow') surgeBreaks.push(+ev.breakTime.toFixed(1));
  });
  const links = w.build.hardpoints.filter((c) => c && c.parts.length > 1).map((c) => c!.parts.map((p) => p.weapon.id).join('>'));
  results.push({
    seed,
    levels,
    end: +w.time.toFixed(1),
    level: w.level,
    kills: w.kills,
    died: w.dead,
    surgeBreaks,
    links,
    ms: Math.round(performance.now() - t0),
  });
}

const fmt = (v: number | null) => (v === null ? '  -' : String(v).padStart(3));
console.log('seed | ' + CHECKPOINTS.map((c) => `L@${c.t}s(${c.level})`).join(' ') + ' | end(s) lvl kills died | surge break s | links | ms');
for (const r of results) {
  console.log(
    `${String(r.seed).padStart(4)} | ${r.levels.map(fmt).join('        ')}        | ${String(r.end).padStart(6)} ${fmt(r.level)} ${String(r.kills).padStart(5)} ${r.died ? 'yes ' : 'no  '} | ${r.surgeBreaks.join(',')} | ${r.links.join(' ')} | ${r.ms}`,
  );
}
CHECKPOINTS.forEach((c, i) => {
  const vals = results.map((r) => r.levels[i]).filter((v): v is number => v !== null);
  if (!vals.length) return;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const within = vals.filter((v) => Math.abs(v - c.level) <= 3).length;
  console.log(`checkpoint ${c.t}s: mean level ${mean.toFixed(1)} (target ${c.level} +-3), ${within}/${vals.length} within`);
});
