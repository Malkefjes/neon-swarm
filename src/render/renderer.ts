// Three.js view of the simulation. Placeholder shapes until the milestone 3 visual
// pass; every visual is generated in code. Instanced pools keep draw calls flat
// regardless of entity counts.
import * as THREE from 'three';
import { TUNING, type EnemyKind, type WeaponId } from '../tuning';
import { UP, RIGHT, FORESHORTEN } from '../sim/view';
import { overmindBeams } from '../sim/bosses';
import type { World } from '../sim/world';

const C = TUNING.camera;
const ARC_SUBDIV = 4;
const MAX_ARC_SEGS = 8000;

const ENEMY_COLOUR: Record<EnemyKind, THREE.Color> = {
  mite: new THREE.Color(0xd8246e),
  skitter: new THREE.Color(0xff3d6e),
  carapace: new THREE.Color(0x9c1f4a),
  splitter: new THREE.Color(0xe0457e),
  brood: new THREE.Color(0xb3164f),
  overmind: new THREE.Color(0xff2a55),
};
const WHITE = new THREE.Color(0xffffff);
const CORE_COLOURS = [new THREE.Color(0x2f7bff), new THREE.Color(0x2dff8a), new THREE.Color(0xffc21a)];
const HAZARD = new THREE.Color(0xff5a1f);

function weaponColour(id: WeaponId): THREE.Color {
  return new THREE.Color(TUNING.weaponInfo[id].colour);
}

/** An instanced mesh filled from scratch every frame. */
class Pool {
  mesh: THREE.InstancedMesh;
  private m: Float32Array;
  private c: Float32Array;
  n = 0;

  constructor(scene: THREE.Scene, geo: THREE.BufferGeometry, mat: THREE.Material, readonly max: number) {
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, WHITE);
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.m = this.mesh.instanceMatrix.array as Float32Array;
    this.c = this.mesh.instanceColor!.array as Float32Array;
    scene.add(this.mesh);
  }

  begin(): void {
    this.n = 0;
  }

  add(x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number, col: THREE.Color, k = 1): void {
    if (this.n >= this.max) return;
    const i = this.n++;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const o = i * 16;
    const m = this.m;
    m[o] = c * sx;
    m[o + 1] = 0;
    m[o + 2] = -s * sx;
    m[o + 3] = 0;
    m[o + 4] = 0;
    m[o + 5] = sy;
    m[o + 6] = 0;
    m[o + 7] = 0;
    m[o + 8] = s * sz;
    m[o + 9] = 0;
    m[o + 10] = c * sz;
    m[o + 11] = 0;
    m[o + 12] = x;
    m[o + 13] = y;
    m[o + 14] = z;
    m[o + 15] = 1;
    this.c[i * 3] = col.r * k;
    this.c[i * 3 + 1] = col.g * k;
    this.c[i * 3 + 2] = col.b * k;
  }

  end(): void {
    this.mesh.count = this.n;
    const im = this.mesh.instanceMatrix;
    im.clearUpdateRanges();
    im.addUpdateRange(0, Math.max(16, this.n * 16));
    im.needsUpdate = true;
    const ic = this.mesh.instanceColor!;
    ic.clearUpdateRanges();
    ic.addUpdateRange(0, Math.max(3, this.n * 3));
    ic.needsUpdate = true;
  }
}

function additive(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
}

export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.OrthographicCamera;
  private pools: Record<string, Pool> = {};
  private arcGeo: THREE.BufferGeometry;
  private arcPos: Float32Array;
  private arcCol: Float32Array;
  private mech: THREE.Group;
  private mechBody: THREE.Mesh;
  private mounts: THREE.Mesh[] = [];
  private conduits: THREE.Mesh[] = [];
  private mechYaw = 0;
  private colours: Record<string, THREE.Color> = {};
  private jag: Float32Array;
  private tmp = new THREE.Color();
  private collapse: THREE.Mesh;
  private halfW = 15;
  private halfH = 8.5;
  shake = 0;

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
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(half * 2, half * 2), new THREE.MeshLambertMaterial({ color: 0x1b2130 }));
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
    // The Overmind's collapsing arena edge
    this.collapse = new THREE.Mesh(new THREE.RingGeometry(0.985, 1, 128), new THREE.MeshBasicMaterial({ color: 0xff2a55, side: THREE.DoubleSide }));
    this.collapse.rotation.x = -Math.PI / 2;
    this.collapse.position.y = 0.05;
    this.collapse.visible = false;
    this.scene.add(this.collapse);

    const lambert = () => new THREE.MeshLambertMaterial({ flatShading: true });
    const S = this.scene;
    // Enemies: silhouettes by role (spiky = fast, round = tank)
    const mite = new THREE.ConeGeometry(0.42, 0.8, 4, 1).rotateX(Math.PI / 2).translate(0, 0.4, 0);
    const skitter = new THREE.ConeGeometry(0.3, 0.9, 3, 1).rotateX(Math.PI / 2).translate(0, 0.3, 0);
    const carapace = new THREE.SphereGeometry(0.9, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.7, 1);
    const splitter = new THREE.OctahedronGeometry(0.6, 0).translate(0, 0.6, 0);
    this.pools.mite = new Pool(S, mite, lambert(), 1500);
    this.pools.skitter = new Pool(S, skitter, lambert(), 1500);
    this.pools.carapace = new Pool(S, carapace, lambert(), 600);
    this.pools.splitter = new Pool(S, splitter, lambert(), 600);
    // Elite glow: an additive disc under the unit
    this.pools.eliteGlow = new Pool(S, new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2), additive(), 64);
    // Bosses
    const brood = new THREE.IcosahedronGeometry(1, 0).scale(1, 0.6, 1.2).translate(0, 0.6, 0);
    this.pools.brood = new Pool(S, brood, lambert(), 2);
    const overmind = new THREE.IcosahedronGeometry(1, 1).scale(1, 1.4, 1).translate(0, 1.4, 0);
    this.pools.overmind = new Pool(S, overmind, lambert(), 2);

    // Weapon effects
    this.pools.bolt = new Pool(S, new THREE.BoxGeometry(0.16, 0.16, 0.7), new THREE.MeshBasicMaterial(), 4000);
    this.pools.missile = new Pool(S, new THREE.ConeGeometry(0.14, 0.55, 4).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial(), 1500);
    this.pools.shell = new Pool(S, new THREE.IcosahedronGeometry(0.28, 0), new THREE.MeshBasicMaterial(), 500);
    this.pools.zone = new Pool(S, new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2), additive(), 1600);
    this.pools.ring = new Pool(S, new THREE.RingGeometry(0.86, 1, 40).rotateX(-Math.PI / 2), additive(), 1600);
    this.pools.blade = new Pool(S, new THREE.BoxGeometry(0.9, 0.08, 0.22), new THREE.MeshBasicMaterial(), 2000);
    // Enemy attacks and hazards
    this.pools.glob = new Pool(S, new THREE.IcosahedronGeometry(0.35, 0), new THREE.MeshBasicMaterial(), 200);
    this.pools.puddle = new Pool(S, new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2), additive(), 200);
    this.pools.beam = new Pool(S, new THREE.BoxGeometry(1, 0.3, 1).translate(0.5, 0, 0), additive(), 16);
    // Pickups: XP cores are faceted spinning gems (a shape no weapon effect uses)
    this.pools.core = new Pool(S, new THREE.OctahedronGeometry(0.22, 0).scale(1, 1.5, 1), new THREE.MeshBasicMaterial(), TUNING.xp.maxCoresOnGround);
    this.pools.pickup = new Pool(S, new THREE.BoxGeometry(0.55, 0.55, 0.55), new THREE.MeshBasicMaterial(), 64);

    // Tesla arcs: flat jagged ribbons, additive
    this.arcPos = new Float32Array(MAX_ARC_SEGS * 6 * 3);
    this.arcCol = new Float32Array(MAX_ARC_SEGS * 6 * 3);
    this.arcGeo = new THREE.BufferGeometry();
    this.arcGeo.setAttribute('position', new THREE.BufferAttribute(this.arcPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.arcGeo.setAttribute('color', new THREE.BufferAttribute(this.arcCol, 3).setUsage(THREE.DynamicDrawUsage));
    const arcMat = additive();
    arcMat.vertexColors = true;
    const arcs = new THREE.Mesh(this.arcGeo, arcMat);
    arcs.frustumCulled = false;
    this.scene.add(arcs);
    // Fixed jag offsets (visual only; never touches the sim RNG)
    this.jag = new Float32Array(97);
    for (let i = 0; i < this.jag.length; i++) this.jag[i] = Math.abs((Math.sin(i * 12.9898) * 43758.5453) % 1);

    // Mech: white chunky frame with cyan trim, weapon mounts per hardpoint
    this.mech = new THREE.Group();
    this.mechBody = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.9, 1.1), new THREE.MeshLambertMaterial({ color: 0xf2f5ff, flatShading: true }));
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
    // Mount spots: shoulders, back, forearms, drone bay
    const spots: [number, number, number][] = [
      [-0.8, 1.35, 0.1],
      [0.8, 1.35, 0.1],
      [0, 1.5, -0.45],
      [-0.85, 0.75, 0.45],
      [0.85, 0.75, 0.45],
      [0, 0.4, -0.6],
    ];
    for (const [x, y, z] of spots) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 0.6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      m.position.set(x, y, z);
      m.visible = false;
      this.mech.add(m);
      this.mounts.push(m);
    }
    for (let i = 0; i < 6; i++) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      c.visible = false;
      this.mech.add(c);
      this.conduits.push(c);
    }
    this.scene.add(this.mech);

    for (const id of Object.keys(TUNING.weapons) as WeaponId[]) {
      this.colours[id] = weaponColour(id);
      this.colours[id + ':t'] = weaponColour(id).multiplyScalar(TUNING.links.triggeredVisualScale);
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
    this.halfH = Math.max(C.viewHeight / 2, C.viewWidth / 2 / aspect);
    this.halfW = this.halfH * aspect;
    this.camera.left = -this.halfW;
    this.camera.right = this.halfW;
    this.camera.top = this.halfH;
    this.camera.bottom = -this.halfH;
    this.camera.updateProjectionMatrix();
  }

  /** Ground point -> CSS pixel position on the canvas. */
  toPixels(w: World, x: number, z: number, cssW: number, cssH: number): { x: number; y: number } {
    const ox = x - w.camX;
    const oz = z - w.camZ;
    const sx = ox * RIGHT.x + oz * RIGHT.z;
    const sy = (ox * UP.x + oz * UP.z) * FORESHORTEN;
    return { x: cssW / 2 + (sx / this.halfW) * (cssW / 2), y: cssH / 2 - (sy / this.halfH) * (cssH / 2) };
  }

  private col(id: WeaponId, triggered: boolean): THREE.Color {
    return this.colours[triggered ? id + ':t' : id];
  }

  render(w: World, alpha: number, realTime: number): void {
    const lerp = (a: number, b: number) => a + (b - a) * alpha;
    const P = this.pools;
    for (const k in P) P[k].begin();
    const tv = TUNING.links.triggeredVisualScale;

    // Camera: orthographic isometric, soft follow simulated in the world
    let cx = lerp(w.pcamX, w.camX);
    let cz = lerp(w.pcamZ, w.camZ);
    if (this.shake > 0) {
      cx += (Math.sin(realTime * 91) * this.shake) / 3;
      cz += (Math.cos(realTime * 77) * this.shake) / 3;
      this.shake = Math.max(0, this.shake - 0.03);
    }
    const pitch = (C.pitchDeg * Math.PI) / 180;
    const dist = 60;
    this.camera.position.set(cx - UP.x * dist * Math.cos(pitch), dist * Math.sin(pitch), cz - UP.z * dist * Math.cos(pitch));
    this.camera.lookAt(cx, 0, cz);

    // Mech
    this.mech.position.set(lerp(w.px, w.x), 0, lerp(w.pz, w.z));
    if (Math.hypot(w.vx, w.vz) > 0.5) {
      let d = Math.atan2(w.vx, w.vz) - this.mechYaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.mechYaw += d * 0.25;
    }
    this.mech.rotation.y = this.mechYaw;
    this.mech.visible = !w.dead || w.tick % 6 < 3;
    const flashing = w.invuln > 0 && Math.floor(realTime * 20) % 2 === 0;
    (this.mechBody.material as THREE.MeshLambertMaterial).emissive.setHex(flashing ? 0xff3355 : 0x000000);
    this.updateMounts(w);

    // Enemies
    for (const e of w.enemies) {
      const x = lerp(e.px, e.x);
      const z = lerp(e.pz, e.z);
      const yaw = Math.atan2(e.fx, e.fz);
      const flash = w.tick - e.lastHit <= TUNING.sim.hitFlashTicks;
      const col = flash ? WHITE : ENEMY_COLOUR[e.kind];
      if (e.boss) {
        const s = e.r;
        P[e.kind].add(x, 0, z, e.kind === 'overmind' ? realTime * 0.3 : yaw, s, s, s, col);
        if (e.kind === 'brood' && e.boss.telegraph > 0) {
          // Charge telegraph: a red line along the dash
          const pulse = 0.6 + 0.4 * Math.sin(realTime * 30);
          P.beam.add(x, 0.1, z, Math.atan2(e.boss.dirX, e.boss.dirZ) - Math.PI / 2, TUNING.bosses.brood.chargeDistance, 1, 0.5, HAZARD, pulse);
        }
        continue;
      }
      const s = e.r / TUNING.enemies[e.kind as 'mite'].radius;
      P[e.kind].add(x, 0, z, yaw, s, s, s, col);
      if (e.elite) {
        const glow = e.elite === 2 && e.shield > 0 ? 0x66ccff : 0xffffff;
        P.eliteGlow.add(x, 0.03, z, 0, e.r * 1.35, 1, e.r * 1.35, this.tmp.setHex(glow), 0.35 + 0.15 * Math.sin(realTime * 6));
      }
    }
    for (const b of w.bosses) {
      if (b.kind !== 'overmind' || !b.boss) continue;
      for (const s of overmindBeams(b)) {
        const len = Math.hypot(s.x2 - s.x1, s.z2 - s.z1);
        P.beam.add(s.x1, 0.8, s.z1, Math.atan2(s.x2 - s.x1, s.z2 - s.z1) - Math.PI / 2, len, 1, TUNING.bosses.overmind.beamWidth, HAZARD);
      }
    }

    // Weapon effects (triggered effects at ~70% size and brightness)
    for (const b of w.bolts) {
      const k = b.src.triggered ? tv : 1;
      const r = (b.radius / TUNING.weapons.pulse.boltRadius) * k;
      P.bolt.add(lerp(b.px, b.x), 0.7, lerp(b.pz, b.z), Math.atan2(b.dx, b.dz), r, r, k, this.col('pulse', b.src.triggered));
    }
    for (const m of w.missiles) {
      const k = m.src.triggered ? tv : 1;
      P.missile.add(lerp(m.px, m.x), 0.7, lerp(m.pz, m.z), Math.atan2(m.dx, m.dz), k, k, k, this.col('seeker', m.src.triggered));
    }
    for (const s of w.shells) {
      const t = Math.min(1, s.t);
      P.shell.add(s.x0 + (s.x1 - s.x0) * t, 0.5 + Math.sin(t * Math.PI) * 4, s.z0 + (s.z1 - s.z0) * t, 0, 1, 1, 1, this.col('mortar', s.src.triggered));
    }
    for (const z of w.zones) {
      const fade = Math.min(1, z.life / 0.4) * 0.16 * (z.src.triggered ? tv : 1);
      P.zone.add(z.x, 0.04, z.z, 0, z.r, 1, z.r, this.colours[z.src.weapon], fade);
    }
    for (const r of w.rings) {
      const t = 1 - r.life / r.maxLife;
      const rr = r.r * (0.6 + 0.4 * t);
      P.ring.add(r.x, 0.12, r.z, 0, rr, 1, rr, this.colours[r.weapon], (1 - t) * (r.triggered ? tv : 1));
    }
    for (const b of w.soloBlades) P.blade.add(b.x, 0.7, b.z, Math.atan2(b.x - w.x, b.z - w.z) + Math.PI / 2, 1, 1, 1, this.colours.blades);
    for (const b of w.orbitBlades) P.blade.add(b.x, 0.6, b.z, b.angle, tv, tv, tv, this.colours['blades:t']);

    // Hazards
    for (const h of w.hazards) {
      if (h.kind === 'puddle') P.puddle.add(h.x, 0.05, h.z, 0, h.r, 1, h.r, HAZARD, 0.5 * Math.min(1, h.life));
      else {
        const s = h.kind === 'orb' ? 1.3 : 1;
        P.glob.add(lerp(h.px, h.x), 0.6, lerp(h.pz, h.z), 0, s, s, s, h.kind === 'orb' ? ENEMY_COLOUR.overmind : HAZARD);
      }
    }

    // Cores and pickups
    let i = 0;
    for (const c of w.cores) {
      const tier = c.value >= 25 ? 2 : c.value >= 5 ? 1 : 0;
      const s = tier === 2 ? 1.6 : tier === 1 ? 1.25 : 1;
      P.core.add(lerp(c.px, c.x), 0.45 + Math.sin(realTime * 3 + i) * 0.08, lerp(c.pz, c.z), realTime * 2.5 + i, s, s, s, CORE_COLOURS[tier]);
      i++;
    }
    for (const p of w.pickups) {
      const col = this.tmp.setHex(p.kind === 'repair' ? 0xf2f5ff : p.kind === 'magnet' ? 0x3ff2ff : 0xffd84a);
      const s = p.kind === 'cache' ? 1.4 : 1;
      P.pickup.add(p.x, 0.6 + Math.sin(realTime * 4) * 0.1, p.z, realTime * 2, s, s, s, col);
    }

    for (const k in P) P[k].end();

    this.collapse.visible = w.arenaRadius < Infinity;
    if (this.collapse.visible) this.collapse.scale.set(w.arenaRadius, w.arenaRadius, 1);

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
        (m.material as THREE.MeshBasicMaterial).color.setHex(TUNING.weaponInfo[p.weapon.id].colour);
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
        c.scale.set(1.4, a.distanceTo(b), 1.4);
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
      const c = this.tmp.setHex(TUNING.weaponInfo[a.weapon].colour);
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
        v = this.vert(v, px - nx * width, y, pz - nz * width, r, g, b);
        v = this.vert(v, px + nx * width, y, pz + nz * width, r, g, b);
        v = this.vert(v, qx + nx * width, y, qz + nz * width, r, g, b);
        v = this.vert(v, px - nx * width, y, pz - nz * width, r, g, b);
        v = this.vert(v, qx + nx * width, y, qz + nz * width, r, g, b);
        v = this.vert(v, qx - nx * width, y, qz - nz * width, r, g, b);
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
