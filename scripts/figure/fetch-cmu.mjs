// Downloads the CMU motion capture clips the footballer uses (BVH conversion by B. Hahne, mirrored on GitHub by
// una-dinosauria/cmu-mocap) into a folder, for scripts/figure/build-footballer.py.
// Usage: node scripts/figure/fetch-cmu.mjs <folder>
// Licence (mocap.cs.cmu.edu): "This data is free for use in research and commercial projects worldwide." The
// conversion's author places no further restrictions (READMEFIRST.txt, also downloaded).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? 'cmu-bvh';
mkdirSync(out, { recursive: true });
const BASE = 'https://raw.githubusercontent.com/una-dinosauria/cmu-mocap/master';
// walk, jog, run, sprint-ish run, standing (before a kick) and the kick itself.
const CLIPS = ['007/07_01', '016/16_35', '009/09_01', '016/16_45', '010/10_01', '010/10_03'];
for (const c of [...CLIPS.map(x => `data/${x}.bvh`), 'READMEFIRST.txt']) {
  const r = await fetch(`${BASE}/${c}`);
  if (!r.ok) throw new Error(`${c}: HTTP ${r.status}`);
  writeFileSync(join(out, c.split('/').pop()), Buffer.from(await r.arrayBuffer()));
  console.log('fetched', c);
}
