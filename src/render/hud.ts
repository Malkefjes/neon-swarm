// DOM HUD, level-up cards and screen overlays.
import { TUNING, type StatId, type WeaponId } from '../tuning';
import type { Card } from '../sim/draft';
import { linkOptions } from '../sim/build';
import type { World, WorldEvent } from '../sim/world';

const $ = (id: string) => document.getElementById(id)!;

const STAT_TEXT: Record<StatId, [string, string]> = {
  hull: ['Hull', '+10 max Hull, heals 10'],
  speed: ['Speed', '+0.5 u/s move speed'],
  power: ['Power', '+10% damage, every part'],
  rate: ['Rate', '+10% fire rate (chain heads)'],
  area: ['Area', '+10% size, every part'],
  magnet: ['Magnet', '+0.5 u pickup radius'],
};

const TRIGGER_TEXT: Record<WeaponId, string> = {
  pulse: 'a 3-bolt Pulse burst',
  tesla: 'a 3-jump Tesla chain',
};

function name(id: WeaponId): string {
  return TUNING.weapons[id].name;
}

function colour(id: WeaponId): string {
  return '#' + TUNING.weapons[id].colour.toString(16).padStart(6, '0');
}

function icon(id: WeaponId): string {
  return `<span class="icon" style="background:${colour(id)};box-shadow:0 0 6px ${colour(id)}"></span>`;
}

function chainHtml(ids: WeaponId[]): string {
  return ids.map((id) => `${icon(id)}${name(id).split(' ')[0]}`).join(' <span class="arrow">&rarr;</span> ');
}

export function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, '0')}`;
}

export class Hud {
  private last: Record<string, string> = {};
  /** Index of a Link card awaiting its order choice, or -1. */
  linkPending = -1;
  private cardsShown: Card[] | null = null;

  constructor(private onPick: (i: number, order: number) => void) {}

  private set(id: string, key: 'text' | 'html' | 'width' | 'class', v: string): void {
    const k = id + key;
    if (this.last[k] === v) return;
    this.last[k] = v;
    const el = $(id);
    if (key === 'text') el.textContent = v;
    else if (key === 'html') el.innerHTML = v;
    else if (key === 'width') el.style.width = v;
    else el.className = v;
  }

  show(on: boolean): void {
    $('hud').hidden = !on;
  }

  update(w: World): void {
    this.set('xpfill', 'width', `${Math.min(100, (w.xp / w.xpToNext) * 100).toFixed(1)}%`);
    this.set('level', 'text', `L${w.level}`);
    this.set('timer', 'text', fmtTime(w.time));
    this.set('kills', 'text', String(w.kills));
    this.set('hullfill', 'width', `${Math.max(0, (w.hull / w.build.maxHull) * 100).toFixed(1)}%`);
    this.set('hulltext', 'text', `${Math.ceil(Math.max(0, w.hull))} / ${w.build.maxHull}`);

    let surge = '';
    let cls = '';
    if (w.surgePhase === 'surge') {
      const need = Math.ceil(w.surgeSize * TUNING.surge.breakFraction);
      surge = `SURGE ${w.surgeCount} — break ${Math.min(w.surgeKilled, need)} / ${need}`;
      cls = 'warn';
    } else if (w.surgePhase === 'breath') {
      surge = `SURGE INCOMING ${Math.ceil(w.nextSurgeIn ?? 0)}`;
      cls = 'warn';
    } else if (w.nextSurgeIn !== null) {
      surge = `Next Surge ${fmtTime(Math.ceil(w.nextSurgeIn))}`;
    }
    this.set('surge', 'text', surge);
    this.set('surge', 'class', cls);
    this.set('fx-breath', 'class', w.surgePhase === 'breath' ? 'fx on' : 'fx');
    this.set('fx-dim', 'class', w.surgePhase === 'breath' ? 'fx on' : 'fx');

    // Hardpoints: weapons with level pips, Links joined by a conduit
    const ready = linkOptions(w.build, w.linkLevel);
    const readySlots = new Set<number>();
    for (const o of ready) {
      readySlots.add(o.a);
      readySlots.add(o.b);
    }
    const hp = w.build.hardpoints
      .map((c, slot) => {
        if (!c) return '<div class="hp empty"></div>';
        const parts = c.parts
          .map((p) => {
            let pips = '';
            for (let l = 1; l <= w.weaponCap; l++) pips += `<span class="pip${l <= p.weapon.level ? ' on' : ''}"></span>`;
            return `<div class="wp">${icon(p.weapon.id)}<div class="pips">${pips}</div></div>`;
          })
          .join('<span class="conduit"></span>');
        const cl = c.parts.length > 1 ? `<span class="cl">CL${c.level}</span>` : '';
        return `<div class="hp${readySlots.has(slot) ? ' ready' : ''}">${parts}${cl}</div>`;
      })
      .join('');
    this.set('hardpoints', 'html', hp);

    this.updateCards(w);
  }

  private updateCards(w: World): void {
    const el = $('cards');
    if (!w.draft) {
      if (this.cardsShown) {
        el.hidden = true;
        el.innerHTML = '';
        this.cardsShown = null;
        this.linkPending = -1;
      }
      return;
    }
    if (this.cardsShown === w.draft && el.dataset.link === String(this.linkPending)) return;
    this.cardsShown = w.draft;
    el.dataset.link = String(this.linkPending);
    el.hidden = false;
    if (this.linkPending >= 0) {
      const card = w.draft[this.linkPending];
      if (card.type === 'link') {
        el.innerHTML =
          `<div class="kind" style="letter-spacing:2px">PICK THE HEAD</div><div class="row">` +
          card.option.orders
            .map(
              (ord, i) =>
                `<div class="card link" data-order="${i}"><span class="key">${i + 1}</span><div class="kind">Link order</div>` +
                `<div class="name">${chainHtml(ord)}</div><div class="text">${this.linkLine(ord)}</div></div>`,
            )
            .join('') +
          `</div><div class="cards-foot"><kbd>1</kbd>/<kbd>2</kbd> pick order &nbsp; <kbd>Esc</kbd> back</div>`;
        el.querySelectorAll<HTMLElement>('.card').forEach((c) =>
          c.addEventListener('click', () => this.pickOrder(Number(c.dataset.order))),
        );
        return;
      }
    }
    el.innerHTML =
      `<div class="row">` +
      w.draft.map((c, i) => this.cardHtml(w, c, i)).join('') +
      `</div><div class="cards-foot"><kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> pick &nbsp; <kbd>R</kbd> reroll (${w.rerolls} left)</div>`;
    el.querySelectorAll<HTMLElement>('.card').forEach((c) => c.addEventListener('click', () => this.pick(w, Number(c.dataset.i))));
  }

  private linkLine(ord: WeaponId[]): string {
    return ord
      .slice(1)
      .map((id, k) => `${name(ord[k]).split(' ')[0]} hits can fire ${TRIGGER_TEXT[id]} from the hit`)
      .join('; ');
  }

  private cardHtml(w: World, c: Card, i: number): string {
    let kind = '';
    let title = '';
    let text = '';
    let cls = 'card';
    switch (c.type) {
      case 'level':
        kind = `Weapon level ${c.to}`;
        title = `${icon(c.weapon)}${name(c.weapon)}`;
        text = TUNING.weapons[c.weapon].levelText[c.to];
        break;
      case 'new':
        kind = 'New weapon';
        title = `${icon(c.weapon)}${name(c.weapon)}`;
        text = TUNING.weapons[c.weapon].levelText[1];
        break;
      case 'stat':
        kind = 'Stat boost';
        title = STAT_TEXT[c.stat][0];
        text = STAT_TEXT[c.stat][1];
        break;
      case 'chain': {
        kind = `Chain Level ${c.to}`;
        const chain = w.build.hardpoints[c.slot]!;
        title = chainHtml(chain.parts.map((p) => p.weapon.id));
        text = '+10% trigger power, +15% trigger chance';
        break;
      }
      case 'link':
        kind = 'LINK';
        cls += ' link';
        title = chainHtml(c.option.orders[0]);
        text = `${this.linkLine(c.option.orders[0])}. Frees a hardpoint. You pick the head.`;
        break;
    }
    return `<div class="${cls}" data-i="${i}"><span class="key">${i + 1}</span><div class="kind">${kind}</div><div class="name">${title}</div><div class="text">${text}</div></div>`;
  }

  /** Card key / click. Link cards ask for the order next. */
  pick(w: World, i: number): void {
    if (!w.draft || i < 0 || i >= w.draft.length) return;
    if (this.linkPending >= 0) {
      this.pickOrder(i);
      return;
    }
    if (w.draft[i].type === 'link') {
      this.linkPending = i;
      this.cardsShown = null;
      this.updateCards(w);
      return;
    }
    this.onPick(i, 0);
  }

  pickOrder(order: number): void {
    if (this.linkPending < 0 || order < 0 || order > 1) return;
    const i = this.linkPending;
    this.linkPending = -1;
    this.onPick(i, order);
  }

  cancelLink(w: World): void {
    this.linkPending = -1;
    this.cardsShown = null;
    this.updateCards(w);
  }

  effects(events: WorldEvent[]): void {
    for (const ev of events) {
      switch (ev.type) {
        case 'hurt':
          retrigger('fx-hurt', 'on');
          break;
        case 'levelup':
          retrigger('fx-burst', 'on');
          break;
        case 'link':
          retrigger('fx-flash', 'on');
          break;
        case 'overflow':
          retrigger('fx-flash', 'big');
          break;
      }
    }
  }

  showOver(w: World): void {
    $('over-panel').innerHTML =
      `<h2>HULL 0</h2><p>Survived ${fmtTime(w.time)} &nbsp; L${w.level} &nbsp; ${w.kills} kills</p>` +
      `<p>${w.build.hardpoints
        .filter((c) => c)
        .map((c) => chainHtml(c!.parts.map((p) => p.weapon.id)))
        .join(' &nbsp;|&nbsp; ')}</p>` +
      `<p class="go"><kbd>Enter</kbd> Deploy again</p>`;
    $('over').hidden = false;
  }
}

function retrigger(id: string, cls: string): void {
  const el = $(id);
  el.className = 'fx';
  void el.offsetWidth; // restart the CSS animation
  el.className = `fx ${cls}`;
}
