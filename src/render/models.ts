// Procedural low-poly models, flat shaded with vertex colours. Each unit has a body
// (lit) and a glow part (unlit, bright, picked up by bloom). Silhouettes by role:
// spiky = fast, round = tank, tall = ranged. Built once at start-up.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

type Geo = THREE.BufferGeometry;

/** Paint a geometry one colour (vertex colours) and drop attributes merging can't mix. */
function paint(g: Geo, hex: number): Geo {
  const geo = g.index ? g.toNonIndexed() : g;
  geo.deleteAttribute('uv');
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

function merge(parts: Geo[]): Geo {
  const g = mergeGeometries(parts, false)!;
  g.computeVertexNormals();
  return g;
}

function at(g: Geo, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): Geo {
  g.scale(sx, sy, sz);
  g.rotateX(rx);
  g.rotateY(ry);
  g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}

export interface UnitModel {
  body: Geo;
  glow: Geo;
}

// Warm tones: the per-biome enemy hue comes from the instance colour, so bodies are
// painted in greys (light = takes the hue, dark = shadowed plates).
const LIGHT = 0xffffff;
const MID = 0xa8a8a8;
const DARK = 0x5a5a5a;

/** Mite: a low crawling beetle with six legs. ~120 tris. */
export function mite(): UnitModel {
  const parts: Geo[] = [paint(at(new THREE.IcosahedronGeometry(0.36, 0), 0, 0.3, 0, 0, 0, 0, 1, 0.55, 1.25), LIGHT)];
  parts.push(paint(at(new THREE.IcosahedronGeometry(0.2, 0), 0, 0.32, 0.38, 0, 0, 0, 1, 0.8, 1), MID));
  for (let i = 0; i < 3; i++) {
    for (const side of [-1, 1]) {
      const z = -0.2 + i * 0.2;
      parts.push(paint(at(new THREE.ConeGeometry(0.05, 0.42, 3), side * 0.36, 0.16, z, 0, 0, side * 1.9), DARK));
    }
  }
  const glow = merge([
    paint(at(new THREE.OctahedronGeometry(0.06, 0), -0.09, 0.38, 0.54), LIGHT),
    paint(at(new THREE.OctahedronGeometry(0.06, 0), 0.09, 0.38, 0.54), LIGHT),
  ]);
  return { body: merge(parts), glow };
}

/** Skitter: fast and spiky, spines raked back. ~140 tris. */
export function skitter(): UnitModel {
  const parts: Geo[] = [paint(at(new THREE.OctahedronGeometry(0.3, 0), 0, 0.3, 0, 0, 0, 0, 0.8, 0.6, 1.5), LIGHT)];
  const spines = [
    [0, 0.55, -0.1, -0.9, 0, 0],
    [0.2, 0.45, -0.15, -1.0, 0, -0.6],
    [-0.2, 0.45, -0.15, -1.0, 0, 0.6],
    [0.28, 0.3, -0.05, -1.2, 0, -1.2],
    [-0.28, 0.3, -0.05, -1.2, 0, 1.2],
  ];
  for (const [x, y, z, rx, , rz] of spines) parts.push(paint(at(new THREE.ConeGeometry(0.07, 0.5, 3), x, y, z, rx, 0, rz), MID));
  const glow = merge([paint(at(new THREE.ConeGeometry(0.08, 0.25, 3), 0, 0.3, 0.52, Math.PI / 2, 0, 0), LIGHT)]);
  return { body: merge(parts), glow };
}

/** Carapace: a round armoured dome; the bright shield plate marks its front. ~220 tris. */
export function carapace(): UnitModel {
  const parts: Geo[] = [paint(at(new THREE.SphereGeometry(0.9, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2), 0, 0.05, 0, 0, 0, 0, 1, 0.75, 1), MID)];
  // Ridge plates over the back
  for (let i = 0; i < 3; i++) parts.push(paint(at(new THREE.BoxGeometry(0.22, 0.12, 1.1 - i * 0.2), (i - 1) * 0.35, 0.68 - Math.abs(i - 1) * 0.1, -0.1), DARK));
  // Front shield
  parts.push(paint(at(new THREE.CylinderGeometry(0.85, 0.85, 0.16, 8, 1, false, -Math.PI / 3, (2 * Math.PI) / 3), 0, 0.35, 0.1, 0, 0, 0, 1, 3.4, 1), LIGHT));
  const glow = merge([paint(at(new THREE.BoxGeometry(0.5, 0.08, 0.06), 0, 0.45, 0.93), LIGHT)]);
  return { body: merge(parts), glow };
}

/** Spitter: tall and thin, a stalk with a swollen head and a glowing maw. ~160 tris. */
export function spitter(): UnitModel {
  const parts: Geo[] = [
    paint(at(new THREE.CylinderGeometry(0.16, 0.3, 1.1, 6), 0, 0.55, 0), MID),
    paint(at(new THREE.IcosahedronGeometry(0.34, 0), 0, 1.3, 0.05, 0, 0, 0, 1, 1.15, 1), LIGHT),
    paint(at(new THREE.ConeGeometry(0.34, 0.25, 6), 0, 0.12, 0), DARK),
  ];
  const glow = merge([paint(at(new THREE.CylinderGeometry(0.13, 0.08, 0.2, 6), 0, 1.28, 0.34, Math.PI / 2, 0, 0), LIGHT)]);
  return { body: merge(parts), glow };
}

/** Splitter: four fused pods that look ready to come apart. ~200 tris. */
export function splitter(): UnitModel {
  const parts: Geo[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    parts.push(paint(at(new THREE.IcosahedronGeometry(0.3, 0), Math.cos(a) * 0.25, 0.42, Math.sin(a) * 0.25), i % 2 ? LIGHT : MID));
  }
  parts.push(paint(at(new THREE.IcosahedronGeometry(0.26, 0), 0, 0.72, 0), DARK));
  const glow = merge([paint(at(new THREE.OctahedronGeometry(0.12, 0), 0, 0.5, 0), LIGHT)]);
  return { body: merge(parts), glow };
}

/** Brood Mother: a bloated abdomen, armoured head, and eight legs. Scaled by her radius. */
export function brood(): UnitModel {
  const parts: Geo[] = [
    paint(at(new THREE.IcosahedronGeometry(0.75, 1), 0, 0.55, -0.35, 0, 0, 0, 1, 0.7, 1.3), MID),
    paint(at(new THREE.IcosahedronGeometry(0.42, 0), 0, 0.55, 0.55, 0, 0, 0, 1.1, 0.8, 1), LIGHT),
  ];
  for (let i = 0; i < 4; i++) {
    for (const side of [-1, 1]) {
      const z = -0.5 + i * 0.35;
      parts.push(paint(at(new THREE.ConeGeometry(0.07, 1.1, 4), side * 0.75, 0.35, z, 0, 0, side * 1.7), DARK));
    }
  }
  for (const side of [-1, 1]) parts.push(paint(at(new THREE.ConeGeometry(0.08, 0.45, 4), side * 0.2, 0.45, 0.95, Math.PI / 2.3, 0, 0), LIGHT));
  const glow = merge([
    paint(at(new THREE.OctahedronGeometry(0.08, 0), -0.18, 0.72, 0.9), LIGHT),
    paint(at(new THREE.OctahedronGeometry(0.08, 0), 0.18, 0.72, 0.9), LIGHT),
    paint(at(new THREE.IcosahedronGeometry(0.3, 0), 0, 0.8, -0.6, 0, 0, 0, 1, 0.6, 1), LIGHT),
  ]);
  return { body: merge(parts), glow };
}

/** Overmind: a spiked core on a pedestal. Scaled by its radius. */
export function overmind(): UnitModel {
  const parts: Geo[] = [
    paint(at(new THREE.CylinderGeometry(0.7, 1, 0.5, 8), 0, 0.25, 0), DARK),
    paint(at(new THREE.IcosahedronGeometry(0.75, 1), 0, 1.35, 0), MID),
  ];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    parts.push(paint(at(new THREE.ConeGeometry(0.12, 0.7, 4), Math.cos(a) * 0.8, 1.35 + (i % 2 ? 0.3 : -0.3), Math.sin(a) * 0.8, 0, -a, Math.PI / 2), LIGHT));
  }
  const glow = merge([paint(at(new THREE.IcosahedronGeometry(0.45, 1), 0, 1.35, 0), LIGHT), paint(at(new THREE.TorusGeometry(1.05, 0.05, 4, 24), 0, 1.35, 0, Math.PI / 2), LIGHT)]);
  return { body: merge(parts), glow };
}

/** A tetrahedral shard for death shatters. */
export function shard(): Geo {
  return new THREE.TetrahedronGeometry(0.18, 0);
}

/** Repair Kit: a white cross. */
export function repairKit(): Geo {
  return merge([paint(new THREE.BoxGeometry(0.6, 0.2, 0.2), LIGHT), paint(new THREE.BoxGeometry(0.2, 0.6, 0.2), LIGHT)]);
}

/** Magnet Pulse: a horseshoe. */
export function magnet(): Geo {
  return merge([
    paint(at(new THREE.TorusGeometry(0.28, 0.08, 4, 10, Math.PI), 0, 0.1, 0), LIGHT),
    paint(at(new THREE.BoxGeometry(0.16, 0.2, 0.16), -0.28, -0.05, 0), MID),
    paint(at(new THREE.BoxGeometry(0.16, 0.2, 0.16), 0.28, -0.05, 0), MID),
  ]);
}

/** Overflow Cache: a faceted gold star. */
export function cache(): Geo {
  return merge([paint(new THREE.OctahedronGeometry(0.4, 0), LIGHT), paint(at(new THREE.OctahedronGeometry(0.4, 0), 0, 0, 0, 0, Math.PI / 4, 0, 0.6, 1.3, 0.6), MID)]);
}

/** A Moon crystal cluster. */
export function crystal(): Geo {
  const parts: Geo[] = [];
  const spikes = [
    [0, 0, 0, 0, 1.4],
    [0.35, 0.1, 0.4, 0.35, 0.9],
    [-0.4, -0.1, -0.35, -0.4, 1.0],
    [0.3, 0.3, -0.45, 0.3, 0.7],
    [-0.3, -0.35, 0.35, -0.35, 0.8],
  ];
  for (const [x, z, tx, tz, h] of spikes) {
    parts.push(paint(at(new THREE.OctahedronGeometry(0.28, 0), x, h * 0.55, z, tx, 0, tz, 0.8, h * 1.6, 0.8), LIGHT));
  }
  return merge(parts);
}

/** A Station vent: a round grate. */
export function vent(): Geo {
  const parts: Geo[] = [paint(at(new THREE.CylinderGeometry(2.4, 2.6, 0.12, 16), 0, 0.06, 0), DARK)];
  for (let i = -2; i <= 2; i++) parts.push(paint(at(new THREE.BoxGeometry(4.2 - Math.abs(i) * 0.9, 0.06, 0.18), 0, 0.14, i * 0.75), MID));
  return merge(parts);
}

/** An Ion Mine: a flat disc with a raised core. */
export function mine(): Geo {
  return merge([paint(at(new THREE.CylinderGeometry(0.35, 0.4, 0.12, 8), 0, 0.06, 0), MID), paint(at(new THREE.OctahedronGeometry(0.15, 0), 0, 0.2, 0), LIGHT)]);
}
