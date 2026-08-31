// rng.js — deterministic seeded random streams.
// Three logical streams are used across the product and never mixed:
//   'rules'   — anything that can affect simulation outcomes
//   'content' — level generation and validators
//   'decor'   — visual decoration and audiovisual variants
// All arithmetic is 32-bit integer math; results are identical on every
// engine that implements ECMAScript bitwise/number semantics.

/** cyrb53 string hash -> 53-bit integer (deterministic across engines). */
export function hashStr(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0) * 4294967296 + (h1 >>> 0);
}

/** Short hex digest of a string (used for state hashes). */
export function hashHex(str, seed = 0) {
  return hashStr(str, seed).toString(16).padStart(14, '0');
}

/**
 * mulberry32 stream.
 * const r = makeRng('daily-2026-08-16'); r.float(); r.int(1, 6); ...
 */
export function makeRng(seed) {
  let a = (typeof seed === 'number' ? seed >>> 0 : hashStr(String(seed)) >>> 0) || 0x9e3779b9;
  const api = {
    next() {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0);
    },
    /** float in [0, 1) */
    float() { return api.next() / 4294967296; },
    /** integer in [lo, hi] inclusive */
    int(lo, hi) { return lo + (api.next() % (hi - lo + 1)); },
    /** float in [lo, hi) */
    range(lo, hi) { return lo + api.float() * (hi - lo); },
    pick(arr) { return arr[api.next() % arr.length]; },
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = api.next() % (i + 1);
        const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
      return arr;
    },
    /** Derive an independent named sub-stream. */
    fork(label) { return makeRng(hashStr(String(seed) + '|' + String(label))); },
    getState() { return a >>> 0; },
    setState(s) { a = s >>> 0; },
  };
  return api;
}
