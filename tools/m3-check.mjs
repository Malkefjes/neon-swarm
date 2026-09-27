// Milestone 3 checks against a deployed build (or a local `vite preview`).
//   node tools/m3-check.mjs https://malkefjes.github.io/neon-swarm/ [outDir]
// The build-variety check is `npm run sim -- --runs 20 --seconds 910 --god --all-weapons --check-variety`.
// Needs Playwright with Chromium: set PLAYWRIGHT to its module path if it isn't installed locally.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const { chromium } = await import(process.env.PLAYWRIGHT ?? 'playwright');
const base = process.argv[2] ?? 'http://localhost:4173/';
const out = process.argv[3] ?? 'm3-check';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];
async function newPage(w = 960, h = 540) {
  const context = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return page;
}
const results = {};
const checks = {};

// 1. All 90 ordered pairs of the 10 weapons trigger correctly
{
  const page = await newPage();
  const weapons = ['pulse', 'arc', 'tesla', 'seeker', 'blades', 'mortar', 'cryo', 'ion', 'rail', 'singularity'];
  const pairs = {};
  for (const h of weapons) {
    for (const t of weapons) {
      if (h === t) continue;
      await page.goto(`${base}?dev&autostart=1&quality=low&weapons=all&god=1&stress=1&seed=3&link=${h}>${t}:5&bench=80&minutes=5`);
      await page.waitForFunction(() => window.neon && window.neon.world.tick > 10, null, { timeout: 60000 });
      let soloTail = 0;
      let froze = 0;
      for (let i = 0; i < 12; i++) {
        await page.waitForTimeout(250);
        const r = await page.evaluate((tail) => {
          const w = window.neon.world;
          let n = 0;
          for (const list of [w.bolts, w.missiles, w.shells, w.zones, w.mines, w.singularities]) for (const fx of list) if (fx.src.weapon === tail && !fx.src.triggered && !fx.shard) n++;
          for (const a of w.arcs) if (a.weapon === tail && !a.triggered) n++;
          for (const r of w.rings) if (r.weapon === tail && !r.triggered) n++;
          if (tail === 'rail') for (const r of w.rails) if (!r.triggered) n++;
          if (tail === 'blades') n += w.soloBlades.length;
          if (tail === 'cryo') n += w.cones.length;
          return { n, froze: tail === 'cryo' ? w.freezes.length : 0 };
        }, t);
        soloTail += r.n;
        froze += r.froze;
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
      const effect = t === 'cryo' ? froze > 0 : r.tailDamage > 0;
      const ok = r.order === `${h}>${t}` && r.logged && r.otherPairs.length === 0 && r.headDamage > 0 && r.triggers > 0 && effect && soloTail === 0;
      pairs[`${h}>${t}`] = { ok, ...r, soloTail, froze };
    }
  }
  results.pairsFailed = Object.entries(pairs).filter(([, v]) => !v.ok);
  results.pairsPassed = Object.values(pairs).filter((v) => v.ok).length;
  checks['all 90 ordered pairs trigger correctly'] = Object.values(pairs).length === 90 && results.pairsPassed === 90;
  await page.close();
}

// 2. Enemies read by silhouette with 500+ on screen; screenshots of every biome, boss and weapon effect
{
  const page = await newPage(1280, 720);
  const shots = {
    'silhouettes-station': '?dev&autostart=1&god=1&seed=4&bench=600&mixed=1&minutes=3&build=pulse:1',
    'silhouettes-moon': '?dev&autostart=1&god=1&seed=4&biome=moon&bench=600&mixed=1&minutes=3&build=pulse:1',
    'weapons-1': '?dev&autostart=1&god=1&seed=6&weapons=all&build=cryo:4,ion:5,rail:5,singularity:5&bench=250&minutes=6',
    'weapons-2': '?dev&autostart=1&god=1&seed=6&weapons=all&link=seeker>tesla>mortar:5&build=blades:5,arc:5&bench=250&minutes=6',
    'brood-mother': '?dev&autostart=1&god=1&seed=4&boss=brood&build=pulse:5,tesla:5',
    'overmind': '?dev&autostart=1&god=1&seed=4&biome=moon&boss=overmind&build=pulse:5,seeker:5',
    'elites-pickups': '?dev&autostart=1&god=1&seed=4&elite=1&build=pulse:5,mortar:5',
  };
  results.visual = {};
  for (const [name, q] of Object.entries(shots)) {
    await page.goto(base + q);
    await page.waitForFunction(() => window.neon && window.neon.screen === 'run' && window.neon.world.tick > 30, null, { timeout: 120000 });
    await page.waitForTimeout(4000);
    await page.screenshot({ path: join(out, `${name}.png`) });
    results.visual[name] = await page.evaluate(() => {
      const w = window.neon.world;
      // Enemies inside the view (screen-space offset from the camera within the 30 x 17 view)
      const R = { x: Math.SQRT1_2, z: -Math.SQRT1_2 };
      const U = { x: -Math.SQRT1_2, z: -Math.SQRT1_2 };
      const f = Math.sin((35 * Math.PI) / 180);
      let onScreen = 0;
      const kinds = {};
      for (const e of w.enemies) {
        const ox = e.x - w.camX;
        const oz = e.z - w.camZ;
        const sx = ox * R.x + oz * R.z;
        const sy = (ox * U.x + oz * U.z) * f;
        if (Math.abs(sx) <= 15 && Math.abs(sy) <= 8.5) {
          onScreen++;
          kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
        }
      }
      return { onScreen, kinds, modelLoaded: window.neon.modelLoaded };
    });
  }
  const sil = ['silhouettes-station', 'silhouettes-moon'].map((k) => results.visual[k]);
  checks['500+ enemies on screen, all five kinds (screenshots for the silhouette read)'] = sil.every((v) => v.onScreen >= 500 && Object.keys(v.kinds).length === 5);
  checks['player model loaded before play (no stand-in frame)'] = Object.values(results.visual).every((v) => v.modelLoaded);
  await page.close();
}

// 3. Pre-run choices reach the run: frame, biome, Threat, Endless
{
  const page = await newPage();
  await page.goto(`${base}?dev&autostart=1&quality=low&frame=colossus&biome=moon&threat=10&endless=1&seed=2`);
  await page.waitForFunction(() => window.neon && window.neon.screen === 'run', null, { timeout: 60000 });
  results.setup = await page.evaluate(() => {
    const w = window.neon.world;
    return { frame: w.frame, biome: w.biome, threat: w.threat, endless: w.endless, hardpoints: w.build.hardpoints.length, maxHull: w.build.maxHull };
  });
  checks['frame, biome, Threat and Endless reach the run'] =
    results.setup.frame === 'colossus' && results.setup.biome === 'moon' && results.setup.threat === 10 && results.setup.endless && results.setup.hardpoints === 3 && results.setup.maxHull === 60;
  await page.close();
}

results.consoleErrors = errors;
checks['no console errors'] = errors.length === 0;
console.log(JSON.stringify(results, null, 2));
await browser.close();
for (const [name, ok] of Object.entries(checks)) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
