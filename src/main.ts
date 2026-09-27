import './style.css';
import { TUNING } from './tuning';
import { World } from './sim/world';
import { Renderer } from './render/renderer';
import { Hud } from './render/hud';
import { renderCodex, renderHangar, renderSummary } from './render/screens';
import { buildPanel, commandsFromUrl, cpuBench, makeFrameStats, pushFrame, readout, summarise } from './dev';
import { botChoose, botMove } from './sim/bot';
import { UNLOCKS, applyCodex, applyFeat, applyRunEnd, draftWeapons, emptyProfile, loadProfile, saveProfile, type UnlockId } from './meta';

const DT = 1000 / TUNING.sim.tickRate; // ms per tick

const params = new URLSearchParams(location.search);
const devMode = params.has('dev');
const autopilot = devMode && params.get('bot') === '1';
const speed = devMode ? Math.max(1, Number(params.get('speed') ?? 1)) : 1;
const maxStepsPerFrame = 5 * speed;
const eventLog: { t: number; tick: number; type: string; data?: unknown }[] = [];
let overflowCores: object[] = [];
let benchRunning = false; // the CPU bench drives the world itself
const $ = (id: string) => document.getElementById(id)!;

type Screen = 'title' | 'hangar' | 'codex' | 'run' | 'paused' | 'over';

let profile = loadProfile();
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
let runNewPairs: string[] = [];
let runUnlocks: UnlockId[] = [];
let runSaved = false;

function makeWorld(): World {
  const seed = params.has('seed') ? Number(params.get('seed')) : (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0;
  const w = new World({ seed, weapons: draftWeapons(profile) });
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
  $('hangar').hidden = s !== 'hangar';
  $('codex').hidden = s !== 'codex';
  $('pause').hidden = s !== 'paused';
  $('over').hidden = s !== 'over';
  hud.show(s === 'run' || s === 'paused');
  if (s === 'hangar') renderHangar(profile);
  if (s === 'codex') renderCodex(profile);
}

function deploy(): void {
  world = makeWorld();
  acc = 0;
  hud.linkPending = -1;
  runNewPairs = [];
  runUnlocks = [];
  runSaved = false;
  setScreen('run');
}

/** Save progress the moment it happens, so a closed tab keeps it. */
function track(w: World): void {
  for (const ev of w.events) {
    if (ev.type === 'feat') {
      const fresh = applyFeat(profile, ev.feat);
      runUnlocks.push(...fresh);
      for (const u of fresh) hud.toast(`UNLOCKED  ${UNLOCKS.find((x) => x.id === u)!.name.toUpperCase()}`, 200);
      saveProfile(profile);
    } else if (ev.type === 'codex') {
      const r = applyCodex(profile, ev.pair);
      if (r.isNew) runNewPairs.push(ev.pair);
      runUnlocks.push(...r.unlocks);
      saveProfile(profile);
    }
  }
}

function endRun(): void {
  if (runSaved) return;
  runSaved = true;
  const apexKills = new Map<string, number>();
  for (const key of world.apexes) apexKills.set(key, world.chainKills.get(key) ?? 0);
  applyRunEnd(profile, world.pairKills, apexKills);
  saveProfile(profile);
  renderSummary(world, runNewPairs, runUnlocks);
  setScreen('over');
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

  switch (screen) {
    case 'title':
      setScreen('hangar');
      return;
    case 'hangar':
      if (e.code === 'Enter' || e.code === 'Space') deploy();
      else if (e.code === 'KeyC') setScreen('codex');
      return;
    case 'codex':
      if (e.code === 'Escape' || e.code === 'KeyC' || e.code === 'Backspace') setScreen('hangar');
      return;
    case 'over':
      if (e.code === 'Enter' || e.code === 'Space') deploy();
      else if (e.code === 'KeyH' || e.code === 'Escape') setScreen('hangar');
      return;
    case 'paused':
      if (e.code === 'Escape' || e.code === 'Tab') setScreen('run');
      else if (e.code === 'Backspace') {
        endRunSilently();
        deploy();
      }
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
  if (screen === 'run' && !autopilot) setScreen('paused');
});

/** Restarting from pause still keeps the run's Codex kill counts. */
function endRunSilently(): void {
  if (runSaved) return;
  runSaved = true;
  applyRunEnd(profile, world.pairKills, new Map());
  saveProfile(profile);
}

// ------------------------------------------------------------------ loop

function frame(now: number): void {
  const frameMs = now - lastFrame;
  lastFrame = now;
  if (benchRunning) {
    requestAnimationFrame(frame);
    return;
  }
  const t0 = performance.now();

  if (autopilot && screen === 'run' && world.draft) world.choose(botChoose(world.draft), 0);
  if (screen === 'run' && !world.draft) {
    acc += Math.min(frameMs, 250) * speed;
    let steps = 0;
    const [kx, ky] = moveInput();
    while (acc >= DT && steps < maxStepsPerFrame && !world.draft && !world.runOver) {
      // The autopilot steers every tick, like the headless simulated runs
      const [mx, my] = autopilot ? botMove(world) : [kx, ky];
      world.step(mx, my);
      acc -= DT;
      steps++;
      if (world.events.length) handleEvents();
    }
    if (steps === maxStepsPerFrame) acc = 0;
  } else {
    acc = 0;
  }
  if (world.events.length) handleEvents();
  if (screen === 'run' && world.runOver) endRun();
  const t1 = performance.now();
  renderer.render(world, world.draft || screen !== 'run' ? 1 : acc / DT, now / 1000);
  if (screen === 'run' || screen === 'paused') hud.update(world, (x, z) => renderer.toPixels(world, x, z, window.innerWidth, window.innerHeight));
  const t2 = performance.now();
  pushFrame(stats, frameMs, t1 - t0, t2 - t1);
  if (devMode && stats.n % 15 === 0) $('dev-readout').textContent = readout(world, stats) + '\n' + renderer.info();
  requestAnimationFrame(frame);
}

function handleEvents(): void {
  if (devMode) {
    for (const ev of world.events) {
      eventLog.push({ t: world.time, tick: world.tick, type: ev.type, data: ev });
      // Snapshot the cores on the ground when a Surge breaks, to verify Overflow collects them all
      if (ev.type === 'overflow') overflowCores = world.cores.slice();
    }
  }
  track(world);
  renderer.shake = Math.max(renderer.shake, hud.effects(world.events));
  world.events.length = 0;
}

if (devMode) {
  $('dev-readout').hidden = false;
  buildPanel($('dev-panel'), () => world, deploy);
  (window as unknown as Record<string, unknown>).neon = {
    get world() {
      return world;
    },
    get profile() {
      return profile;
    },
    get screen() {
      return screen;
    },
    restart: deploy,
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
    resetProfile: () => {
      profile = emptyProfile();
      saveProfile(profile);
    },
  };
}

setScreen('title');
if (devMode && params.get('autostart') === '1') deploy();
requestAnimationFrame(frame);
