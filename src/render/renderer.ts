// Three.js view of the simulation. The player is the supplied Neon Sentinel model
// (src/assets/sentinel.glb); everything else is generated in code: low-poly flat-shaded
// models, canvas-texture floors, additive effects, and bloom. Instanced pools keep draw
// calls flat regardless of entity counts.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import sentinelUrl from '../assets/sentinel.glb?url';
import { TUNING, type BiomeId, type EnemyKind, type WeaponId } from '../tuning';
import { UP, RIGHT, FORESHORTEN } from '../sim/view';
import { overmindBeams } from '../sim/bosses';
import type { World, WorldEvent } from '../sim/world';
import * as M from './models';
import { Environment } from './env';

const C = TUNING.camera;
/** The model is 1.7 u tall; this makes VANGUARD ~2.3 u tall (2-3x a Mite). Frames scale from here. */
const MODEL_SCALE = 1.35;
/** Mech speed (u/s) at which the run cycle plays at its authored rate. */
const RUN_ANIM_SPEED = 5;
const ARC_SUBDIV = 4;
const MAX_ARC_SEGS = 8000;
const MAX_SHARDS = 3000;
const MAX_TRAIL = 2000;

/** One warm hue family per biome: magenta on the Station, red on the Moon. */
const ENEMY_HUES: Record<BiomeId, Record<EnemyKind, number>> = {
  station: { mite: 0xd8246e, skitter: 0xff3d8e, carapace: 0x9c1f5a, spitter: 0xff5aa8, splitter: 0xe0457e, brood: 0xb3164f, overmind: 0xff2a70 },
  moon: { mite: 0xd82a2a, skitter: 0xff4a36, carapace: 0x98201e, spitter: 0xff6a3a, splitter: 0xe0484a, brood: 0xb81c22, overmind: 0xff3036 },
};
const WHITE = new THREE.Color(0xffffff);
const ICE = new THREE.Color(0xd8f4ff);
const CORE_COLOURS = [new THREE.Color(0x3a86ff).multiplyScalar(1.4), new THREE.Color(0x2dff8a).multiplyScalar(1.3), new THREE.Color(0xffc21a).multiplyScalar(1.4)];
const HAZARD = new THREE.Color(0xff5a1f);

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

/** Renderer-side particles (visual only: never touch the simulation). */
interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
  spin: number;
  col: THREE.Color;
}

export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.OrthographicCamera;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private pools: Record<string, Pool> = {};
  private arcGeo: THREE.BufferGeometry;
  private arcPos: Float32Array;
  private arcCol: Float32Array;
  private mech: THREE.Group;
  private mechBody: THREE.Mesh;
  private mechYaw = 0;
  private placeholder = new THREE.Group();
  private mixer: THREE.AnimationMixer | null = null;
  private run: THREE.AnimationAction | null = null;
  private idle: THREE.AnimationAction | null = null;
  private moving = false;
  private lastSimTime = 0;
  private ring: THREE.Mesh;
  private colours: Record<string, THREE.Color> = {};
  private hues: Record<EnemyKind, THREE.Color>;
  private glows: Record<EnemyKind, THREE.Color>;
  private jag: Float32Array;
  private tmp = new THREE.Color();
  private tmp2 = new THREE.Color();
  private collapse: THREE.Mesh;
  private env: Environment | null = null;
  private envWorld: World | null = null;
  private shards: Particle[] = [];
  private trails: Particle[] = [];
  private lastReal = 0;
  private halfW = 15;
  private halfH = 8.5;
  /** 'high': bloom on. 'low': plain render (automatic quality scaling arrives in milestone 4). */
  quality: 'high' | 'low' = 'high';
  /** Resolves when the player model is ready (or failed, falling back to the stand-in frame). */
  readonly modelReady: Promise<void>;
  private markReady!: () => void;
  shake = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.gl.setClearColor(0x07090e);
    this.gl.info.autoReset = false;
    this.camera = new THREE.OrthographicCamera(-15, 15, 8.5, -8.5, 0.1, 200);
    this.scene.background = new THREE.Color(0x07090e);

    // Lighting: one directional + ambient
    this.scene.add(new THREE.AmbientLight(0x8a90a8, 1.3));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(-20, 40, 10);
    this.scene.add(sun);

    // Post: bloom on emissive accents, at half resolution
    this.composer = new EffectComposer(this.gl);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 256), 0.85, 0.45, 0.72);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    // The Overmind's collapsing arena edge
    this.collapse = new THREE.Mesh(new THREE.RingGeometry(0.985, 1, 128), new THREE.MeshBasicMaterial({ color: 0xff2a55, side: THREE.DoubleSide }));
    this.collapse.rotation.x = -Math.PI / 2;
    this.collapse.position.y = 0.05;
    this.collapse.visible = false;
    this.scene.add(this.collapse);

    const S = this.scene;
    const body = () => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    // Enemies: body (lit, hue from instance colour) + glow (unlit, blooms)
    const units: [EnemyKind, M.UnitModel, number][] = [
      ['mite', M.mite(), 1500],
      ['skitter', M.skitter(), 1500],
      ['carapace', M.carapace(), 700],
      ['spitter', M.spitter(), 600],
      ['splitter', M.splitter(), 700],
      ['brood', M.brood(), 2],
      ['overmind', M.overmind(), 2],
    ];
    for (const [kind, model, max] of units) {
      this.pools[kind] = new Pool(S, model.body, body(), max);
      this.pools[kind + ':glow'] = new Pool(S, model.glow, new THREE.MeshBasicMaterial({ vertexColors: true }), max);
    }
    // Elite glow: an additive disc under the unit
    this.pools.eliteGlow = new Pool(S, new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2), additive(), 64);
    this.pools.shadow = new Pool(S, new THREE.CircleGeometry(1, 12).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }), 1500);

    // Weapon effects
    this.pools.bolt = new Pool(S, new THREE.BoxGeometry(0.16, 0.16, 0.9), new THREE.MeshBasicMaterial(), 4000);
    this.pools.missile = new Pool(S, new THREE.ConeGeometry(0.14, 0.55, 4).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial(), 1500);
    this.pools.shell = new Pool(S, new THREE.IcosahedronGeometry(0.28, 0), new THREE.MeshBasicMaterial(), 500);
    this.pools.zone = new Pool(S, new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2), additive(), 1600);
    this.pools.ring = new Pool(S, new THREE.RingGeometry(0.86, 1, 40).rotateX(-Math.PI / 2), additive(), 1600);
    this.pools.blade = new Pool(S, new THREE.BoxGeometry(0.9, 0.08, 0.22), new THREE.MeshBasicMaterial(), 2000);
    this.pools.cone = new Pool(S, new THREE.CircleGeometry(1, 16, -Math.PI / 4, Math.PI / 2).rotateX(-Math.PI / 2), additive(), 8);
    this.pools.rail = new Pool(S, new THREE.BoxGeometry(1, 0.25, 1).translate(0.5, 0, 0), additive(), 400);
    this.pools.mine = new Pool(S, M.mine(), new THREE.MeshBasicMaterial({ vertexColors: true }), 800);
    this.pools.singCore = new Pool(S, new THREE.IcosahedronGeometry(0.5, 1), new THREE.MeshBasicMaterial({ color: 0x050008 }), 400);
    this.pools.singSwirl = new Pool(S, new THREE.RingGeometry(0.2, 1, 24, 1, 0, Math.PI * 1.6).rotateX(-Math.PI / 2), additive(), 400);
    // Enemy attacks and hazards
    this.pools.glob = new Pool(S, new THREE.IcosahedronGeometry(0.35, 0), new THREE.MeshBasicMaterial(), 400);
    this.pools.puddle = new Pool(S, new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2), additive(), 200);
    this.pools.beam = new Pool(S, new THREE.BoxGeometry(1, 0.3, 1).translate(0.5, 0, 0), additive(), 16);
    // Pickups: XP cores are faceted spinning gems (a shape no weapon effect uses)
    this.pools.core = new Pool(S, new THREE.OctahedronGeometry(0.22, 0).scale(1, 1.5, 1), new THREE.MeshBasicMaterial(), TUNING.xp.maxCoresOnGround);
    this.pools.repair = new Pool(S, M.repairKit(), new THREE.MeshBasicMaterial({ vertexColors: true }), 16);
    this.pools.magnet = new Pool(S, M.magnet(), new THREE.MeshBasicMaterial({ vertexColors: true }), 16);
    this.pools.cache = new Pool(S, M.cache(), new THREE.MeshBasicMaterial({ vertexColors: true }), 32);
    // Particles
    this.pools.shard = new Pool(S, M.shard(), new THREE.MeshBasicMaterial(), MAX_SHARDS);
    this.pools.trail = new Pool(S, new THREE.PlaneGeometry(0.22, 0.22).rotateX(-Math.PI / 2), additive(), MAX_TRAIL);

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

    // Mech: the Neon Sentinel model once it loads; a simple frame stands in until then.
    this.mech = new THREE.Group();
    this.mech.add(this.placeholder);
    this.mechBody = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.9, 1.1), new THREE.MeshLambertMaterial({ color: 0xf2f5ff, flatShading: true }));
    this.mechBody.position.y = 0.85;
    this.placeholder.add(this.mechBody);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.12, 1.16), new THREE.MeshBasicMaterial({ color: 0x3ff2ff }));
    trim.position.y = 0.95;
    this.placeholder.add(trim);
    this.scene.add(this.mech);
    // A cyan ring under the player, so the frame never gets lost in the crowd
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.1, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x3ff2ff, transparent: true, opacity: 0.8 }));
    this.ring.position.y = 0.03;
    this.scene.add(this.ring);
    this.modelReady = new Promise((res) => (this.markReady = res));
    this.loadModel();

    for (const id of Object.keys(TUNING.weapons) as WeaponId[]) {
      this.colours[id] = new THREE.Color(TUNING.weaponInfo[id].colour);
      this.colours[id + ':t'] = new THREE.Color(TUNING.weaponInfo[id].colour).multiplyScalar(TUNING.links.triggeredVisualScale);
    }
    this.hues = {} as Record<EnemyKind, THREE.Color>;
    this.glows = {} as Record<EnemyKind, THREE.Color>;
    this.setBiome('station');
  }

  private setBiome(b: BiomeId): void {
    for (const k of Object.keys(ENEMY_HUES[b]) as EnemyKind[]) {
      this.hues[k] = new THREE.Color(ENEMY_HUES[b][k]);
      // Glow: a bright, lighter version of the hue
      this.glows[k] = new THREE.Color(ENEMY_HUES[b][k]).lerp(WHITE, 0.45).multiplyScalar(1.6);
    }
  }

  /** Load the player model (bundled with the page). Keeps the stand-in frame if it fails. */
  private loadModel(): void {
    new GLTFLoader().load(
      sentinelUrl,
      (gltf) => {
        const model = gltf.scene;
        model.traverse((o) => {
          if ((o as THREE.Mesh).isMesh) o.frustumCulled = false;
        });
        this.mixer = new THREE.AnimationMixer(model);
        const clip = (n: string) => gltf.animations.find((a) => a.name === n);
        const run = clip('Running');
        const idle = clip('restpose');
        if (run) this.run = this.mixer.clipAction(run);
        if (idle) this.idle = this.mixer.clipAction(idle);
        this.idle?.play();
        this.placeholder.visible = false;
        this.mech.add(model);
        this.markReady();
      },
      undefined,
      () => {
        console.warn('Neon Swarm: player model failed to load; using the stand-in frame');
        this.markReady();
      },
    );
  }

  /** Model animation: run while moving (paced to speed), rest pose when still. Follows game time. */
  private animateModel(w: World): void {
    if (!this.mixer) return;
    let dt = w.time - this.lastSimTime;
    this.lastSimTime = w.time;
    if (dt < 0 || dt > 0.25) dt = 0;
    const speed = Math.hypot(w.vx, w.vz);
    const moving = speed > 0.5 && !w.dead;
    if (moving !== this.moving) {
      this.moving = moving;
      const from = moving ? this.idle : this.run;
      const to = moving ? this.run : this.idle;
      if (to) {
        to.reset().play();
        if (from) to.crossFadeFrom(from, 0.15, false);
      }
    }
    if (this.run) this.run.timeScale = Math.max(0.6, speed / RUN_ANIM_SPEED);
    this.mixer.update(dt);
  }

  info(): string {
    const i = this.gl.info.render;
    return `draw calls ${i.calls}  triangles ${i.triangles}  px ${this.gl.domElement.width}x${this.gl.domElement.height}`;
  }

  resize(w: number, h: number): void {
    this.gl.setSize(w, h, false);
    const pr = this.gl.getPixelRatio();
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.bloom.resolution.set((w * pr) / 2, (h * pr) / 2);
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

  /** Visual reactions to sim events: death shatters, explosions. */
  onEvents(w: World, events: WorldEvent[]): void {
    for (const ev of events) {
      if (ev.type === 'kill') {
        // Death: the enemy shatters into 4-6 shards that fade within 0.5 s
        const n = ev.kind === 'brood' || ev.kind === 'overmind' ? 24 : 4 + Math.floor(Math.random() * 3);
        const col = ev.frozen ? ICE : this.hues[ev.kind];
        for (let i = 0; i < n && this.shards.length < MAX_SHARDS; i++) this.spawnShard(ev.x, ev.z, ev.r, col);
      } else if (ev.type === 'shatter') {
        const col = this.tmp2.setHex(0xc9a0ff).clone();
        for (let i = 0; i < 8 && this.shards.length < MAX_SHARDS; i++) this.spawnShard(ev.x, ev.z, 1.2, col);
      } else if (ev.type === 'boom') {
        if (ev.r >= 2) this.shake = Math.max(this.shake, 0.18);
      }
    }
    void w;
  }

  private spawnShard(x: number, z: number, r: number, col: THREE.Color): void {
    const a = Math.random() * Math.PI * 2;
    const sp = 2 + Math.random() * 4;
    this.shards.push({
      x: x + Math.cos(a) * r * 0.3,
      y: 0.3 + Math.random() * r * 0.6,
      z: z + Math.sin(a) * r * 0.3,
      vx: Math.cos(a) * sp,
      vy: 2 + Math.random() * 3,
      vz: Math.sin(a) * sp,
      life: 0.5,
      maxLife: 0.5,
      size: 0.6 + Math.random() * 0.6 * Math.max(1, r),
      spin: Math.random() * 10,
      col,
    });
  }

  private col(id: WeaponId, triggered: boolean): THREE.Color {
    return this.colours[triggered ? id + ':t' : id];
  }

  render(w: World, alpha: number, realTime: number): void {
    const lerp = (a: number, b: number) => a + (b - a) * alpha;
    const realDt = Math.min(0.1, Math.max(0, realTime - this.lastReal));
    this.lastReal = realTime;
    const P = this.pools;
    for (const k in P) P[k].begin();
    const tv = TUNING.links.triggeredVisualScale;

    // Environment follows the run's biome
    if (this.envWorld !== w) {
      if (!this.env || this.env.biome !== w.biome) {
        if (this.env) {
          this.scene.remove(this.env.group);
          this.env.dispose();
        }
        this.env = new Environment(w);
        this.scene.add(this.env.group);
        this.setBiome(w.biome);
      }
      this.envWorld = w;
      this.shards.length = 0;
      this.trails.length = 0;
    }

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
    this.env!.update(w, cx, cz, realTime);

    // Mech
    const mx = lerp(w.px, w.x);
    const mz = lerp(w.pz, w.z);
    this.mech.position.set(mx, 0, mz);
    this.mech.scale.setScalar(MODEL_SCALE * TUNING.frames[w.frame].scale);
    this.ring.position.set(mx, 0.03, mz);
    this.ring.scale.setScalar(TUNING.frames[w.frame].scale);
    if (Math.hypot(w.vx, w.vz) > 0.5) {
      let d = Math.atan2(w.vx, w.vz) - this.mechYaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.mechYaw += d * 0.25;
    }
    this.mech.rotation.y = this.mechYaw;
    // Hit flash: the mech blinks while invulnerable; it flickers out as it dies
    const flashing = (w.invuln > 0 && Math.floor(realTime * 20) % 2 === 0) || (w.dead && w.tick % 6 >= 3);
    this.mech.visible = !flashing;
    this.ring.visible = !w.dead;
    (this.mechBody.material as THREE.MeshLambertMaterial).emissive.setHex(0x000000);
    this.animateModel(w);

    // Enemies
    const now = w.time;
    for (const e of w.enemies) {
      const x = lerp(e.px, e.x);
      const z = lerp(e.pz, e.z);
      const yaw = Math.atan2(e.fx, e.fz);
      const flash = w.tick - e.lastHit <= TUNING.sim.hitFlashTicks;
      const frozen = e.frozenUntil > now;
      let col = this.hues[e.kind];
      if (flash) col = WHITE;
      else if (frozen) col = ICE;
      else if (e.slowUntil > now) col = this.tmp.copy(col).lerp(ICE, 0.35);
      const s = e.boss ? e.r : e.r / TUNING.enemies[e.kind as 'mite'].radius;
      const spin = e.kind === 'overmind' ? realTime * 0.3 : yaw;
      P[e.kind].add(x, 0, z, spin, s, s, s, col);
      P[e.kind + ':glow'].add(x, 0, z, spin, s, s, s, frozen ? ICE : this.glows[e.kind]);
      if (!e.boss) P.shadow.add(x, 0.02, z, 0, e.r * 1.1, 1, e.r * 1.1, WHITE);
      if (e.boss?.telegraph) {
        // Brood Mother charge telegraph: a red line along the dash
        const pulse = 0.6 + 0.4 * Math.sin(realTime * 30);
        P.beam.add(x, 0.1, z, Math.atan2(e.boss.dirX, e.boss.dirZ) - Math.PI / 2, TUNING.bosses.brood.chargeDistance, 1, 0.5, HAZARD, pulse);
      }
      if (e.elite) {
        const glow = e.elite === 2 && e.shield > 0 ? 0x66ccff : 0xffffff;
        P.eliteGlow.add(x, 0.03, z, 0, e.r * 1.35, 1, e.r * 1.35, this.tmp2.setHex(glow), 0.35 + 0.15 * Math.sin(realTime * 6));
      }
    }
    for (const b of w.bosses) {
      if (b.kind !== 'overmind' || !b.boss) continue;
      for (const s of overmindBeams(b, w.threat)) {
        const len = Math.hypot(s.x2 - s.x1, s.z2 - s.z1);
        P.beam.add(s.x1, 0.8, s.z1, Math.atan2(s.x2 - s.x1, s.z2 - s.z1) - Math.PI / 2, len, 1, TUNING.bosses.overmind.beamWidth, HAZARD);
      }
    }

    // Weapon effects (triggered effects at ~70% size and brightness)
    for (const b of w.bolts) {
      const k = b.src.triggered ? tv : 1;
      const r = (b.radius / TUNING.weapons.pulse.boltRadius) * k;
      const col = b.shard ? this.tmp2.setHex(0xd4b0ff) : this.col(b.src.weapon === 'pulse' ? 'pulse' : b.src.weapon, b.src.triggered);
      P.bolt.add(lerp(b.px, b.x), 0.7, lerp(b.pz, b.z), Math.atan2(b.dx, b.dz), r, r, k, col);
    }
    for (const m of w.missiles) {
      const k = m.src.triggered ? tv : 1;
      const x = lerp(m.px, m.x);
      const z = lerp(m.pz, m.z);
      P.missile.add(x, 0.7, z, Math.atan2(m.dx, m.dz), k, k, k, this.col('seeker', m.src.triggered));
      // Smoke trail
      if (this.trails.length < MAX_TRAIL && Math.random() < 0.7) {
        this.trails.push({ x, y: 0.65, z, vx: 0, vy: 0.3, vz: 0, life: 0.3, maxLife: 0.3, size: k, spin: 0, col: this.col('seeker', m.src.triggered) });
      }
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
    for (const c of w.cones) {
      const flicker = 0.28 + 0.06 * Math.sin(realTime * 40);
      P.cone.add(c.x, 0.3, c.z, Math.atan2(-c.dirZ, c.dirX), c.range, 1, c.range, this.colours.cryo, flicker);
    }
    for (const f of w.freezes) P.ring.add(f.x, 0.15, f.z, 0, f.r, 1, f.r, this.colours['cryo:t'], f.life / 0.4);
    for (const r of w.rails) {
      const len = Math.hypot(r.x2 - r.x1, r.z2 - r.z1);
      const k = r.life / r.maxLife;
      P.rail.add(r.x1, 0.7, r.z1, Math.atan2(r.x2 - r.x1, r.z2 - r.z1) - Math.PI / 2, len, 1, r.width * (0.4 + 0.6 * k), this.colours[r.triggered ? 'rail:t' : 'rail'], 1.4 * k);
    }
    for (const m of w.mines) {
      const blink = m.arm > 0 ? 0.4 : 0.6 + 0.6 * (Math.sin(realTime * 12 + m.x) > 0 ? 1 : 0);
      const k = m.src.triggered ? tv : 1;
      P.mine.add(m.x, 0, m.z, 0, k, 1, k, this.colours.ion, blink);
    }
    for (const g of w.singularities) {
      const k = g.src.triggered ? tv : 1;
      const pulse = 1 + 0.1 * Math.sin(realTime * 20);
      P.singCore.add(g.x, 0.8, g.z, 0, k * pulse, k * pulse, k * pulse, WHITE);
      P.singSwirl.add(g.x, 0.1, g.z, realTime * 6, g.pull, 1, g.pull, this.colours.singularity, 0.5 * k);
      P.singSwirl.add(g.x, 0.12, g.z, -realTime * 4, g.pull * 0.6, 1, g.pull * 0.6, this.colours.singularity, 0.6 * k);
    }

    // Hazards
    for (const h of w.hazards) {
      if (h.kind === 'puddle') P.puddle.add(h.x, 0.05, h.z, 0, h.r, 1, h.r, HAZARD, 0.5 * Math.min(1, h.life));
      else {
        const s = h.kind === 'orb' ? 1.3 : h.kind === 'spit' ? 0.8 : 1;
        P.glob.add(lerp(h.px, h.x), 0.6, lerp(h.pz, h.z), 0, s, s, s, h.kind === 'orb' ? this.glows.overmind : HAZARD);
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
      const y = 0.7 + Math.sin(realTime * 4) * 0.12;
      if (p.kind === 'repair') P.repair.add(p.x, y, p.z, realTime * 2, 1, 1, 1, this.tmp2.setRGB(1.3, 1.3, 1.3));
      else if (p.kind === 'magnet') P.magnet.add(p.x, y, p.z, realTime * 2, 1, 1, 1, this.tmp2.setRGB(0.4, 1.5, 1.6));
      else P.cache.add(p.x, y, p.z, realTime * 2, 1, 1, 1, this.tmp2.setRGB(1.7, 1.35, 0.4));
    }

    // Particles
    this.updateParticles(this.shards, realDt, 12, P.shard);
    this.updateParticles(this.trails, realDt, 0, P.trail);

    for (const k in P) P[k].end();

    this.collapse.visible = w.arenaRadius < Infinity;
    if (this.collapse.visible) {
      this.collapse.position.set(w.arenaCX, 0.05, w.arenaCZ);
      this.collapse.scale.set(w.arenaRadius, w.arenaRadius, 1);
    }

    this.updateArcs(w);
    this.gl.info.reset();
    if (this.quality === 'high') this.composer.render();
    else this.gl.render(this.scene, this.camera);
  }

  private updateParticles(list: Particle[], dt: number, gravity: number, pool: Pool): void {
    let k = 0;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy -= gravity * dt;
      p.x += p.vx * dt;
      p.y = Math.max(0.05, p.y + p.vy * dt);
      p.z += p.vz * dt;
      p.spin += dt * 8;
      const f = p.life / p.maxLife;
      pool.add(p.x, p.y, p.z, p.spin, p.size * f, p.size * f, p.size * f, p.col, gravity ? 1 : f * 0.8);
      list[k++] = p;
    }
    list.length = k;
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
      const r = Math.min(1.5, c.r * 1.6 + 0.35) * fade;
      const g = Math.min(1.5, c.g * 1.6 + 0.35) * fade;
      const b = Math.min(1.5, c.b * 1.6 + 0.35) * fade;
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
