import './style.css';
import { TUNING } from './tuning';
import { World } from './sim/world';
import { Renderer } from './render/renderer';
import { Hud } from './render/hud';
import { buildPanel, commandsFromUrl, cpuBench, makeFrameStats, pushFrame, readout, summarise } from './dev';
import { botChoose, botMove } from './sim/bot';

const DT = 1000 / TUNING.sim.tickRate; // ms per tick
const MAX_STEPS_PER_FRAME = 5;

const params = new URLSearchParams(location.search);
const devMode = params.has('dev');
const autopilot = devMode && params.get('bot') === '1';
const eventLog: { t: number; tick: number; type: string; data?: unknown }[] = [];
let overflowCores: object[] = [];
let benchRunning = false; // the CPU bench drives the world itself
const $ = (id: string) => document.getElementById(id)!;

type Screen = 'title' | 'run' | 'paused' | 'over';

const canvas = $('view') as HTMLCanvasElement;
const renderer = new Renderer(canvas);
const hud = new Hud((i, order) => world.choose(i, order));
let world = makeWorld();
let screen: Screen = 'title';
const keys = new Set<string>();
const stats = makeFrameStats();
let acc = 0;
let lastFrame = performance.now();
let panelOpen = false;

function makeWorld(): World {
  const seed = params.has('seed') ? Number(params.get('seed')) : (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0;
  const w = new World({ seed });
  if (devMode) for (const c of commandsFromUrl(params)) w.dev(c);
  return w;
}

function resize(): void {
  renderer.resize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', resize);
resize();

function setScreen(s: Screen): void {
  screen = s;
  $('title').hidden = s !== 'title';
  $('pause').hidden = s !== 'paused';
  $('over').hidden = s !== 'over';
  hud.show(s !== 'title');
}

function restart(): void {
  world = makeWorld();
  acc = 0;
  hud.linkPending = -1;
  setScreen('run');
}

// ------------------------------------------------------------------ input

const MOVE_KEYS: Record<string, [number, number]> = {
  KeyW: [0, 1],
  ArrowUp: [0, 1],
  KeyS: [0, -1],
  ArrowDown: [0, -1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

function moveInput(): [number, number] {
  let mx = 0;
  let my = 0;
  for (const k of keys) {
    const m = MOVE_KEYS[k];
    if (m) {
      mx += m[0];
      my += m[1];
    }
  }
  return [Math.sign(mx), Math.sign(my)];
}

window.addEventListener('keydown', (e) => {
  if (['Tab', 'Backspace', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (devMode && e.code === 'Backquote') {
    panelOpen = !panelOpen;
    $('dev-panel').hidden = !panelOpen;
    return;
  }
  keys.add(e.code);
  if (e.repeat) return;

  if (screen === 'title') {
    restart();
    return;
  }
  if (screen === 'over') {
    if (e.code === 'Enter' || e.code === 'Space') restart();
    return;
  }
  if (screen === 'paused') {
    if (e.code === 'Escape' || e.code === 'Tab') setScreen('run');
    else if (e.code === 'Backspace') restart();
    return;
  }
  // In a run
  if (world.draft) {
    const n = ['Digit1', 'Digit2', 'Digit3', 'Numpad1', 'Numpad2', 'Numpad3'].indexOf(e.code);
    if (n >= 0) hud.pick(world, n % 3);
    else if (e.code === 'KeyR' && hud.linkPending < 0) world.reroll();
    else if (e.code === 'Escape' && hud.linkPending >= 0) hud.cancelLink(world);
    else if (e.code === 'Escape' || e.code === 'Tab') setScreen('paused');
    return;
  }
  if (e.code === 'Escape' || e.code === 'Tab') setScreen('paused');
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => {
  keys.clear();
  if (screen === 'run') setScreen('paused');
});

// ------------------------------------------------------------------ loop

function frame(now: number): void {
  const frameMs = now - lastFrame;
  lastFrame = now;
  const t0 = performance.now();

  if (benchRunning) {
    lastFrame = now;
    requestAnimationFrame(frame);
    return;
  }
  if (autopilot && screen === 'run' && world.draft) world.choose(botChoose(world.draft), 0);
  if (screen === 'run' && !world.draft) {
    acc += Math.min(frameMs, 250);
    let steps = 0;
    const [mx, my] = autopilot ? botMove(world) : moveInput();
    while (acc >= DT && steps < MAX_STEPS_PER_FRAME && !world.draft && !world.runOver) {
      world.step(mx, my);
      acc -= DT;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) acc = 0;
    if (world.runOver) {
      hud.showOver(world);
      setScreen('over');
    }
  } else {
    acc = 0;
  }
  if (world.events.length) {
    if (devMode) {
      for (const ev of world.events) {
        eventLog.push({ t: world.time, tick: world.tick, type: ev.type, data: ev });
        // Snapshot the cores on the ground when a Surge breaks, to verify Overflow collects them all
        if (ev.type === 'overflow') overflowCores = world.cores.slice();
      }
    }
    hud.effects(world.events);
    world.events.length = 0;
  }
  const t1 = performance.now();
  renderer.render(world, world.draft || screen !== 'run' ? 1 : acc / DT, now / 1000);
  if (screen !== 'title') hud.update(world);
  const t2 = performance.now();
  pushFrame(stats, frameMs, t1 - t0, t2 - t1);
  if (devMode && stats.n % 15 === 0) $('dev-readout').textContent = readout(world, stats) + '\n' + renderer.info();
  requestAnimationFrame(frame);
}

if (devMode) {
  $('dev-readout').hidden = false;
  buildPanel($('dev-panel'), () => world, restart);
  (window as unknown as Record<string, unknown>).neon = {
    get world() {
      return world;
    },
    restart,
    events: eventLog,
    overflowCoresLeft: () => ({ atBreak: overflowCores.length, left: overflowCores.filter((c) => world.cores.includes(c as never)).length }),
    cpuBench: (seconds = 5) => {
      benchRunning = true;
      return cpuBench(world, renderer, seconds).finally(() => (benchRunning = false));
    },
    stats: () => summarise(stats),
    resetStats: () => {
      stats.n = 0;
    },
    start: () => restart(),
  };
  if (params.get('autostart') === '1') restart();
}

setScreen(screen === 'title' && devMode && params.get('autostart') === '1' ? 'run' : screen);
requestAnimationFrame(frame);
