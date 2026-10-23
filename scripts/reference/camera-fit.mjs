// Fits a pinhole camera (position, yaw, pitch, roll, focal length) to pitch points read off the reference image.
const W = 1672, H = 941, cx = W / 2, cy = H / 2;
const sgn = Number(process.argv[2] ?? 1); // which side is the near touchline (z sign of the near box corner)
const P = [
  [[52.5, 0, 3.66 * sgn], [1010, 204]], [[52.5, 0, -3.66 * sgn], [1232, 265]],
  [[52.5, 2.44, 3.66 * sgn], [1010, 111]], [[52.5, 2.44, -3.66 * sgn], [1240, 160]],
  [[47, 0, 9.16 * sgn], [765, 221]], [[47, 0, -9.16 * sgn], [1212, 364]], [[52.5, 0, 9.16 * sgn], [947, 190]],
  [[36, 0, -20.16 * sgn], [1100, 660]], [[36, 0, 20.16 * sgn], [210, 208]],
  [[36, 0, 7.31 * sgn], [400, 305]], [[36, 0, -7.31 * sgn], [790, 502]],
];
function rot(yaw, pitch, roll) {
  // camera basis: forward from yaw (about +y, 0 = +x) and pitch (down negative), roll about forward
  const f = [Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), Math.cos(pitch) * Math.sin(yaw)];
  let r = [-f[2], 0, f[0]]; const rl = Math.hypot(...r); r = r.map(v => v / rl); // right = f × up
  let u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const c = Math.cos(roll), s = Math.sin(roll);
  const r2 = r.map((v, i) => v * c + u[i] * s), u2 = u.map((v, i) => u[i] * c - r[i] * s);
  return { f, r: r2, u: u2 };
}
function project(q, X) {
  const [x, y, z, yaw, pitch, roll, foc] = q;
  const { f, r, u } = rot(yaw, pitch, roll);
  const d = [X[0] - x, X[1] - y, X[2] - z];
  const dz = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];
  const dx = d[0] * r[0] + d[1] * r[1] + d[2] * r[2];
  const dy = d[0] * u[0] + d[1] * u[1] + d[2] * u[2];
  return [cx + foc * dx / dz, cy - foc * dy / dz];
}
// figures: [ground image point, head image point, head height]; their ground positions are unknowns after the 7 camera ones
const FIG = [[[775, 615], [805, 486], 1.8], [[1272, 458], [1295, 353], 1.8], [[1105, 626], [1088, 497], 1.8], [[540, 650], [557, 523], 1.8], [[1097, 264], [1098, 193], 1.55], [[148, 428], [182, 333], 1.72]];
const WL = Number(process.env.WL ?? 1), WF = Number(process.env.WF ?? 1);
const resid = q => [
  ...P.flatMap(([X, p]) => { const pr = project(q, X); return [WL * (pr[0] - p[0]), WL * (pr[1] - p[1])]; }),
  ...FIG.flatMap(([g, h, ht], k) => { const x = q[7 + 2 * k], z = q[8 + 2 * k]; const a = project(q, [x, 0, z]), b = project(q, [x, ht, z]); return [WF * (a[0] - g[0]), WF * (a[1] - g[1]), WF * (b[0] - h[0]), WF * (b[1] - h[1])]; }),
];
const cost = q => resid(q).reduce((a, v) => a + v * v, 0);
// Levenberg–Marquardt with numeric Jacobian
function solve(q) {
  let lambda = 1e-2;
  for (let it = 0; it < 2000; it++) {
    const r0 = resid(q), n = q.length, m = r0.length;
    const J = Array.from({ length: m }, () => new Array(n).fill(0));
    for (let j = 0; j < n; j++) { const h = j >= 3 && j <= 5 ? 1e-6 : 1e-4; const q2 = q.slice(); q2[j] += h; const r1 = resid(q2); for (let i = 0; i < m; i++) J[i][j] = (r1[i] - r0[i]) / h; }
    const A = Array.from({ length: n }, (_, a) => Array.from({ length: n }, (_, b) => J.reduce((s, row) => s + row[a] * row[b], 0)));
    const g = Array.from({ length: n }, (_, a) => J.reduce((s, row, i) => s + row[a] * r0[i], 0));
    for (let a = 0; a < n; a++) A[a][a] *= 1 + lambda;
    // solve A dq = -g (Gaussian elimination)
    const M = A.map((row, i) => [...row, -g[i]]);
    for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]]; for (let r = 0; r < n; r++) if (r !== c) { const k = M[r][c] / M[c][c]; for (let k2 = c; k2 <= n; k2++) M[r][k2] -= k * M[c][k2]; } }
    const dq = M.map((row, i) => row[n] / row[i]);
    const q2 = q.map((v, i) => v + dq[i]);
    if (cost(q2) < cost(q)) { q = q2; lambda *= 0.5; } else lambda *= 4;
    if (lambda > 1e12) break;
  }
  return q;
}
let best = null;
for (const x0 of [5, 15, 25]) for (const z0 of [-40, -25, -10, 10, 25, 40].map(v => v * sgn)) for (const h0 of [10, 20, 30]) {
  const yaw0 = Math.atan2(0 - z0, 45 - x0), pitch0 = -Math.atan2(h0, Math.hypot(45 - x0, z0));
  const q = solve([x0, h0, z0, yaw0, pitch0, 0, 1200, 31, -13, 46, -14, 36, -20, 25, -10, 51, 0, 27, 8].map((v, i) => i >= 7 && (i % 2 === 0) ? v * sgn : v));
  const c = cost(q);
  if (!best || c < best.c) best = { q, c };
}
const q = best.q;
const rms = Math.sqrt(best.c / (P.length + 2 * FIG.length));
console.log('figures ground', FIG.map((_, k) => q[7 + 2 * k].toFixed(1) + ',' + q[8 + 2 * k].toFixed(1)).join('  '));
for (const [g, h, ht] of FIG) {}
const vfov = 2 * Math.atan(H / 2 / q[6]) * 180 / Math.PI;
console.log('side', sgn, 'rms px', rms.toFixed(1));
console.log('camera pos', q.slice(0, 3).map(v => v.toFixed(2)).join(', '), ' yaw', (q[3] * 180 / Math.PI).toFixed(1), 'pitch', (q[4] * 180 / Math.PI).toFixed(1), 'roll', (q[5] * 180 / Math.PI).toFixed(2), ' focal', q[6].toFixed(0), ' vfov', vfov.toFixed(1));
for (const [X, p] of P) { const pr = project(q, X); console.log(X.join(','), p.join(','), '→', pr.map(v => v.toFixed(0)).join(',')); }
// ground point under given image pixels (ball, #10 feet, #9 feet, #11 feet, keeper)
const { f, r, u } = rot(q[3], q[4], q[5]);
const ground = (px, py) => { const dx = (px - cx) / q[6], dy = -(py - cy) / q[6]; const d = [0, 1, 2].map(i => f[i] + r[i] * dx + u[i] * dy); const t = -q[1] / d[1]; return [q[0] + d[0] * t, q[2] + d[2] * t].map(v => v.toFixed(1)).join(', '); };
for (const [n, px, py] of [['ball', 810, 597], ['#10 feet', 780, 615], ['#9 feet', 1275, 458], ['#11 feet', 155, 428], ['keeper', 1095, 262], ['#5 feet', 1100, 625], ['#4 feet', 540, 640], ['image centre', cx, cy], ['bottom centre', cx, H], ['panel top centre', cx, 735]]) console.log(n, ground(px, py));
console.log(JSON.stringify({ q }));
