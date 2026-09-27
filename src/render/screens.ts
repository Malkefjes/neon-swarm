// Menu screens: Hangar (frame select, unlocks), Link Codex, run summary.
import { TUNING, type AnyWeaponId, type BiomeId, type FrameId } from '../tuning';
import { UNLOCKS, frameUnlocked, maxThreat, weaponUnlocked, type Profile, type UnlockId } from '../meta';
import type { World } from '../sim/world';
import { chainHtml, fmtTime, icon, wshort } from './hud';

const $ = (id: string) => document.getElementById(id)!;

export const FRAME_ORDER: FrameId[] = ['vanguard', 'spark', 'colossus'];
const FRAMES: Record<FrameId, { rule: string; unlock: UnlockId | null }> = {
  vanguard: { rule: '4 hardpoints; the baseline', unlock: null },
  spark: { rule: 'Links open at L3, but weapons cap at L4', unlock: 'spark' },
  colossus: { rule: '3 hardpoints and 30% slower, but every trigger fires twice', unlock: 'colossus' },
};

export function renderHangar(p: Profile, sel: FrameId): void {
  const frames = FRAME_ORDER.map((id) => {
    const f = FRAMES[id];
    const def = TUNING.frames[id];
    const unlocked = frameUnlocked(p, id);
    const feat = UNLOCKS.find((u) => u.id === f.unlock)?.feat;
    const state = unlocked ? '' : `<p>Locked: ${feat}</p>`;
    const cls = `frame${id === sel ? ' sel' : ''}${unlocked ? '' : ' locked'}`;
    return `<div class="${cls}" data-frame="${id}"><h3>${def.name}</h3><p>${f.rule}</p><p>Starts with ${TUNING.weaponInfo[def.startWeapon].name}</p><p class="no">Hull ${def.hull} · Speed ${def.speed}</p>${state}</div>`;
  }).join('');
  const unlocks = UNLOCKS.map((u) => {
    const ok = p.unlocks.includes(u.id);
    return `<div class="${ok ? 'ok' : 'no'}">${ok ? '&#10003;' : '&#9675;'} ${u.name} <span class="no">— ${u.feat}</span></div>`;
  }).join('');
  const found = Object.keys(p.codex).length;
  $('hangar-panel').innerHTML =
    `<h2>HANGAR</h2>` +
    `<div class="frames">${frames}</div>` +
    `<div class="unlocks">${unlocks}</div>` +
    `<p class="no" style="text-align:center">Codex ${found} / 90 Links &nbsp; Runs ${p.runs} &nbsp; Wins ${p.wins} &nbsp; Best Threat won ${p.threatWon < 0 ? '—' : p.threatWon}</p>` +
    `<p class="go" style="text-align:center"><kbd>&larr;</kbd><kbd>&rarr;</kbd> frame &nbsp; <kbd>Enter</kbd> continue &nbsp; <kbd>C</kbd> Codex</p>`;
}

export interface Setup {
  frame: FrameId;
  biome: BiomeId;
  threat: number;
  endless: boolean;
}

const THREAT_TEXT = [
  'No modifiers',
  'Enemies +15% speed',
  'Elites every 45 s',
  'Surges +25% size',
  'Repair Kits drop half as often',
  'Spitters from 0:00, globs +50% speed',
  'Enemy HP +30%, bosses included',
  'Breaking a Surge no longer heals',
  'Brood Mother spawns Splitters, Overmind fires 5 beams',
  'Every Surge includes Carapaces',
  'Max Hull 60',
];

/** Pre-run: biome, Threat Level and mode. Rows: 0 biome, 1 threat, 2 mode. */
export function renderPrerun(p: Profile, s: Setup, row: number): void {
  const moon = p.unlocks.includes('moon');
  const endless = p.unlocks.includes('endless');
  const opt = (label: string, on: boolean, locked: boolean) => `<span class="opt${on ? ' on' : ''}${locked ? ' locked' : ''}">${label}</span>`;
  const rows = [
    `<div class="row${row === 0 ? ' sel' : ''}"><span class="lbl">BIOME</span>${opt('Orbital Station Deck', s.biome === 'station', false)}${opt(moon ? 'Crystal Mining Moon' : 'Crystal Mining Moon — win on the Station', s.biome === 'moon', !moon)}</div>`,
    `<div class="row${row === 1 ? ' sel' : ''}"><span class="lbl">THREAT</span><span class="opt on">${s.threat}</span><span class="no">${s.threat ? 'Adds: ' + THREAT_TEXT[s.threat] : THREAT_TEXT[0]} (up to ${maxThreat(p)})</span></div>`,
    `<div class="row${row === 2 ? ' sel' : ''}"><span class="lbl">MODE</span>${opt('15 minutes', !s.endless, false)}${opt(endless ? 'Endless' : 'Endless — win once', s.endless, !endless)}</div>`,
  ];
  $('prerun-panel').innerHTML =
    `<h2>DEPLOY ${TUNING.frames[s.frame].name}</h2><div class="prerun">${rows.join('')}</div>` +
    `<p class="go" style="text-align:center"><kbd>&uarr;</kbd><kbd>&darr;</kbd> choose &nbsp; <kbd>&larr;</kbd><kbd>&rarr;</kbd> change &nbsp; <kbd>Enter</kbd> deploy &nbsp; <kbd>Esc</kbd> back</p>`;
}

/** Change the selected pre-run row by dir (-1 / +1), within what's unlocked. */
export function changeSetup(p: Profile, s: Setup, row: number, dir: number): void {
  if (row === 0 && p.unlocks.includes('moon')) s.biome = s.biome === 'station' ? 'moon' : 'station';
  if (row === 1) s.threat = Math.max(0, Math.min(maxThreat(p), s.threat + dir));
  if (row === 2 && p.unlocks.includes('endless')) s.endless = !s.endless;
}

export function renderCodex(p: Profile): void {
  const ids = TUNING.codexOrder;
  let html = `<div class="h"></div>`;
  for (const t of ids) html += `<div class="h">${icon(t)}${wshort(t)}</div>`;
  for (const h of ids) {
    html += `<div class="h" style="justify-content:flex-start">${icon(h)}${wshort(h)}</div>`;
    for (const t of ids) {
      if (h === t) {
        html += `<div class="c self"></div>`;
        continue;
      }
      const key = `${h}>${t}`;
      if (key in p.codex) {
        html += `<div class="c found" title="${key}"><span class="pair">${icon(h)}${icon(t)}</span>${p.codex[key]}</div>`;
      } else if (weaponUnlocked(p, h) && weaponUnlocked(p, t)) {
        html += `<div class="c dim"></div>`;
      } else html += `<div class="c"></div>`;
    }
  }
  const apex = Object.entries(p.apex)
    .map(([k, v]) => `<div>${chainHtml(k.split('>') as AnyWeaponId[])} — best ${v} kills</div>`)
    .join('');
  $('codex-panel').innerHTML =
    `<h2>LINK CODEX</h2><p class="no" style="text-align:center">${Object.keys(p.codex).length} / 90 discovered. Rows: head, columns: tail. Dashed cells are Links you can make now.</p>` +
    `<div class="codex-grid">${html}</div>` +
    `<h4 style="margin-top:14px">APEX CHAINS</h4>${apex || '<p class="no">None yet</p>'}` +
    `<p class="go" style="text-align:center"><kbd>Esc</kbd> back</p>`;
}

export function renderSummary(w: World, newPairs: string[], newUnlocks: UnlockId[]): void {
  const chains = w.build.hardpoints
    .filter((c) => c)
    .map((c) => `<div>${chainHtml(c!.parts.map((p) => p.weapon.id))}${c!.parts.length > 1 ? ` <span class="no">CL${c!.level}</span>` : ''}</div>`)
    .join('');
  const dmg = [...w.chainDamage.entries()].sort((a, b) => b[1] - a[1]);
  const max = dmg.length ? dmg[0][1] : 1;
  const live = new Set(w.build.hardpoints.filter((c) => c).map((c) => c!.parts.map((p) => p.weapon.id).join('>')));
  const rows = dmg
    .map(
      ([k, v]) =>
        `<div class="chainrow"><span class="name">${chainHtml(k.split('>') as AnyWeaponId[])}${live.has(k) ? '' : ' <span class="no">(before Link)</span>'}</span>` +
        `<span class="bar" style="width:${Math.max(2, (v / max) * 180).toFixed(0)}px"></span><span class="num">${Math.round(v).toLocaleString()}</span></div>`,
    )
    .join('');
  const codex = newPairs.length
    ? newPairs.map((p) => `<div class="new">${chainHtml(p.split('>') as AnyWeaponId[])}</div>`).join('')
    : '<div class="no">None</div>';
  const unlocks = newUnlocks.length
    ? newUnlocks.map((u) => `<div class="new">${UNLOCKS.find((x) => x.id === u)!.name}</div>`).join('')
    : '<div class="no">None</div>';
  $('over-panel').innerHTML =
    `<h2>${w.won ? 'OVERMIND DESTROYED' : w.endless && w.overmindKilled ? 'ENDLESS — HULL 0' : 'HULL 0'}</h2>` +
    `<p style="text-align:center">${TUNING.frames[w.frame].name} &nbsp; ${w.biome === 'moon' ? 'Crystal Mining Moon' : 'Orbital Station'} &nbsp; Threat ${w.threat}${w.endless ? ' &nbsp; Endless' : ''}</p>` +
    `<p style="text-align:center">${fmtTime(w.time)} &nbsp; L${w.level} &nbsp; ${w.kills.toLocaleString()} kills &nbsp; ${w.linksMade} Links</p>` +
    `<div class="summary-cols"><div><h4>FINAL BUILD</h4><div class="chains">${chains}</div></div>` +
    `<div><h4>NEW CODEX ENTRIES</h4>${codex}<h4>UNLOCKS EARNED</h4>${unlocks}</div></div>` +
    `<h4>DAMAGE PER CHAIN</h4><div class="chains">${rows || '<div class="no">None</div>'}</div>` +
    `<p class="go" style="text-align:center"><kbd>Enter</kbd> Deploy again &nbsp; <kbd>H</kbd> Hangar</p>`;
}
