// Milestone 1 checks against a deployed build (or a local `vite preview`).
//   node tools/m1-check.mjs https://malkefjes.github.io/neon-swarm/ [outDir]
// Needs Playwright with Chromium: set PLAYWRIGHT to its module path if it isn't installed locally.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT ?? 'playwright');
const base = process.argv[2] ?? 'http://localhost:4173/';
const out = process.argv[3] ?? 'm1-check';
mkdirSync(out, { recursive: true });

// Headless Chromium has no GPU here, so WebGL runs on SwiftShader (software).
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];
async function newPage(small = false) {
  const context = await browser.newContext({ viewport: small ? { width: 960, height: 540 } : { width: 1280, height: 720 } });
  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return page;
}
const results = {};

// 1. Cold load to first input
{
  const page = await newPage();
  const t0 = Date.now();
  await page.goto(base);
  await page.waitForSelector('#title:not([hidden])');
  await page.keyboard.press('Space');
  await page.waitForSelector('#title', { state: 'hidden' });
  results.loadToFirstInputMs = Date.now() - t0;
  await page.close();
}

// 2. Frame time: 800 enemies + Pulse -> Tesla cascade (CL5, Rate cap, every roll succeeds)
{
  const page = await newPage();
  const cdp = await page.context().newCDPSession(page);
  for (const [label, link] of [
    ['pulse>tesla', 'pulse>tesla:5'],
    ['tesla>pulse', 'tesla>pulse:5'],
  ]) {
    await page.goto(`${base}?dev&autostart=1&link=${link}&bench=800&stress=1&stat=rate:2&seed=1`);
    await page.waitForTimeout(3000);
    await page.evaluate(() => window.neon.resetStats());
    await page.waitForTimeout(5000);
    const raf = await page.evaluate(() => window.neon.stats());
    const cpu = {};
    for (const rate of [1, 4]) {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate });
      cpu[`x${rate}`] = await page.evaluate(() => window.neon.cpuBench(10));
    }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const load = await page.evaluate(() => {
      const w = window.neon.world;
      const p = w.build.hardpoints[0].parts[1];
      return { enemies: w.enemies.length, triggersFired: p.fired, skipped: p.skipped, seconds: +w.time.toFixed(1) };
    });
    await page.screenshot({ path: join(out, `bench-${label.replace('>', '-')}.png`) });
    results[`bench ${label}`] = { cpuFrameMs: cpu, rafFrameMsSwiftShader: { avg: +raf.frameAvg.toFixed(1), p95: raf.frameP95 }, load };
  }
  await page.close();
}

// 3. A Link changes the fight: same seed and horde, unlinked vs both orders
{
  const page = await newPage(true);
  const scenes = {
    unlinked: 'build=pulse:5,tesla:5',
    'pulse>tesla': 'link=pulse>tesla:1',
    'tesla>pulse': 'link=tesla>pulse:1',
  };
  results.link = {};
  for (const [label, q] of Object.entries(scenes)) {
    await page.goto(`${base}?dev&autostart=1&quality=low&${q}&bench=300&minutes=5&seed=2`);
    await page.waitForTimeout(2000);
    const k0 = await page.evaluate(() => window.neon.world.kills);
    await page.waitForTimeout(8000);
    await page.screenshot({ path: join(out, `link-${label.replace('>', '-')}.png`) });
    results.link[label] = await page.evaluate((k) => {
      const w = window.neon.world;
      const chain = w.build.hardpoints.find((c) => c && c.parts.length > 1);
      return { killsIn8s: w.kills - k, triggers: chain ? chain.parts[1].fired : 0, codex: [...w.codex] };
    }, k0);
  }
  await page.close();
}

// 4. Surge 1 at 1:30 in real time, and Overflow collects every core
{
  const page = await newPage(true);
  await page.goto(`${base}?dev&autostart=1&quality=low&bot=1&god=1&seed=3&build=pulse:4,tesla:4`);
  const t0 = Date.now();
  let overflowAt = null;
  let collected = null;
  for (;;) {
    await page.waitForTimeout(250);
    const st = await page.evaluate(() => ({
      t: window.neon.world.time,
      phase: window.neon.world.surgePhase,
      events: window.neon.events.filter((e) => ['breath', 'surge', 'overflow'].includes(e.type)).map((e) => ({ type: e.type, t: +e.t.toFixed(2), data: e.data })),
    }));
    if (st.phase === 'breath' && !results.breathShot && st.t > 84) {
      await page.screenshot({ path: join(out, 'surge-breath.png') });
      results.breathShot = true;
    }
    if (st.phase === 'surge' && !results.ringShot && st.t > 91.5) {
      await page.screenshot({ path: join(out, 'surge-ring.png') });
      results.ringShot = true;
    }
    const ov = st.events.find((e) => e.type === 'overflow');
    if (ov && overflowAt === null) {
      overflowAt = ov.t;
      await page.screenshot({ path: join(out, 'surge-overflow.png') });
    }
    if (overflowAt !== null && st.t > overflowAt + 4) {
      collected = await page.evaluate(() => window.neon.overflowCoresLeft());
      results.surge = { events: st.events.map(({ type, t, data }) => ({ type, t, ...(data.size ? { size: data.size } : {}), ...(data.breakTime ? { breakTime: +data.breakTime.toFixed(2) } : {}) })), coresAtBreak: collected.atBreak, coresLeft4sLater: collected.left };
      break;
    }
    if (Date.now() - t0 > 300000) {
      results.surge = { timeout: st };
      break;
    }
  }
  await page.close();
}

results.consoleErrors = errors;
console.log(JSON.stringify(results, null, 2));
await browser.close();

// Pass/fail per milestone 1 check
const bench = results['bench pulse>tesla'];
const ev = (type) => results.surge?.events?.find((e) => e.type === type);
const checks = {
  'load to first input < 10 s': results.loadToFirstInputMs < 10000,
  '800 enemies + Pulse>Tesla cascade: CPU frame p95 <= 16.7 ms': bench.load.enemies >= 790 && bench.load.triggersFired > 0 && bench.cpuFrameMs.x1.frameP95 <= 16.7,
  'a Link changes the fight': ['pulse>tesla', 'tesla>pulse'].every(
    (k) => results.link[k].triggers > 0 && results.link[k].codex.includes(k) && results.link[k].killsIn8s !== results.link.unlinked.killsIn8s,
  ),
  'Surge 1 arrives at 1:30 (Breath at 1:20)': !!ev('surge') && Math.abs(ev('surge').t - 90) < 0.1 && !!ev('breath') && Math.abs(ev('breath').t - 80) < 0.1,
  'Overflow collects every core': !!ev('overflow') && results.surge.coresAtBreak > 0 && results.surge.coresLeft4sLater === 0,
  'no console errors': errors.length === 0,
};
for (const [name, ok] of Object.entries(checks)) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
