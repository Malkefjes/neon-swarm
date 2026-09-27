// Uniform grid over the bounded arena, rebuilt every tick. Items are indices into
// the caller's array; iteration order is deterministic.
export class Grid {
  readonly cell: number;
  readonly cols: number;
  readonly origin: number;
  private head: Int32Array;
  private next: Int32Array;

  constructor(halfSize: number, cell: number, capacity: number) {
    this.cell = cell;
    this.origin = -halfSize - cell;
    this.cols = Math.ceil((2 * halfSize + 2 * cell) / cell) + 1;
    this.head = new Int32Array(this.cols * this.cols).fill(-1);
    this.next = new Int32Array(capacity).fill(-1);
  }

  private col(v: number): number {
    const c = Math.floor((v - this.origin) / this.cell);
    return c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c;
  }

  clear(): void {
    this.head.fill(-1);
  }

  insert(i: number, x: number, z: number): void {
    if (i >= this.next.length) {
      const n = new Int32Array(Math.max(i + 1, this.next.length * 2)).fill(-1);
      n.set(this.next);
      this.next = n;
    }
    const k = this.col(z) * this.cols + this.col(x);
    this.next[i] = this.head[k];
    this.head[k] = i;
  }

  /** Calls fn(i) for every item in cells overlapping the square around (x, z) of half-size r. */
  query(x: number, z: number, r: number, fn: (i: number) => void): void {
    const c0 = this.col(x - r);
    const c1 = this.col(x + r);
    const r0 = this.col(z - r);
    const r1 = this.col(z + r);
    for (let row = r0; row <= r1; row++) {
      const base = row * this.cols;
      for (let c = c0; c <= c1; c++) {
        for (let i = this.head[base + c]; i !== -1; i = this.next[i]) fn(i);
      }
    }
  }
}
