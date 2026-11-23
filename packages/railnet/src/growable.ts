type TypedArray = Float64Array | Int32Array | Uint8Array | Float32Array;
type TypedArrayConstructor<T extends TypedArray> = new (length: number) => T;

/** Append-only typed array that doubles its capacity as needed. */
export class Growable<T extends TypedArray> {
  private data: T;
  length = 0;
  private readonly Ctor: TypedArrayConstructor<T>;

  constructor(Ctor: TypedArrayConstructor<T>, capacity = 1024) {
    this.Ctor = Ctor;
    this.data = new Ctor(capacity);
  }

  push(value: number): void {
    if (this.length === this.data.length) {
      const next = new this.Ctor(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data[this.length++] = value;
  }

  /** Trimmed copy of the contents. */
  finish(): T {
    return this.data.slice(0, this.length) as T;
  }
}

/** Index of `value` in an ascending array, or -1. */
export function binarySearch(
  sorted: ArrayLike<number>,
  value: number,
  length = sorted.length,
): number {
  let lo = 0;
  let hi = length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const v = sorted[mid]!;
    if (v === value) return mid;
    if (v < value) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}
