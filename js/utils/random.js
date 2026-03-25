/** Mulberry32 seeded PRNG — fast, good quality, 32-bit state. */
export class RNG {
  constructor(seed = Date.now()) {
    this.seed = seed >>> 0;
  }

  /** Returns a float in [0, 1). */
  next() {
    let t = (this.seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max]. */
  int(min, max) { return Math.floor(this.next() * (max - min + 1)) + min; }

  /** Float in [min, max). */
  float(min = 0, max = 1) { return this.next() * (max - min) + min; }

  /** Pick a random element from an array. */
  pick(arr) { return arr[this.int(0, arr.length - 1)]; }

  /** Shuffle array in-place (Fisher–Yates). */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** Weighted random choice. weights is an array of numbers. */
  weighted(items, weights) {
    const total = weights.reduce((s, w) => s + w, 0);
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  /** Reset to a new seed. */
  reset(seed) { this.seed = seed >>> 0; }
}

export const rng = new RNG();
