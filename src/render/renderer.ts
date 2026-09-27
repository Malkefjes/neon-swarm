// Three.js view of the simulation. Placeholder shapes until the milestone 3 visual
// pass; every visual is generated in code. Instanced meshes keep draw calls flat
// regardless of entity counts.
import * as THREE from 'three';
import { TUNING, type WeaponId } from '../tuning';
import { UP } from '../sim/view';
import type { World } from '../sim/world';

const C = TUNING.camera;
const MAX_ENEMIES = TUNING.sim.maxEnemies;
const MAX_BOLTS = 4000;
const MAX_CORES = TUNING.xp.maxCoresOnGround;
const MAX_ARC_SEGS = 8000;
const ARC_SUBDIV = 4;

const ENEMY_COLOUR = new THREE.Color(0xd8246e); // magenta
const WHITE = new THREE.Color(0xffffff);
const CORE_COLOURS = [new THREE.Color(0x2f7bff), new THREE.Color(0x2dff8a), new THREE.Color(0xffc21a)];

function weaponColour(id: WeaponId): THREE.Color {
  return new THREE.Color(TUNING.weapons[id].colour);
}

/** Write a Y-rotation + uniform scale + translation matrix into an instance slot. */
function writeMatrix(arr: Float32Array, i: number, x: number, y: number, z: number, yaw: number, sx: number, sy = sx, sz = sx): void {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const o = i * 16;
  arr[o] = c * sx;
  arr[o + 1] = 0;
  arr[o + 2] = -s * sx;
  arr[o + 3] = 0;
  arr[o + 4] = 0;
  arr[o + 5] = sy;
  arr[o + 6] = 0;
  arr[o + 7] = 0;
  arr[o + 8] = s * sz;
  arr[o + 9] = 0;
  arr[o + 10] = c * sz;
  arr[o + 11] = 0;
  arr[o + 12] = x;
  arr[o + 13] = y;
  arr[o + 14] = z;
  arr[o + 15] = 1;
}

export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.OrthographicCamera;
  private enemies: THREE.InstancedMesh;
  private bolts: THREE.InstancedMesh;
  private cores: THREE.InstancedMesh;
  private arcGeo: THREE.BufferGeometry;
  private arcPos: Float32Array;
  private arcCol: Float32Array;
  private mech: THREE.Group;
  private mechBody: THREE.Mesh;
  private mounts: THREE.Mesh[] = [];
  private conduits: THREE.Mesh[] = [];
  private mechYaw = 0;
  private boltColours: Record<string, THREE.Color> = {};
  private jag: Float32Array;
  private tmpColour = new THREE.Color();

  constructor(canvas: HTMLCanvasElement) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.gl.setClearColor(0x0b0e15);
    this.camera = new THREE.OrthographicCamera(-15, 15, 8.5, -8.5, 0.1, 200);

    // Lighting: one directional + ambient
    this.scene.add(new THREE.AmbientLight(0x8890a8, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-20, 40, 10);
    this.scene.add(sun);

    // Arena floor in muted mid-tones, grid and boundary
    const half = TUNING.arena.halfSize;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(half * 2, half * 2),
      new THREE.MeshLambertMaterial({ color: 0x1b2130 }),
    );
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
    const grid = new THREE.GridHelper(half * 2, 50, 0x2c3548, 0x242b3b);
    grid.position.y = 0.01;
    this.scene.add(grid);
    const wallMat = new THREE.MeshLambertMaterial({ color: 0x3a4460 });
    for (let i = 0; i < 4; i++) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(half * 2 + 2, 1.5, 1), wallMat);
      const a = (i * Math.PI) / 2;
      wall.position.set(Math.sin(a) * (half + 0.5), 0.75, Math.cos(a) * (half + 0.5));
      wall.rotation.y = a;
      this.scene.add(wall);
    }

    // Enemies: Mite placeholder = low four-sided spike
    const miteGeo = new THREE.ConeGeometry(0.42, 0.8, 4, 1);
    miteGeo.rotateX(Math.PI / 2); // point forward (+z)
    miteGeo.translate(0, 0.4, 0);
    this.enemies = new THREE.InstancedMesh(miteGeo, new THREE.MeshLambertMaterial({ flatShading: true }), MAX_ENEMIES);
    this.enemies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.enemies.setColorAt(0, ENEMY_COLOUR);
    this.enemies.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.enemies.frustumCulled = false;
    this.scene.add(this.enemies);

    // Bolts: bright unlit slugs
    const boltGeo = new THREE.BoxGeometry(0.16, 0.16, 0.7);
    this.bolts = new THREE.InstancedMesh(boltGeo, new THREE.MeshBasicMaterial(), MAX_BOLTS);
    this.bolts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.bolts.setColorAt(0, WHITE);
    this.bolts.frustumCulled = false;
    this.scene.add(this.bolts);

    // XP cores: faceted spinning gems (a shape no weapon effect uses)
    const coreGeo = new THREE.OctahedronGeometry(0.22, 0);
    coreGeo.scale(1, 1.5, 1);
    this.cores = new THREE.InstancedMesh(coreGeo, new THREE.MeshBasicMaterial(), MAX_CORES);
    this.cores.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cores.setColorAt(0, WHITE);
    this.cores.frustumCulled = false;
    this.scene.add(this.cores);

    // Tesla arcs: flat jagged ribbons, additive
    this.arcPos = new Float32Array(MAX_ARC_SEGS * 6 * 3);
    this.arcCol = new Float32Array(MAX_ARC_SEGS * 6 * 3);
    this.arcGeo = new THREE.BufferGeometry();
    this.arcGeo.setAttribute('position', new THREE.BufferAttribute(this.arcPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.arcGeo.setAttribute('color', new THREE.BufferAttribute(this.arcCol, 3).setUsage(THREE.DynamicDrawUsage));
    const arcs = new THREE.Mesh(
      this.arcGeo,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    arcs.frustumCulled = false;
    this.scene.add(arcs);
    // Fixed jag offsets (visual only; never touches the sim RNG)
    this.jag = new Float32Array(97);
    for (let i = 0; i < this.jag.length; i++) this.jag[i] = Math.sin(i * 12.9898) * 43758.5453 % 1;

    // Mech: white chunky frame with cyan trim, weapon mounts per hardpoint
    this.mech = new THREE.Group();
    this.mechBody = new THREE.Mesh(
      new THREE.BoxGeometry(1.3, 0.9, 1.1),
      new THREE.MeshLambertMaterial({ color: 0xf2f5ff, flatShading: true }),
    );
    this.mechBody.position.y = 0.85;
    this.mech.add(this.mechBody);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.12, 1.16), new THREE.MeshBasicMaterial({ color: 0x3ff2ff }));
    trim.position.y = 0.95;
    this.mech.add(trim);
    const legMat = new THREE.MeshLambertMaterial({ color: 0xb8c0d8, flatShading: true });
    for (const sx of [-0.4, 0.4]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.5, 0.5), legMat);
      leg.position.set(sx, 0.25, 0);
      this.mech.add(leg);
    }
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.18, 0.1), new THREE.MeshBasicMaterial({ color: 0x3ff2ff }));
    visor.position.set(0, 1.05, 0.56);
    this.mech.add(visor);
    // Mount spots: left shoulder, right shoulder, back, left forearm
    const spots: [number, number, number][] = [
      [-0.8, 1.35, 0.1],
      [0.8, 1.35, 0.1],
      [0, 1.45, -0.45],
      [-0.85, 0.75, 0.45],
    ];
    for (const [x, y, z] of spots) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 0.6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      m.position.set(x, y, z);
      m.visible = false;
      this.mech.add(m);
      this.mounts.push(m);
    }
    for (let i = 0; i < 4; i++) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      c.visible = false;
      this.mech.add(c);
      this.conduits.push(c);
    }
    this.scene.add(this.mech);

    for (const id of Object.keys(TUNING.weapons) as WeaponId[]) {
      this.boltColours[id] = weaponColour(id);
      this.boltColours[id + ':t'] = weaponColour(id).multiplyScalar(TUNING.links.triggeredVisualScale);
    }
  }

  info(): string {
    const i = this.gl.info.render;
    return `draw calls ${i.calls}  triangles ${i.triangles}  px ${this.gl.domElement.width}x${this.gl.domElement.height}`;
  }

  resize(w: number, h: number): void {
    this.gl.setSize(w, h, false);
    const aspect = w / h;
    // Always show at least the base 30 x 17 view
    const halfH = Math.max(C.viewHeight / 2, C.viewWidth / 2 / aspect);
    const halfW = halfH * aspect;
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfH;
    this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();
  }

  render(w: World, alpha: number, realTime: number): void {
    const lerp = (a: number, b: number) => a + (b - a) * alpha;

    // Camera: orthographic isometric, soft follow simulated in the world
    const cx = lerp(w.pcamX, w.camX);
    const cz = lerp(w.pcamZ, w.camZ);
    const pitch = (C.pitchDeg * Math.PI) / 180;
    const dist = 60;
    this.camera.position.set(cx - UP.x * dist * Math.cos(pitch), dist * Math.sin(pitch), cz - UP.z * dist * Math.cos(pitch));
    this.camera.lookAt(cx, 0, cz);

    // Mech
    const mx = lerp(w.px, w.x);
    const mz = lerp(w.pz, w.z);
    this.mech.position.set(mx, 0, mz);
    if (Math.hypot(w.vx, w.vz) > 0.5) {
      const target = Math.atan2(w.vx, w.vz);
      let d = target - this.mechYaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.mechYaw += d * 0.25;
    }
    this.mech.rotation.y = this.mechYaw;
    this.mech.visible = !w.dead || w.tick % 6 < 3;
    const flashing = w.invuln > 0 && Math.floor(realTime * 20) % 2 === 0;
    (this.mechBody.material as THREE.MeshLambertMaterial).emissive.setHex(flashing ? 0xff3355 : 0x000000);
    this.updateMounts(w);

    // Enemies
    const em = this.enemies.instanceMatrix.array as Float32Array;
    const ec = this.enemies.instanceColor!.array as Float32Array;
    const es = w.enemies;
    const n = Math.min(es.length, MAX_ENEMIES);
    for (let i = 0; i < n; i++) {
      const e = es[i];
      const x = lerp(e.px, e.x);
      const z = lerp(e.pz, e.z);
      const yaw = Math.atan2(w.x - x, w.z - z);
      writeMatrix(em, i, x, 0, z, yaw, e.r / 0.4);
      const col = w.tick - e.lastHit <= TUNING.sim.hitFlashTicks ? WHITE : ENEMY_COLOUR;
      ec[i * 3] = col.r;
      ec[i * 3 + 1] = col.g;
      ec[i * 3 + 2] = col.b;
    }
    this.enemies.count = n;
    this.enemies.instanceMatrix.needsUpdate = true;
    this.enemies.instanceColor!.needsUpdate = true;

    // Bolts
    const bm = this.bolts.instanceMatrix.array as Float32Array;
    const bc = this.bolts.instanceColor!.array as Float32Array;
    const nb = Math.min(w.bolts.length, MAX_BOLTS);
    for (let i = 0; i < nb; i++) {
      const b = w.bolts[i];
      const s = b.triggered ? TUNING.links.triggeredVisualScale : 1;
      const r = (b.radius / TUNING.weapons.pulse.boltRadius) * s;
      writeMatrix(bm, i, lerp(b.px, b.x), 0.7, lerp(b.pz, b.z), Math.atan2(b.dx, b.dz), r, r, s);
      const col = this.boltColours[b.triggered ? 'pulse:t' : 'pulse'];
      bc[i * 3] = col.r;
      bc[i * 3 + 1] = col.g;
      bc[i * 3 + 2] = col.b;
    }
    this.bolts.count = nb;
    this.bolts.instanceMatrix.needsUpdate = true;
    this.bolts.instanceColor!.needsUpdate = true;

    // Cores
    const cm = this.cores.instanceMatrix.array as Float32Array;
    const cc = this.cores.instanceColor!.array as Float32Array;
    const nc = Math.min(w.cores.length, MAX_CORES);
    for (let i = 0; i < nc; i++) {
      const c = w.cores[i];
      const tier = c.value >= 25 ? 2 : c.value >= 5 ? 1 : 0;
      const s = tier === 2 ? 1.6 : tier === 1 ? 1.25 : 1;
      writeMatrix(cm, i, lerp(c.px, c.x), 0.45 + Math.sin(realTime * 3 + i) * 0.08, lerp(c.pz, c.z), realTime * 2.5 + i, s);
      const col = CORE_COLOURS[tier];
      cc[i * 3] = col.r;
      cc[i * 3 + 1] = col.g;
      cc[i * 3 + 2] = col.b;
    }
    this.cores.count = nc;
    this.cores.instanceMatrix.needsUpdate = true;
    this.cores.instanceColor!.needsUpdate = true;

    this.updateArcs(w);
    this.gl.render(this.scene, this.camera);
  }

  private updateMounts(w: World): void {
    let mi = 0;
    let ci = 0;
    for (const m of this.mounts) m.visible = false;
    for (const c of this.conduits) c.visible = false;
    for (const chain of w.build.hardpoints) {
      if (!chain) continue;
      const first = mi;
      for (const p of chain.parts) {
        const m = this.mounts[mi++];
        if (!m) break;
        m.visible = true;
        (m.material as THREE.MeshBasicMaterial).color.setHex(TUNING.weapons[p.weapon.id].colour);
        const s = 0.7 + p.weapon.level * 0.08;
        m.scale.set(s, s, s);
      }
      // A Link draws a glowing conduit between its mounts
      for (let k = first; k < mi - 1 && ci < this.conduits.length; k++) {
        const a = this.mounts[k].position;
        const b = this.mounts[k + 1].position;
        const c = this.conduits[ci++];
        c.visible = true;
        c.position.set((a.x + b.x) / 2, (a.y + b.y) / 2 + 0.25, (a.z + b.z) / 2);
        const len = a.distanceTo(b);
        c.scale.set(1.4, len, 1.4);
        c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3().subVectors(b, a).normalize());
        const pulse = 0.6 + 0.4 * Math.sin(w.tick * 0.2);
        (c.material as THREE.MeshBasicMaterial).color.setRGB(pulse, pulse, pulse);
      }
    }
  }

  private updateArcs(w: World): void {
    let v = 0;
    let seg = 0;
    const y = 0.6;
    for (let ai = 0; ai < w.arcs.length && seg + ARC_SUBDIV <= MAX_ARC_SEGS; ai++) {
      const a = w.arcs[ai];
      const dx = a.x2 - a.x1;
      const dz = a.z2 - a.z1;
      const len = Math.hypot(dx, dz) || 1;
      const nx = -dz / len;
      const nz = dx / len;
      const k = a.triggered ? TUNING.links.triggeredVisualScale : 1;
      const width = 0.14 * k;
      const fade = (a.life / a.maxLife) * k;
      const c = this.tmpColour.setHex(TUNING.weapons[a.weapon].colour);
      const r = Math.min(1, c.r * 1.6 + 0.25) * fade;
      const g = Math.min(1, c.g * 1.6 + 0.25) * fade;
      const b = Math.min(1, c.b * 1.6 + 0.25) * fade;
      let px = a.x1;
      let pz = a.z1;
      for (let s = 1; s <= ARC_SUBDIV; s++) {
        const t = s / ARC_SUBDIV;
        const off = s < ARC_SUBDIV ? (this.jag[(ai * 7 + s * 3 + (w.tick >> 2)) % this.jag.length] - 0.5) * 0.9 : 0;
        const qx = a.x1 + dx * t + nx * off;
        const qz = a.z1 + dz * t + nz * off;
        // quad from p to q (two triangles)
        const ax = px - nx * width, az = pz - nz * width;
        const bx = px + nx * width, bz = pz + nz * width;
        const cx2 = qx + nx * width, cz2 = qz + nz * width;
        const dx2 = qx - nx * width, dz2 = qz - nz * width;
        v = this.vert(v, ax, y, az, r, g, b);
        v = this.vert(v, bx, y, bz, r, g, b);
        v = this.vert(v, cx2, y, cz2, r, g, b);
        v = this.vert(v, ax, y, az, r, g, b);
        v = this.vert(v, cx2, y, cz2, r, g, b);
        v = this.vert(v, dx2, y, dz2, r, g, b);
        px = qx;
        pz = qz;
        seg++;
      }
    }
    this.arcGeo.setDrawRange(0, v);
    for (const name of ['position', 'color']) {
      const attr = this.arcGeo.attributes[name] as THREE.BufferAttribute;
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, Math.max(3, v * 3));
      attr.needsUpdate = true;
    }
  }

  private vert(v: number, x: number, y: number, z: number, r: number, g: number, b: number): number {
    const o = v * 3;
    this.arcPos[o] = x;
    this.arcPos[o + 1] = y;
    this.arcPos[o + 2] = z;
    this.arcCol[o] = r;
    this.arcCol[o + 1] = g;
    this.arcCol[o + 2] = b;
    return v + 1;
  }
}
