/** Seeded PRNG (sfc32). Every random draw in the simulation goes through one of these, so a match replays from its seed. */
export type Rng = {
  next(): number;
  range(min: number, max: number): number;
  gauss(): number;
  state(): [number, number, number, number];
};

export function createRng(seed: number, restore?: [number, number, number, number]): Rng {
  let [a, b, c, d] = restore ?? [0x9e3779b9, 0x243f6a88, 0xb7e15162, seed >>> 0];
  const next = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    const r = (t + d) | 0;
    c = (c + r) | 0;
    return (r >>> 0) / 4294967296;
  };
  if (!restore) for (let i = 0; i < 16; i++) next();
  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    gauss: () => Math.sqrt(-2 * Math.log(Math.max(1e-12, next()))) * Math.cos(2 * Math.PI * next()),
    state: () => [a >>> 0, b >>> 0, c >>> 0, d >>> 0],
  };
}
