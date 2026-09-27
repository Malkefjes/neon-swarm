// Developer tools, hidden from normal play. Enabled with ?dev in the URL.
//   ?dev                         readout (frame time, entity counts, cascade load); ` toggles the panel
//   &seed=123                    run seed
//   &build=pulse:5,tesla:3       start with weapons at levels
//   &link=pulse>tesla:5          start with a Link (head>tail[>third]:chainLevel)
//   &stat=rate:2,power:1.5       set stats
//   &bench=800[&minutes=15]      keep 800 enemies on screen (god mode), HP as at 15:00
//   &stress=1                    every trigger roll succeeds
//   &god=1  &t=85  &surge=1  &boss=brood|overmind  &elite=1  &autostart=1
//   &bot=1                       autopilot plays the run
//   &speed=4                     run the sim 4x faster than real time
// window.neon exposes the same controls for scripting.
import { TUNING, type StatId, type WeaponId } from './tuning';
import type { DevCommand, World } from './sim/world';
import type { Renderer } from './render/renderer';

export interface FrameStats {
  frames: Float32Array;
  sim: Float32Array;
  render: Float32Array;
  n: number;
}

export function makeFrameStats(size = 600): FrameStats {
  return { frames: new Float32Array(size), sim: new Float32Array(size), render: new Float32Array(size), n: 0 };
}

export function pushFrame(s: FrameStats, frame: number, sim: number, render: number): void {
  const i = s.n % s.frames.length;
  s.frames[i] = frame;
  s.sim[i] = sim;
  s.render[i] = render;
  s.n++;
}

function percentile(arr: Float32Array, count: number, p: number): number {
  const a = Array.from(arr.subarray(0, count)).sort((x, y) => x - y);
  if (!a.length) return 0;
  return a[Math.min(a.length - 1, Math.floor(p * a.length))];
}

export function summarise(s: FrameStats, last = s.frames.length) {
  const count = Math.min(s.n, s.frames.length, last);
  const avg = (arr: Float32Array) => {
    let t = 0;
    for (let i = 0; i < count; i++) t += arr[i];
    return count ? t / count : 0;
  };
  return {
    frames: count,
    frameAvg: avg(s.frames),
    frameP95: percentile(s.frames, count, 0.95),
    frameMax: percentile(s.frames, count, 1),
    simAvg: avg(s.sim),
    simP95: percentile(s.sim, count, 0.95),
    renderAvg: avg(s.render),
    renderP95: percentile(s.render, count, 0.95),
  };
}

/** Dev commands encoded in the URL, applied at the start of a run. */
export function commandsFromUrl(params: URLSearchParams): DevCommand[] {
  const out: DevCommand[] = [];
  const build = params.get('build');
  if (build) {
    for (const part of build.split(',')) {
      const [id, lv] = part.split(':');
      if (id in TUNING.weapons) out.push({ cmd: 'grant', weapon: id as WeaponId, level: Number(lv ?? 1) });
    }
  }
  const link = params.get('link');
  if (link) {
    const [ids, cl] = link.split(':');
    const chain = ids.split('>').filter((id) => id in TUNING.weapons) as WeaponId[];
    if (chain.length >= 2) out.push({ cmd: 'link', chain, chainLevel: Number(cl ?? 1) });
  }
  const stat = params.get('stat');
  if (stat) {
    for (const part of stat.split(',')) {
      const [id, v] = part.split(':');
      if (id in TUNING.stats) out.push({ cmd: 'stat', stat: id as StatId, value: Number(v) });
    }
  }
  if (params.get('god') === '1') out.push({ cmd: 'god', on: true });
  if (params.get('stress') === '1') out.push({ cmd: 'stress', on: true });
  const t = params.get('t');
  if (t) out.push({ cmd: 'time', seconds: Number(t) });
  const bench = params.get('bench');
  if (bench) out.push({ cmd: 'bench', count: Number(bench), minutes: Number(params.get('minutes') ?? 15), mixed: params.get('mixed') === '1' });
  if (params.get('surge') === '1') out.push({ cmd: 'surge' });
  const boss = params.get('boss');
  if (boss === 'brood' || boss === 'overmind') out.push({ cmd: 'boss', kind: boss });
  if (params.get('elite') === '1') out.push({ cmd: 'elite' });
  return out;
}

export function readout(w: World, s: FrameStats): string {
  const f = summarise(s, 300);
  const lines = [
    `frame ${f.frameAvg.toFixed(2)} ms avg  ${f.frameP95.toFixed(2)} p95  ${f.frameMax.toFixed(1)} max  (${(1000 / (f.frameAvg || 1)).toFixed(0)} fps)`,
    `sim   ${f.simAvg.toFixed(2)} ms avg  ${f.simP95.toFixed(2)} p95   render ${f.renderAvg.toFixed(2)} avg  ${f.renderP95.toFixed(2)} p95`,
    `seed ${w.seed}  tick ${w.tick}  t ${w.time.toFixed(1)}s  x${w.timeScale}`,
    `enemies ${w.enemies.length}  bolts ${w.bolts.length}  arcs ${w.arcs.length}  cores ${w.cores.length}`,
    `triggered effects ${w.triggeredEffects} / ${TUNING.links.maxTriggeredEffects}` + (w.stress ? '  STRESS' : '') + (w.god ? '  GOD' : ''),
  ];
  for (const c of w.build.hardpoints) {
    if (!c || c.parts.length < 2) continue;
    const ids = c.parts.map((p) => p.weapon.id).join('>');
    const parts = c.parts
      .slice(1)
      .map(
        (p) =>
          `${p.weapon.id}: ${cascadeRate(p)}/s fired, tokens ${p.tokens.toFixed(0)}, skipped ${p.skipped}, bank +${(p.bankPower * 100).toFixed(0)}%/+${(p.bankSize * 100).toFixed(0)}%`,
      )
      .join('  ');
    lines.push(`cascade ${ids} CL${c.level}  ${parts}`);
  }
  return lines.join('\n');
}

// Triggers per second per part, sampled over the last second of real time
const rates = new WeakMap<object, { t: number; fired: number; rate: number }>();
function cascadeRate(p: { fired: number }): string {
  const now = performance.now();
  const r = rates.get(p);
  if (!r) {
    rates.set(p, { t: now, fired: p.fired, rate: 0 });
    return '0';
  }
  if (now - r.t >= 1000) {
    r.rate = ((p.fired - r.fired) * 1000) / (now - r.t);
    r.t = now;
    r.fired = p.fired;
  }
  return r.rate.toFixed(0);
}

export function buildPanel(el: HTMLElement, getWorld: () => World, restart: () => void): void {
  const weapons = TUNING.startingWeapons;
  const groups: [string, [string, () => void][]][] = [
    ['Weapons +1 level', weapons.map((id) => [TUNING.weaponInfo[id].name.split(' ')[0], () => lvl(id)] as [string, () => void])],
    [
      'Links',
      [
        ['Pulse>Tesla', () => dev({ cmd: 'link', chain: ['pulse', 'tesla'], chainLevel: 1 })],
        ['Seeker>Tesla>Mortar', () => dev({ cmd: 'link', chain: ['seeker', 'tesla', 'mortar'], chainLevel: 3 })],
        ['Blades>Arc', () => dev({ cmd: 'link', chain: ['blades', 'arc'], chainLevel: 1 })],
        ['Chain Lv +1', () => chainUp()],
      ],
    ],
    [
      'Run',
      [
        ['Surge now', () => dev({ cmd: 'surge' })],
        ['Brood Mother', () => dev({ cmd: 'boss', kind: 'brood' })],
        ['Overmind', () => dev({ cmd: 'boss', kind: 'overmind' })],
        ['Elite', () => dev({ cmd: 'elite' })],
        ['Level up', () => dev({ cmd: 'xp', amount: getWorld().xpToNext - getWorld().xp })],
        ['+100 enemies', () => dev({ cmd: 'spawn', count: 100 })],
        ['God', () => dev({ cmd: 'god', on: !getWorld().god })],
        ['Stress', () => dev({ cmd: 'stress', on: !getWorld().stress })],
        ['Rate max', () => dev({ cmd: 'stat', stat: 'rate', value: TUNING.stats.rate.cap })],
        ['Bench 800', () => dev({ cmd: 'bench', count: 800, minutes: 15 })],
        ['Skip +60 s', () => dev({ cmd: 'time', seconds: getWorld().time + 60 })],
        ['Restart', () => restart()],
      ],
    ],
  ];
  const dev = (c: DevCommand) => getWorld().dev(c);
  const lvl = (id: WeaponId) => {
    const w = getWorld();
    const cur = w.build.hardpoints.flatMap((c) => c?.parts ?? []).find((p) => p.weapon.id === id)?.weapon.level ?? 0;
    dev({ cmd: 'grant', weapon: id, level: Math.min(5, cur + 1) });
  };
  const chainUp = () => {
    const w = getWorld();
    w.build.hardpoints.forEach((c, slot) => {
      if (c && c.parts.length > 1) dev({ cmd: 'chainLevel', slot, level: Math.min(5, c.level + 1) });
    });
  };
  el.innerHTML = '<b>DEV</b> (` to hide)';
  for (const [title, buttons] of groups) {
    const h = document.createElement('h4');
    h.textContent = title;
    el.appendChild(h);
    for (const [label, fn] of buttons) {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', (e) => {
        fn();
        (e.target as HTMLElement).blur();
      });
      el.appendChild(b);
    }
  }
}

/**
 * CPU cost of one 60 Hz frame: one sim step plus building and submitting the frame,
 * sampled once per animation frame so GPU back-pressure (e.g. a software renderer)
 * stays outside the measured window. Resolves with ms percentiles.
 */
export async function cpuBench(w: World, r: Renderer, seconds: number) {
  const n = Math.round(seconds * 60);
  const sim = new Float32Array(n);
  const frame = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    await new Promise((res) => requestAnimationFrame(res));
    const t0 = performance.now();
    w.step(0, 0);
    const t1 = performance.now();
    r.render(w, 1, t1 / 1000);
    const t2 = performance.now();
    sim[i] = t1 - t0;
    frame[i] = t2 - t0;
    w.events.length = 0;
  }
  const pct = (a: Float32Array, p: number) => {
    const s = Array.from(a).sort((x, y) => x - y);
    return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2);
  };
  return {
    frames: n,
    enemies: w.enemies.length,
    simP50: pct(sim, 0.5),
    simP95: pct(sim, 0.95),
    frameP50: pct(frame, 0.5),
    frameP95: pct(frame, 0.95),
    frameMax: pct(frame, 1),
  };
}
