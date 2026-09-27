// Biome environments, generated in code: floors from canvas textures, obstacles,
// vents and crystals. Muted mid-tones so the fight stays the brightest thing on screen.
import * as THREE from 'three';
import { TUNING, type BiomeId } from '../tuning';
import type { World } from '../sim/world';
import { crystal, vent } from './models';

const TILE = 10; // world units per floor texture tile (the Moon shifts in multiples of 20)

/** Deterministic hash for texture noise (visual only). */
function hash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function canvasTexture(draw: (g: CanvasRenderingContext2D, n: number) => void, n = 256): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = n;
  draw(c.getContext('2d')!, n);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function stationFloor(): { map: THREE.Texture; emissive: THREE.Texture } {
  // Clean panels: a 2 x 2 grid of plates per tile, seams, rivets
  const map = canvasTexture((g, n) => {
    g.fillStyle = '#2a3140';
    g.fillRect(0, 0, n, n);
    const h = n / 2;
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        const shade = 42 + Math.floor(hash(i, j) * 8);
        g.fillStyle = `rgb(${shade},${shade + 6},${shade + 18})`;
        g.fillRect(i * h + 3, j * h + 3, h - 6, h - 6);
        g.fillStyle = '#1b2029';
        for (const [x, y] of [
          [8, 8],
          [h - 12, 8],
          [8, h - 12],
          [h - 12, h - 12],
        ]) g.fillRect(i * h + x, j * h + y, 4, 4);
      }
    }
  });
  // Cyan light strips along one seam of each tile
  const emissive = canvasTexture((g, n) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, n, n);
    g.fillStyle = '#1fb8c8';
    g.fillRect(0, n / 2 - 2, n, 3);
    g.fillStyle = '#0b4d57';
    g.fillRect(n / 2 - 1, 0, 2, n);
  });
  return { map, emissive };
}

function moonFloor(): THREE.Texture {
  // Dust, pebbles and shallow craters
  return canvasTexture((g, n) => {
    const img = g.createImageData(n, n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const v = hash(x, y) * 0.5 + hash(Math.floor(x / 8), Math.floor(y / 8)) * 0.5;
        const o = (y * n + x) * 4;
        img.data[o] = 34 + v * 18;
        img.data[o + 1] = 28 + v * 14;
        img.data[o + 2] = 44 + v * 20;
        img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    for (let i = 0; i < 6; i++) {
      const cx = hash(i, 3) * n;
      const cy = hash(i, 7) * n;
      const r = 10 + hash(i, 11) * 26;
      g.strokeStyle = 'rgba(20,14,28,0.7)';
      g.lineWidth = 3;
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = 'rgba(16,12,24,0.35)';
      g.fill();
    }
  });
}

export class Environment {
  readonly group = new THREE.Group();
  private floor: THREE.Mesh;
  private crystals: THREE.InstancedMesh | null = null;
  private ventMeshes: THREE.Mesh[] = [];
  private ventGlow: THREE.Mesh[] = [];
  readonly biome: BiomeId;

  constructor(w: World) {
    this.biome = w.biome;
    const half = TUNING.arena.halfSize;
    if (w.biome === 'station') {
      const { map, emissive } = stationFloor();
      map.repeat.set((half * 2) / TILE, (half * 2) / TILE);
      emissive.repeat.copy(map.repeat);
      this.floor = new THREE.Mesh(
        new THREE.PlaneGeometry(half * 2, half * 2),
        new THREE.MeshLambertMaterial({ map, emissiveMap: emissive, emissive: 0xffffff, emissiveIntensity: 0.9 }),
      );
      this.floor.rotation.x = -Math.PI / 2;
      this.group.add(this.floor);
      // Walls with a cyan light strip
      const wallMat = new THREE.MeshLambertMaterial({ color: 0x46506a, flatShading: true });
      const stripMat = new THREE.MeshBasicMaterial({ color: 0x3ff2ff });
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2;
        const wall = new THREE.Mesh(new THREE.BoxGeometry(half * 2 + 2, 2.4, 1), wallMat);
        wall.position.set(Math.sin(a) * (half + 0.5), 1.2, Math.cos(a) * (half + 0.5));
        wall.rotation.y = a;
        this.group.add(wall);
        const strip = new THREE.Mesh(new THREE.BoxGeometry(half * 2, 0.12, 0.08), stripMat);
        strip.position.set(Math.sin(a) * (half - 0.02), 1.6, Math.cos(a) * (half - 0.02));
        strip.rotation.y = a;
        this.group.add(strip);
      }
      // Obstacles: consoles/crates (boxes) and tanks/pillars (cylinders), with trim lights
      const bodyMat = new THREE.MeshLambertMaterial({ color: 0x566079, flatShading: true });
      const topMat = new THREE.MeshLambertMaterial({ color: 0x6d7892, flatShading: true });
      const trimMat = new THREE.MeshBasicMaterial({ color: 0x2fd4e6 });
      for (const o of w.obstacles) {
        const h = 1.4 + ((o.x * 7 + o.z * 13) % 1.5 + 1.5) % 1.5;
        let mesh: THREE.Mesh;
        let trim: THREE.Mesh;
        if (o.kind === 'box') {
          mesh = new THREE.Mesh(new THREE.BoxGeometry(o.hx * 2, h, o.hz * 2), [bodyMat, bodyMat, topMat, bodyMat, bodyMat, bodyMat]);
          trim = new THREE.Mesh(new THREE.BoxGeometry(o.hx * 2 + 0.04, 0.08, o.hz * 2 + 0.04), trimMat);
        } else {
          mesh = new THREE.Mesh(new THREE.CylinderGeometry(o.hx, o.hx, h, 12), bodyMat);
          trim = new THREE.Mesh(new THREE.CylinderGeometry(o.hx + 0.02, o.hx + 0.02, 0.08, 12), trimMat);
        }
        mesh.position.set(o.x, h / 2, o.z);
        trim.position.set(o.x, h * 0.72, o.z);
        this.group.add(mesh, trim);
      }
      // Airlock vents
      const ventGeo = vent();
      const ventMat = new THREE.MeshLambertMaterial({ vertexColors: true, color: 0x7d879e, flatShading: true });
      const glowGeo = new THREE.RingGeometry(0.7, 1, 32).rotateX(-Math.PI / 2);
      for (const v of w.vents) {
        const m = new THREE.Mesh(ventGeo, ventMat);
        m.position.set(v.x, 0, v.z);
        this.group.add(m);
        this.ventMeshes.push(m);
        const g = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({ color: 0x3ff2ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
        g.position.set(v.x, 0.2, v.z);
        this.group.add(g);
        this.ventGlow.push(g);
      }
    } else {
      // The Moon: a floor that follows the camera, tiles aligned to world space
      const map = moonFloor();
      const size = 240;
      map.repeat.set(size / TILE, size / TILE);
      this.floor = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshLambertMaterial({ map }));
      this.floor.rotation.x = -Math.PI / 2;
      this.group.add(this.floor);
      const n = w.crystals.length;
      this.crystals = new THREE.InstancedMesh(
        crystal(),
        new THREE.MeshLambertMaterial({ vertexColors: true, color: 0xb690ff, emissive: 0x5a2fb0, emissiveIntensity: 0.9, flatShading: true }),
        n,
      );
      this.crystals.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.crystals.frustumCulled = false;
      this.group.add(this.crystals);
    }
  }

  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();

  update(w: World, camX: number, camZ: number, realTime: number): void {
    if (this.biome === 'moon') {
      // Snap the floor to whole tiles so the pattern stays put as the camera moves
      this.floor.position.set(Math.round(camX / TILE) * TILE, 0, Math.round(camZ / TILE) * TILE);
      const mesh = this.crystals!;
      w.crystals.forEach((c, i) => {
        // Shattered crystals grow back from nothing
        const grow = c.regrow > 0 ? Math.max(0, 1 - c.regrow / TUNING.maps.moon.regrow) ** 3 * 0.9 : 1;
        this.q.setFromAxisAngle(this.v.set(0, 1, 0), (c.x * 3.1 + c.z * 1.7) % (Math.PI * 2));
        this.s.setScalar(Math.max(0.001, grow * (c.r / TUNING.maps.moon.crystalRadius)));
        this.m.compose(this.v.set(c.x, 0, c.z), this.q, this.s);
        mesh.setMatrixAt(i, this.m);
      });
      mesh.instanceMatrix.needsUpdate = true;
    } else {
      w.vents.forEach((v, i) => {
        const g = this.ventGlow[i];
        const mat = g.material as THREE.MeshBasicMaterial;
        if (v.active) {
          // Rings sucked inward while the vent pulls
          const t = (realTime * 1.5) % 1;
          const r = TUNING.maps.station.ventRadius * (1 - t);
          g.scale.set(r, 1, r);
          mat.opacity = 0.35 * t;
        } else {
          g.scale.set(2.2, 1, 2.2);
          mat.opacity = 0.08;
        }
      });
    }
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
  }
}
