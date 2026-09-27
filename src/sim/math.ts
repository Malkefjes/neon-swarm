/** Length of (x, z). Math.hypot is much slower in V8 and this is on every hot path. */
export function len2(x: number, z: number): number {
  return Math.sqrt(x * x + z * z);
}
