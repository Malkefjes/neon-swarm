// Milestone 2 checks against a deployed build (or a local `vite preview`).
//   node tools/m2-check.mjs https://malkefjes.github.io/neon-swarm/ [outDir]
// The simulated-runs check is `npm run sim -- --runs 20 --seconds 910 --god --check`.
// Needs Playwright with Chromium: set PLAYWRIGHT to its module path if it isn't installed locally.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT ?? 'playwright');
const base = process.argv[2] ?? 'http://localhost:4173/';
const out = process.argv[3] ?? 'm2-check';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];
async function newPage(context) {
  const ctx = context ?? (await browser.newContext({ viewport: { width: 960, height: 540 } }));
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return page;
}
const results = {};
const checks = {};

// 1. All 30 ordered pairs of the 6 starting weapons trigger correctly
{
  const page = await newPage();
  const weapons = ['pulse', 'arc', 'tesla', 'seeker', 'blades', 'mortar'];
  const pairs = {};
  for (const h of weapons) {
    for (const t of weapons) {
      if (h === t) continue;
      await page.goto(`${base}?dev&autostart=1&quality=low&god=1&stress=1&seed=3&link=${h}>${t}:5&bench=80&minutes=5`);
      await page.waitForFunction(() => window.neon && window.neon.world.tick > 10);
      // Sample for ~3 s of play: the tail must only ever fire in its trigger form
      let soloTail = 0;
      for (let i = 0; i < 12; i++) {
        await page.waitForTimeout(250);
        soloTail += await page.evaluate((tail) => {
          const w = window.neon.world;
          let n = 0;
          for (const list of [w.bolts, w.missiles, w.shells, w.zones]) for (const fx of list) if (fx.src.weapon === tail && !fx.src.triggered) n++;
          for (const a of w.arcs) if (a.weapon === tail && !a.triggered) n++;
          for (const r of w.rings) if (r.weapon === tail && !r.triggered) n++;
          if (tail === 'blades') n += w.soloBlades.length;
          return n;
        }, t);
      }
      const r = await page.evaluate((pair) => {
        const w = window.neon.world;
        const c = w.build.hardpoints.find((x) => x && x.parts.length === 2);
        return {
          order: c ? c.parts.map((p) => p.weapon.id).join('>') : null,
          logged: w.codex.has(pair),
          otherPairs: [...w.codex].filter((p) => p !== pair),
          headDamage: c ? Math.round(c.parts[0].damage) : 0,
          triggers: c ? c.parts[1].fired : 0,
          tailDamage: c ? Math.round(c.parts[1].damage) : 0,
        };
      }, `${h}>${t}`);
      const ok = r.order === `${h}>${t}` && r.logged && r.otherPairs.length === 0 && r.headDamage > 0 && r.triggers > 0 && r.tailDamage > 0 && soloTail === 0;
      pairs[`${h}>${t}`] = { ok, ...r, soloTail };
    }
  }
  results.pairs = pairs;
  checks['all 30 ordered pairs trigger correctly'] = Object.values(pairs).length === 30 && Object.values(pairs).every((p) => p.ok);
  await page.close();
}

// 2. A full 15-minute run plays start to finish (autopilot, god mode, sim at 8x)
{
  const page = await newPage();
  await page.goto(`${base}?dev&autostart=1&quality=low&bot=1&god=1&seed=1&speed=8`);
  const t0 = Date.now();
  let shots = new Set();
  let st;
  for (;;) {
    await page.waitForTimeout(1000);
    st = await page.evaluate(() => ({
      screen: window.neon.screen,
      t: window.neon.world.time,
      level: window.neon.world.level,
      kills: window.neon.world.kills,
      won: window.neon.world.won,
      dead: window.neon.world.dead,
    }));
    for (const [name, at] of [['brood', 460], ['overmind', 915], ['collapse', 1060]]) {
      if (!shots.has(name) && st.t > at && st.screen === 'run') {
        shots.add(name);
        await page.screenshot({ path: join(out, `run-${name}.png`) });
      }
    }
    if (st.screen === 'over' || Date.now() - t0 > 20 * 60 * 1000) break;
  }
  await page.screenshot({ path: join(out, 'run-summary.png') });
  const summary = await page.evaluate(() => document.getElementById('over-panel').innerText);
  const events = await page.evaluate(() => {
    const keep = ['surge', 'overflow', 'boss', 'bossDown', 'win', 'death'];
    return window.neon.events.filter((e) => keep.includes(e.type)).map((e) => `${e.type}${e.data.kind ? ':' + e.data.kind : ''}@${Math.round(e.t)}`);
  });
  results.fullRun = { ...st, realSeconds: Math.round((Date.now() - t0) / 1000), events, summary: summary.split('\n').slice(0, 3).join(' | ') };
  checks['a full 15-minute run plays start to finish'] =
    st.screen === 'over' && st.t >= 900 && events.includes('boss:overmind@900') && (st.won || st.dead) && summary.includes('DAMAGE PER CHAIN');
  await page.close();
}

// 3. Unlocks survive a reload
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await newPage(context);
  // Make a Link (unlocks Ion Mines) and log it in the Codex
  await page.goto(`${base}?dev&autostart=1&quality=low&god=1&stress=1&seed=5&link=pulse>tesla:1&bench=60&minutes=2`);
  await page.waitForFunction(() => window.neon && window.neon.profile.unlocks.includes('ion') && 'pulse>tesla' in window.neon.profile.codex, null, { timeout: 30000 });
  // Reload as a normal player (no dev tools) and open the Hangar
  await page.goto(base);
  await page.waitForSelector('#title:not([hidden])');
  await page.keyboard.press('Space');
  await page.waitForSelector('#hangar:not([hidden])');
  const hangar = await page.evaluate(() => document.getElementById('hangar-panel').innerText);
  await page.screenshot({ path: join(out, 'reload-hangar.png') });
  await page.keyboard.press('KeyC');
  await page.waitForSelector('#codex:not([hidden])');
  const codex = await page.evaluate(() => document.getElementById('codex-panel').innerText);
  await page.screenshot({ path: join(out, 'reload-codex.png') });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('neonSwarm.profile.v1')));
  results.reload = { unlocks: saved.unlocks, codex: saved.codex, hangarShowsIon: /✓ Ion Mines/.test(hangar), codexCount: codex.match(/(\d+) \/ 90/)?.[1] };
  checks['unlocks survive a reload'] = saved.unlocks.includes('ion') && 'pulse>tesla' in saved.codex && results.reload.hangarShowsIon && results.reload.codexCount === '1';
  await context.close();
}

results.consoleErrors = errors;
checks['no console errors'] = errors.length === 0;
console.log(JSON.stringify(results, null, 2));
await browser.close();
for (const [name, ok] of Object.entries(checks)) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
