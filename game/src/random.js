// A small seeded random generator (mulberry32) so a staged screenshot scene or a fresh run
// with a fixed seed always dresses the city and picks traffic colours the same way.

export function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick(rng, list) {
  return list[Math.floor(rng() * list.length) % list.length];
}

export function range(rng, min, max) {
  return min + rng() * (max - min);
}

export function chance(rng, p) {
  return rng() < p;
}
