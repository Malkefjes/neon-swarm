// The isometric view as the simulation sees it. The sim uses a fixed nominal view
// (TUNING.camera.viewWidth x viewHeight screen units) so spawning never depends on
// the window size, which keeps runs reproducible.
import { TUNING } from '../tuning';

const C = TUNING.camera;
const yaw = (C.yawDeg * Math.PI) / 180;
const pitch = (C.pitchDeg * Math.PI) / 180;

/** Ground direction that renders as screen-right. */
export const RIGHT = { x: Math.cos(yaw), z: -Math.sin(yaw) };
/** Ground direction that renders as screen-up (W moves this way). */
export const UP = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
/** Screen height of one ground unit along UP. */
export const FORESHORTEN = Math.sin(pitch);

export const HALF_W = C.viewWidth / 2;
export const HALF_H = C.viewHeight / 2;

/** Ground offset -> screen offset (screen units; sy positive = up-screen). */
export function toScreen(dx: number, dz: number): { sx: number; sy: number } {
  return {
    sx: dx * RIGHT.x + dz * RIGHT.z,
    sy: (dx * UP.x + dz * UP.z) * FORESHORTEN,
  };
}

/** Screen offset -> ground offset. */
export function toGround(sx: number, sy: number): { dx: number; dz: number } {
  const u = sy / FORESHORTEN;
  return { dx: sx * RIGHT.x + u * UP.x, dz: sx * RIGHT.z + u * UP.z };
}

/** Input (screen axes, +y = up-screen) -> ground direction, not normalised. */
export function inputToGround(ix: number, iy: number): { x: number; z: number } {
  return { x: ix * RIGHT.x + iy * UP.x, z: ix * RIGHT.z + iy * UP.z };
}
