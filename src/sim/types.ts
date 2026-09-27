// Entity types shared by the simulation modules.
import type { EnemyKind, WeaponId } from '../tuning';
import type { Chain } from './build';

/** Where an effect came from: which chain part fired it, and whether by trigger. */
export interface Src {
  chain: Chain;
  part: number;
  weapon: WeaponId;
  triggered: boolean;
  /** Ordered pair "head>tail" that fired this effect, for triggered effects. */
  pair: string | null;
}

export interface BossState {
  // Brood Mother
  chargeT: number; // s until the next charge
  chargesLeft: number; // charges left in the current volley
  telegraph: number; // s of telegraph left (0 = none)
  dashLeft: number; // u of dash left (0 = not dashing)
  dirX: number;
  dirZ: number;
  burstT: number;
  spitT: number;
  // Overmind
  phase: number;
  beamAngle: number;
  summonT: number;
  orbT: number;
}

export interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number;
  z: number;
  px: number; // position at the start of the tick, for render interpolation
  pz: number;
  fx: number; // facing (unit vector)
  fz: number;
  r: number;
  hp: number;
  maxHp: number;
  shield: number;
  speed: number;
  damage: number;
  xp: number;
  alive: boolean;
  lastHit: number; // tick of the last hit, for the white flash
  surge: number; // id of the Surge this unit belongs to, 0 if none
  elite: 0 | 1 | 2; // none, Hasted, Shielded
  blocks: boolean; // the mech can't shoulder through it
  mass: number; // 0 = immovable by the crowd
  zigT: number;
  zig: number;
  marchX: number; // wall units sweep along this direction ...
  marchZ: number;
  marchLeft: number; // ... for this many u before hunting the mech
  gate: Float64Array; // per Link part: game time until this enemy may source another trigger
  boss: BossState | null;
  slowUntil: number; // game time: slowed by Cryo until then
  frozenUntil: number; // game time: frozen until then
  chill: number; // s spent inside a Cryo cone without a break
  chillSeen: number; // game time last inside a Cryo cone
  spitT: number; // Spitter: s until the next glob
}

/** Where a trigger fires from: the hit point and the enemy that sourced it. */
export interface HitPoint {
  x: number;
  z: number;
  id: number;
}

export interface Mine {
  x: number;
  z: number;
  arm: number; // s until armed
  life: number;
  damage: number;
  blast: number;
  chain: boolean;
  src: Src;
  alive: boolean;
}

export interface Rail {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  width: number;
  life: number;
  maxLife: number;
  triggered: boolean;
}

export interface Singularity {
  x: number;
  z: number;
  pull: number;
  life: number;
  maxLife: number;
  tickDamage: number;
  nextTick: number;
  ticks: number;
  collapse: number;
  collapseRadius: number;
  src: Src;
  born: number;
  alive: boolean;
}

/** A Cryo cone this tick (for rendering). */
export interface Cone {
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  range: number;
  halfAngle: number;
  triggered: boolean;
}

export interface Freeze {
  x: number;
  z: number;
  r: number;
  life: number;
}

export interface Obstacle {
  kind: 'box' | 'cyl';
  x: number;
  z: number;
  hx: number; // box half-extents, or cylinder radius in hx
  hz: number;
}

export interface Vent {
  x: number;
  z: number;
  phase: number; // s offset into the cycle
  active: boolean;
}

export interface Crystal {
  x: number;
  z: number;
  r: number;
  regrow: number; // s until it grows back (0 = intact)
}

export interface DelayedTrigger {
  at: number; // game time
  chainKey: string;
  part: number;
  from: HitPoint;
  power: number;
  size: number;
  pair: string;
}

export interface Bolt {
  x: number;
  z: number;
  px: number;
  pz: number;
  dx: number;
  dz: number;
  speed: number;
  travelled: number;
  range: number;
  radius: number;
  damage: number;
  pierce: number;
  hits: number[];
  src: Src;
  alive: boolean;
  shard?: boolean; // Moon crystal shrapnel
}

export interface Missile {
  x: number;
  z: number;
  px: number;
  pz: number;
  dx: number;
  dz: number;
  target: Enemy | null;
  targetId: number;
  life: number;
  damage: number;
  blast: number;
  exclude: number; // enemy id a triggered missile ignores for contact
  src: Src;
  alive: boolean;
}

export interface Shell {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  t: number; // 0..1 flight progress
  flight: number;
  damage: number;
  blast: number;
  poolDamage: number;
  poolRadius: number;
  poolLife: number;
  src: Src;
  alive: boolean;
}

/** A continuous damage area: plasma pool or static field. */
export interface Zone {
  x: number;
  z: number;
  r: number;
  damage: number; // per tick
  tick: number;
  nextTick: number; // game time
  life: number;
  maxLife: number;
  born: number;
  src: Src;
  alive: boolean;
}

/** A triggered blade orbiting a hit point. */
export interface OrbitBlade {
  cx: number;
  cz: number;
  x: number;
  z: number;
  angle: number;
  orbit: number;
  radius: number;
  spin: number;
  life: number;
  damage: number;
  hits: Map<number, number>;
  born: number;
  src: Src;
  alive: boolean;
}

export interface Arc {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  life: number;
  maxLife: number;
  weapon: WeaponId;
  triggered: boolean;
}

export interface Ring {
  x: number;
  z: number;
  r: number;
  life: number;
  maxLife: number;
  weapon: WeaponId;
  triggered: boolean;
}

export interface Core {
  x: number;
  z: number;
  px: number;
  pz: number;
  value: number;
  state: 0 | 1 | 2; // idle, magnetised, pulled (Overflow / Magnet Pulse)
}

export type PickupKind = 'repair' | 'magnet' | 'cache';

export interface Pickup {
  kind: PickupKind;
  x: number;
  z: number;
  state: 0 | 1;
}

export type HazardKind = 'glob' | 'puddle' | 'orb' | 'spit';

export interface Hazard {
  kind: HazardKind;
  x: number;
  z: number;
  px: number;
  pz: number;
  dx: number;
  dz: number;
  speed: number;
  r: number;
  life: number;
  damage: number;
  travelled: number;
  range: number;
  alive: boolean;
}
