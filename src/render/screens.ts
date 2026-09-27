// Menu screens: Hangar (frame select, unlocks), Link Codex, run summary.
import { TUNING, type AnyWeaponId } from '../tuning';
import { UNLOCKS, weaponUnlocked, type Profile, type UnlockId } from '../meta';
import type { World } from '../sim/world';
import { chainHtml, fmtTime, icon, wshort } from './hud';

const $ = (id: string) => document.getElementById(id)!;

const FRAMES = [
  { id: 'vanguard', name: 'VANGUARD', rule: '4 hardpoints; the baseline', weapon: 'Pulse Rifle', unlock: null as UnlockId | null, ready: true },
  { id: 'spark', name: 'SPARK', rule: 'Links open at L3, weapons cap at L4', weapon: 'Tesla Chain', unlock: 'spark' as UnlockId, ready: false },
  { id: 'colossus', name: 'COLOSSUS', rule: '3 hardpoints, 30% slower, every trigger fires twice', weapon: 'Plasma Mortar', unlock: 'colossus' as UnlockId, ready: false },
];

export function renderHangar(p: Profile): void {
  const frames = FRAMES.map((f) => {
    const unlocked = !f.unlock || p.unlocks.includes(f.unlock);
    const feat = UNLOCKS.find((u) => u.id === f.unlock)?.feat;
    const state = f.ready ? '<p class="new">Ready</p>' : unlocked ? '<p>Unlocked — deploys from milestone 3</p>' : `<p>Locked: ${feat}</p>`;
    return `<div class="frame${f.ready ? ' sel' : ' locked'}"><h3>${f.name}</h3><p>${f.rule}</p><p>Starts with ${f.weapon}</p>${state}</div>`;
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
    `<p class="no" style="text-align:center">Codex ${found} / 90 Links &nbsp; Runs ${p.runs} &nbsp; Wins ${p.wins}</p>` +
    `<p class="go" style="text-align:center"><kbd>Enter</kbd> Deploy VANGUARD to the Orbital Station &nbsp; <kbd>C</kbd> Codex</p>`;
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
    `<h2>${w.won ? 'OVERMIND DESTROYED' : 'HULL 0'}</h2>` +
    `<p style="text-align:center">${fmtTime(w.time)} &nbsp; L${w.level} &nbsp; ${w.kills.toLocaleString()} kills &nbsp; ${w.linksMade} Links</p>` +
    `<div class="summary-cols"><div><h4>FINAL BUILD</h4><div class="chains">${chains}</div></div>` +
    `<div><h4>NEW CODEX ENTRIES</h4>${codex}<h4>UNLOCKS EARNED</h4>${unlocks}</div></div>` +
    `<h4>DAMAGE PER CHAIN</h4><div class="chains">${rows || '<div class="no">None</div>'}</div>` +
    `<p class="go" style="text-align:center"><kbd>Enter</kbd> Deploy again &nbsp; <kbd>H</kbd> Hangar</p>`;
}
