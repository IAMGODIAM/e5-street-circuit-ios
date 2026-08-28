/* E5 STREET CIRCUIT — deterministic driving core.
 * Pure module: no DOM, no THREE, no wall clock. Fixed 30Hz tick.
 * Cross-engine determinism: only + - * / sqrt floor min max abs (IEEE754-exact)
 * plus polynomial sin/cos. Seeded mulberry32. FNV-1a state hash.
 */
export const TICK = 1 / 30;
export const SIM_VERSION = '1.3.0';
const PI = 3.141592653589793, TAU = 6.283185307179586;
function sgn(v) { return v > 0 ? 1 : v < 0 ? -1 : 0; }

/* ---------- deterministic math ---------- */
function wrapPi(x) {
  // wrap to [-PI, PI)
  x = x - TAU * Math.floor((x + PI) / TAU);
  return x;
}
export function fsin(x) {
  x = wrapPi(x);
  // odd Taylor to x^11 on [-pi,pi] (max err ~1e-5): deterministic ops only
  const x2 = x * x;
  return x * (1 + x2 * (-1 / 6 + x2 * (1 / 120 + x2 * (-1 / 5040 + x2 * (1 / 362880 + x2 * (-1 / 39916800 + x2 * (1 / 6227020800)))))));
}
export function fcos(x) { return fsin(x + PI / 2); }
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function fnv(h, v) {
  // fold a float into FNV-1a via its rounded integer micro-units
  let n = Math.floor(v * 1000) | 0;
  h ^= (n & 0xff); h = Math.imul(h, 16777619);
  h ^= ((n >> 8) & 0xff); h = Math.imul(h, 16777619);
  h ^= ((n >> 16) & 0xff); h = Math.imul(h, 16777619);
  h ^= ((n >> 24) & 0xff); h = Math.imul(h, 16777619);
  return h >>> 0;
}

/* ---------- spatial hash ---------- */
const CELL = 24;
function cellKey(x, z) { return (Math.floor(x / CELL) + 4096) * 16384 + (Math.floor(z / CELL) + 4096); }
function hashInsert(map, x0, z0, x1, z1, idx) {
  const ax = Math.floor(Math.min(x0, x1) / CELL), bx = Math.floor(Math.max(x0, x1) / CELL);
  const az = Math.floor(Math.min(z0, z1) / CELL), bz = Math.floor(Math.max(z0, z1) / CELL);
  for (let cx = ax; cx <= bx; cx++) for (let cz = az; cz <= bz; cz++) {
    const k = (cx + 4096) * 16384 + (cz + 4096);
    let arr = map.get(k); if (!arr) { arr = []; map.set(k, arr); }
    if (arr[arr.length - 1] !== idx) arr.push(idx);
  }
}

/* ---------- geometry helpers ---------- */
function segDist2(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const L2 = dx * dx + dz * dz;
  let t = L2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + dx * t, qz = az + dz * t;
  const ex = px - qx, ez = pz - qz;
  return { d2: ex * ex + ez * ez, qx, qz, t };
}

/* ---------- car specs ---------- */
export const CARS = {
  cyberkart: { name: 'CYBERKART ONE', color: 0xf5c542, accel: 15.5, top: 36, grip: 7.8, gripHb: 1.9, steer: 0.66, brake: 28 },
  mvmotors:  { name: 'MV SERIES V',   color: 0xd0342c, accel: 14.0, top: 39, grip: 8.3, gripHb: 2.1, steer: 0.58, brake: 27 },
  stockcar:  { name: 'STOCK CAR V1',  color: 0xf2f3f5, accel: 13.0, top: 34, grip: 9.1, gripHb: 2.4, steer: 0.60, brake: 29 },
  sovereign: { name: 'E5 SOVEREIGN',  color: 0xc9a84c, accel: 14.8, top: 37, grip: 8.6, gripHb: 2.0, steer: 0.63, brake: 28 },
};

/* ---------- sim ---------- */
/* DRIVERS (1.3.0): deterministic Block-Explorer stat derivation — shared by
 * client UI, local races, and the worker's seat verifier, so every party
 * computes IDENTICAL stats from (dg, class, supply, serial, xp). Integer FNV
 * chains only; no floats in the derivation path. */
export function driverStats(dg, cls, supply, serial, xp) {
  let h = 2166136261 >>> 0;
  const mix = (v) => { h ^= (v >>> 0); h = Math.imul(h, 16777619) >>> 0; return h; };
  mix(dg | 0);
  const roll = () => { mix(h); return 30 + (h % 41); };            // 30..70 base
  const S = { pace: roll(), launch: roll(), grip: roll(), composure: roll(), resilience: roll() };
  const arch = cls === 'kart' ? { launch: 12, grip: 8, pace: -10 }
             : cls === 'stock' ? { pace: 8, composure: 6, launch: -4 }
             : cls === 'mv' ? { pace: 12, resilience: 6, grip: -6 } : {};
  for (const k in arch) S[k] += arch[k];
  const sup = supply | 0;
  let budget = sup > 0 && sup <= 48 ? 120 : sup <= 144 ? 80 : sup <= 200 ? 40 : 0;
  if ((serial | 0) > 0 && (serial | 0) <= 20) budget += 10;
  const keys = ['pace', 'launch', 'grip', 'composure', 'resilience'];
  while (budget > 0) { mix(budget); S[keys[h % 5]] += Math.min(4, budget); budget -= 4; }
  for (const k of keys) S[k] = Math.max(5, Math.min(95, S[k]));
  const level = Math.min(20, Math.floor(Math.sqrt(Math.max(0, xp | 0) / 100)));
  let g = Math.imul(h ^ 0x9e3779b9, 2654435761) >>> 0;
  for (let l = 0; l < level; l++) {                                 // seed-fixed growth path
    for (let j = 0; j < 2; j++) {
      g = Math.imul(g ^ (g >>> 13), 1274126177) >>> 0;
      const k = keys[g % 5];
      if (S[k] < 100) S[k] += 1;
    }
  }
  return { ...S, level, xp: Math.max(0, xp | 0) };
}

export function createSim(opts) {
  const pack = opts.pack;
  const seed = (opts.seed == null ? 7 : opts.seed) >>> 0;
  const rng = mulberry32(seed);
  const mode = opts.mode || 'roam';               // 'roam' | 'race'
  const course = opts.course || null;             // {pts, cps, laps, start}
  const carSpec = CARS[opts.car || 'sovereign'] || CARS.sovereign;
  /* DRIVERS (1.3.0): bounded multipliers from opts.driver stats (0-100, 50=neutral).
   * mult(v) = 0.9 + 0.002·v → range 0.90..1.10 (±10%). Absent driver ⇒ all 1.0:
   * the tournament baseline and every pre-1.3.0 race replay are bit-identical. */
  const _drv = opts.driver || null;
  const _dm = (v) => 0.9 + 0.002 * Math.max(0, Math.min(100, v | 0));
  const DRV = {
    top: _drv ? _dm(_drv.pace) : 1,
    acc: _drv ? _dm(_drv.launch) : 1,
    grip: _drv ? _dm(_drv.grip) : 1,
    wob: _drv ? (1.15 - 0.003 * Math.max(0, Math.min(100, _drv.composure | 0))) : 1,
    crash: _drv ? (1.15 - 0.003 * Math.max(0, Math.min(100, _drv.resilience | 0))) : 1,
  };
  const trafficN = opts.traffic == null ? 10 : opts.traffic;
  const rivalsN = mode === 'race' ? (opts.rivals == null ? 3 : opts.rivals) : 0;
  const steerMode = opts.steer === 'auto' ? 'auto' : 'manual';

  /* --- world data prep --- */
  const bldg = pack.buildings;
  const bHash = new Map();
  const spdwRazed = new Set([...(pack.speedway_suppress || []), ...(pack.upland_clear || [])]);   // razed under speedways + Upland-empty parcels (1.2.2)
  for (let i = 0; i < bldg.length; i++) {
    if (spdwRazed.has(i)) continue;
    const P = bldg[i].p;
    let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
    for (let j = 0; j < P.length; j++) {
      if (P[j][0] < x0) x0 = P[j][0]; if (P[j][0] > x1) x1 = P[j][0];
      if (P[j][1] < z0) z0 = P[j][1]; if (P[j][1] > z1) z1 = P[j][1];
    }
    bldg[i]._bb = [x0, z0, x1, z1];
    hashInsert(bHash, x0, z0, x1, z1, i);
  }
  // road segments hash (for on-road tests + traffic)
  const roads = pack.roads;
  const rSegs = [];   // {ax,az,bx,bz,w,k,ri,len,heading}
  const rHash = new Map();
  for (let ri = 0; ri < roads.length; ri++) {
    const P = roads[ri].p, w = roads[ri].w || 7, k = roads[ri].k == null ? 1 : roads[ri].k;
    for (let j = 0; j < P.length - 1; j++) {
      const ax = P[j][0], az = P[j][1], bx = P[j + 1][0], bz = P[j + 1][1];
      const dx = bx - ax, dz = bz - az, len = Math.sqrt(dx * dx + dz * dz);
      if (len < 0.5) continue;
      const idx = rSegs.length;
      rSegs.push({ ax, az, bx, bz, w, k, ri, len });
      hashInsert(rHash, ax, az, bx, bz, idx);
    }
  }
  // vertex graph for traffic routing
  const SNAP = 1.5;
  const nkey = (x, z) => (Math.floor(x / SNAP + 0.5) + 8192) * 32768 + (Math.floor(z / SNAP + 0.5) + 8192);
  const gAdj = new Map();   // nodeKey -> [{to, x, z, k}]
  const nPos = new Map();
  for (let ri = 0; ri < roads.length; ri++) {
    const P = roads[ri].p, k = roads[ri].k == null ? 1 : roads[ri].k;
    for (let j = 0; j < P.length - 1; j++) {
      const a = nkey(P[j][0], P[j][1]), b = nkey(P[j + 1][0], P[j + 1][1]);
      if (a === b) continue;
      if (!nPos.has(a)) nPos.set(a, [P[j][0], P[j][1]]);
      if (!nPos.has(b)) nPos.set(b, [P[j + 1][0], P[j + 1][1]]);
      let la = gAdj.get(a); if (!la) { la = []; gAdj.set(a, la); }
      let lb = gAdj.get(b); if (!lb) { lb = []; gAdj.set(b, lb); }
      la.push({ to: b, k }); lb.push({ to: a, k });
    }
  }
  const gNodes = [...gAdj.keys()].sort((a, b) => a - b); // deterministic order

  /* --- parked cars (deterministic layout; obstacles + render data) --- */
  const parked = [];
  {
    const prng = mulberry32(seed ^ 0x9e3779b9);
    for (let i = 0; i < rSegs.length; i++) {
      const s = rSegs[i];
      if (s.k === 0 || s.len < 30) continue;
      if (pack.roads[s.ri] && pack.roads[s.ri].spdw) continue;   // no parking on speedway asphalt (1.2.2)
      const ux = (s.bx - s.ax) / s.len, uz = (s.bz - s.az) / s.len;
      const nx = -uz, nz = ux;
      const off = s.w / 2 + 1.1;
      let t = 14 + prng() * 20;
      while (t < s.len - 14) {
        if (prng() < 0.38) {
          const side = prng() < 0.5 ? 1 : -1;
          const px = s.ax + ux * t + nx * off * side;
          const pz = s.az + uz * t + nz * off * side;
          if (!nearBuilding(px, pz, 1.6)) parked.push({ x: px, z: pz, ux, uz, c: Math.floor(prng() * 6) });
        }
        t += 26 + prng() * 34;
      }
      if (parked.length >= 300) break;
    }
  }
  const pHash = new Map();
  for (let i = 0; i < parked.length; i++) hashInsert(pHash, parked[i].x, parked[i].z, parked[i].x, parked[i].z, i);

  /* --- solids (1.2.4): caller-provided collision circles (the carbon city).
   * ROAM ONLY by contract — race mode and the tournament verifier never receive
   * these, so deterministic race replay is untouched by live world data. --- */
  const solids = (mode === 'roam' && Array.isArray(opts.solids)) ? opts.solids : [];
  const sHash = new Map();
  for (let i = 0; i < solids.length; i++) if (!solids[i].dead) hashInsert(sHash, solids[i].x, solids[i].z, solids[i].x, solids[i].z, i);
  const breakables = !!opts.breakables;                 // roam prop-smash mode (1.2.7)

  function nearBuilding(x, z, r) {
    const arr = bHash.get(cellKey(x, z));
    if (!arr) return false;
    for (let ii = 0; ii < arr.length; ii++) {
      const bb = bldg[arr[ii]]._bb;
      if (x > bb[0] - r && x < bb[2] + r && z > bb[1] - r && z < bb[3] + r) return true;
    }
    return false;
  }

  /* --- point-in-polygon + polygon edge push-out --- */
  function collideBuildings(st, radius) {
    const cands = [];
    for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
      const arr = bHash.get(cellKey(st.x + ox * CELL, st.z + oz * CELL));
      if (arr) for (let ii = 0; ii < arr.length; ii++) if (cands[cands.length - 1] !== arr[ii]) cands.push(arr[ii]);
    }
    let hit = false;
    for (let ci = 0; ci < cands.length; ci++) {
      const B = bldg[cands[ci]], bb = B._bb;
      if (st.x < bb[0] - radius || st.x > bb[2] + radius || st.z < bb[1] - radius || st.z > bb[3] + radius) continue;
      const P = B.p;
      // nearest edge
      let best = null;
      for (let j = 0; j < P.length; j++) {
        const a = P[j], b = P[(j + 1) % P.length];
        const r = segDist2(st.x, st.z, a[0], a[1], b[0], b[1]);
        if (!best || r.d2 < best.d2) best = r;
      }
      // inside test (ray cast +x)
      let inside = false;
      for (let j = 0, l = P.length - 1; j < P.length; l = j++) {
        const zi = P[j][1], zl = P[l][1];
        if ((zi > st.z) !== (zl > st.z)) {
          const xin = (P[l][0] - P[j][0]) * (st.z - zi) / (zl - zi) + P[j][0];
          if (st.x < xin) inside = !inside;
        }
      }
      const d = Math.sqrt(best.d2);
      if (inside || d < radius) {
        // push out along edge normal (away from surface point)
        let nx = st.x - best.qx, nz = st.z - best.qz;
        let nl = Math.sqrt(nx * nx + nz * nz);
        if (nl < 1e-6) { nx = 1; nz = 0; nl = 1; }
        if (inside) { nx = -nx; nz = -nz; }
        const push = inside ? (d + radius) : (radius - d);
        st.x += (nx / nl) * push; st.z += (nz / nl) * push;
        // kill velocity into the wall
        const vn = st.vx * (nx / nl) + st.vz * (nz / nl);
        if (vn < 0) { st.vx -= vn * (nx / nl); st.vz -= vn * (nz / nl); }
        st.vx *= 0.72; st.vz *= 0.72;
        hit = true;
      }
    }
    return hit;
  }

  function roadInfo(x, z) {
    // nearest road seg within cells
    let best = null, bi = -1;
    for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
      const arr = rHash.get(cellKey(x + ox * CELL, z + oz * CELL));
      if (!arr) continue;
      for (let ii = 0; ii < arr.length; ii++) {
        const s = rSegs[arr[ii]];
        const r = segDist2(x, z, s.ax, s.az, s.bx, s.bz);
        if (!best || r.d2 < best.d2) { best = r; bi = arr[ii]; }
      }
    }
    if (!best) return { on: false, d: 99, seg: null };
    const s = rSegs[bi];
    const d = Math.sqrt(best.d2);
    return { on: d <= s.w / 2 + 1.2, d, seg: s, qx: best.qx, qz: best.qz };
  }

  /* --- traffic --- */
  const traffic = [];
  {
    const trng = mulberry32(seed ^ 0x51ab3c);
    let guard = 0;
    while (traffic.length < trafficN && guard++ < 400) {
      const n = gNodes[Math.floor(trng() * gNodes.length)];
      const adj = gAdj.get(n);
      if (!adj || !adj.length) continue;
      const pos = nPos.get(n);
      const nxt = adj[Math.floor(trng() * adj.length)];
      const tp = nPos.get(nxt.to);
      const dx = tp[0] - pos[0], dz = tp[1] - pos[1];
      const L = Math.sqrt(dx * dx + dz * dz); if (L < 2) continue;
      traffic.push({
        x: pos[0], z: pos[1], node: n, to: nxt.to, t: 0, len: L,
        ux: dx / L, uz: dz / L, k: nxt.k, sp: 0, c: Math.floor(trng() * 6),
        stopT: 0,
      });
    }
  }
  const T_SPEED = [7.5, 10.5, 13.5]; // by road class
  function trafficTick(rand) {
    for (let i = 0; i < traffic.length; i++) {
      const c = traffic[i];
      if (c.stopT > 0) { c.stopT -= TICK; c.sp = 0; continue; }
      let target = T_SPEED[c.k] || 10;
      // slow near route end (junction)
      const remain = c.len - c.t;
      if (remain < 14) target = Math.min(target, 4.5 + remain * 0.4);
      // car-following: same edge ahead
      for (let j = 0; j < traffic.length; j++) {
        if (j === i) continue;
        const o = traffic[j];
        if (o.node === c.node && o.to === c.to && o.t > c.t && o.t - c.t < 13) { target = Math.min(target, o.sp * 0.8); break; }
      }
      // brake near player
      const pdx = st.x - c.x, pdz = st.z - c.z;
      const pd2 = pdx * pdx + pdz * pdz;
      if (pd2 < 15 * 15) {
        const ahead = pdx * c.ux + pdz * c.uz;
        if (ahead > 0 && ahead < 15) target = Math.min(target, Math.max(0, (ahead - 4) * 0.9));
      }
      c.sp += Math.max(-8 * TICK, Math.min(5 * TICK, target - c.sp));
      c.t += c.sp * TICK;
      if (c.t >= c.len) {
        // pick next edge deterministically
        const adj = gAdj.get(c.to) || [];
        let pick = null;
        if (adj.length) {
          // prefer not going back
          const r = Math.floor(rand() * adj.length);
          pick = adj[r];
          if (adj.length > 1 && pick.to === c.node) pick = adj[(r + 1) % adj.length];
        }
        if (!pick) { c.stopT = 2; c.t = c.len; continue; }
        const from = c.to, fp = nPos.get(from), tp = nPos.get(pick.to);
        const dx = tp[0] - fp[0], dz = tp[1] - fp[1];
        const L = Math.sqrt(dx * dx + dz * dz);
        if (L < 1) { c.stopT = 1; continue; }
        c.node = from; c.to = pick.to; c.t = 0; c.len = L; c.ux = dx / L; c.uz = dz / L; c.k = pick.k;
        c.x = fp[0]; c.z = fp[1];
      } else {
        const fp = nPos.get(c.node);
        c.x = fp[0] + c.ux * c.t;
        c.z = fp[1] + c.uz * c.t;
      }
    }
  }

  /* --- course / racing --- */
  let cps = [], cpR = 30, lapTotal = 0;
  let courseLen = 0, cum = null;
  if (course) {
    cps = course.cps; lapTotal = course.laps;
    cum = [0];
    for (let i = 0; i < course.pts.length - 1; i++) {
      const a = course.pts[i], b = course.pts[i + 1];
      courseLen += Math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2);
      cum.push(courseLen);
    }
  }
  function courseAt(s) {
    // position along course arclength s (wrapped)
    s = s - courseLen * Math.floor(s / courseLen);
    // binary search cum
    let lo = 0, hi = cum.length - 1;
    while (lo < hi - 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
    const a = course.pts[lo], b = course.pts[lo + 1];
    const t = (s - cum[lo]) / Math.max(0.001, cum[lo + 1] - cum[lo]);
    return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t };
  }

  /* --- rivals (race mode): pure-pursuit along course --- */
  const rivals = [];
  if (mode === 'race' && course) {
    const RSPEC = [
      { skill: 0.86, c: 0xd0342c }, // red
      { skill: 0.93, c: 0x2c7fd0 }, // blue
      { skill: 0.99, c: 0xf5c542 }, // yellow
    ];
    for (let i = 0; i < Math.min(rivalsN, 3); i++) {
      const s0 = -(i + 1) * 7;   // staggered grid behind start
      const P = courseAt(s0 + courseLen);
      rivals.push({ s: s0, x: P.x, z: P.z, sp: 0, skill: RSPEC[i].skill, c: RSPEC[i].c, lastX: P.x, lastZ: P.z });
    }
  }
  const RLANE = [-1.8, 1.8, 0];   // fixed lanes per rival seat (1.2.1)
  function rivalTick() {
    // player's lateral lane for follow-gap logic (exact arithmetic)
    let pLat = 0;
    {
      const P0 = courseAt(prog.s + courseLen), P1 = courseAt(prog.s + 3 + courseLen);
      let dx = P1.x - P0.x, dz = P1.z - P0.z;
      const L = Math.sqrt(dx * dx + dz * dz) || 1; dx /= L; dz /= L;
      pLat = (st.x - P0.x) * (-dz) + (st.z - P0.z) * dx;
    }
    for (let i = 0; i < rivals.length; i++) {
      const r = rivals[i];
      // target speed by curvature: sample ahead
      const A = courseAt(r.s + courseLen), B = courseAt(r.s + 16 + courseLen), C = courseAt(r.s + 34 + courseLen);
      const v1x = B.x - A.x, v1z = B.z - A.z, v2x = C.x - B.x, v2z = C.z - B.z;
      const l1 = Math.sqrt(v1x * v1x + v1z * v1z) + 1e-6, l2 = Math.sqrt(v2x * v2x + v2z * v2z) + 1e-6;
      const dot = (v1x * v2x + v1z * v2z) / (l1 * l2);
      const curve = 1 - Math.max(-1, Math.min(1, dot));   // 0 straight .. 2 hairpin
      let target = (34 - curve * 46) * r.skill;
      target = Math.max(8.5, target);
      // rubber-band: if far ahead of player progress, ease; if behind, push
      const lead = r.s - prog.s;
      target *= lead > 120 ? 0.92 : lead < -120 ? 1.06 : 1;
      // follow-gap (1.2.1): queue behind a rival or the player in the same lane — no ghosting
      for (let j = 0; j < rivals.length; j++) {
        if (j === i) continue;
        const gap = rivals[j].s - r.s;
        const dl = RLANE[j % 3] - RLANE[i % 3];
        if (gap > 0 && gap < 8 && dl > -1.2 && dl < 1.2) { const cap = rivals[j].sp * 0.95; if (r.sp > cap) r.sp = cap; }
      }
      {
        const gapP = prog.s - r.s;
        const dlP = pLat - RLANE[i % 3];
        if (gapP > 0 && gapP < 8 && dlP > -1.7 && dlP < 1.7) {
          const pf = Math.sqrt(st.vx * st.vx + st.vz * st.vz) * 0.95;
          const cap = pf > 5 ? pf : 5;
          if (r.sp > cap) r.sp = cap;
        }
      }
      r.sp += Math.max(-30 * TICK, Math.min(11 * TICK, target - r.sp));
      r.s += r.sp * TICK;
      const P = courseAt(r.s + courseLen);
      const Q = courseAt(r.s + 3 + courseLen);
      let tx = Q.x - P.x, tz = Q.z - P.z;
      const TL = Math.sqrt(tx * tx + tz * tz) || 1; tx /= TL; tz /= TL;
      const lane = RLANE[i % 3];
      r.lastX = r.x; r.lastZ = r.z;
      r.x = P.x + (-tz) * lane; r.z = P.z + tx * lane;
    }
  }

  /* --- player state --- */
  const startPos = opts.spawn || (course ? { x: course.pts[0][0], z: course.pts[0][1] } : { x: pack.base.x, z: pack.base.z });
  let startHeading = 0;
  if (course) {
    const a = course.pts[0], b = course.pts[1];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    // heading from vector without atan2: build via angle accumulation — use table search
    startHeading = vecHeading(dx, dz);
  }
  function vecHeading(dx, dz) {
    // deterministic atan2 substitute: coarse+refine binary search over fsin/fcos
    const L = Math.sqrt(dx * dx + dz * dz);
    if (L < 1e-9) return 0;
    const ux = dx / L, uz = dz / L;
    let lo = -PI, hi = PI, mid = 0;
    for (let it = 0; it < 28; it++) {
      mid = (lo + hi) / 2;
      // cross of (cos mid, sin mid) with (ux, uz)
      const cx = fcos(mid) * uz - fsin(mid) * ux;
      if (cx > 0) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  const st = {
    x: startPos.x, z: startPos.z, heading: startHeading,
    vx: 0, vz: 0, steerVis: 0, steerCmd: 0, autoErr: 0, laneOff: 0,
    drift: false, offroad: false, crashT: 0,
  };
  let railFrom = null, railTo = null;
  const poseLog = [];

  /* --- auto-steer: rail follow (roam) + course pursuit with lane offset (race) --- */
  function acquireRail() {
    const ri = roadInfo(st.x, st.z);
    if (!ri.seg) return false;
    const sg = ri.seg;
    const a = nkey(sg.ax, sg.az), b = nkey(sg.bx, sg.bz);
    if (!nPos.has(a) || !nPos.has(b)) return false;
    const fx = fcos(st.heading), fz = fsin(st.heading);
    const d1 = (sg.bx - sg.ax) * fx + (sg.bz - sg.az) * fz;
    if (d1 >= 0) { railFrom = a; railTo = b; } else { railFrom = b; railTo = a; }
    return true;
  }
  function railTarget(bias) {
    if (railFrom == null || !nPos.has(railFrom) || !nPos.has(railTo)) { if (!acquireRail()) return null; }
    let fp = nPos.get(railFrom), tp = nPos.get(railTo);
    let ex = tp[0] - fp[0], ez = tp[1] - fp[1];
    let L = Math.sqrt(ex * ex + ez * ez) || 1; ex /= L; ez /= L;
    let t = (st.x - fp[0]) * ex + (st.z - fp[1]) * ez;
    const px = fp[0] + ex * t, pz = fp[1] + ez * t;
    const odx = st.x - px, odz = st.z - pz;
    if (odx * odx + odz * odz > 26 * 26) {
      if (!acquireRail()) return null;
      fp = nPos.get(railFrom); tp = nPos.get(railTo);
      ex = tp[0] - fp[0]; ez = tp[1] - fp[1];
      L = Math.sqrt(ex * ex + ez * ez) || 1; ex /= L; ez /= L;
      t = (st.x - fp[0]) * ex + (st.z - fp[1]) * ez;
    }
    let guard = 0;
    while (t > L - 7 && guard++ < 3) {
      const adj = gAdj.get(railTo) || [];
      if (!adj.length) break;
      let best = null, bestScore = -1e9;
      for (let i = 0; i < adj.length; i++) {
        const cand = adj[i];
        if (cand.to === railFrom && adj.length > 1) continue;
        const cp = nPos.get(cand.to); if (!cp) continue;
        let cx = cp[0] - tp[0], cz = cp[1] - tp[1];
        const cl = Math.sqrt(cx * cx + cz * cz) || 1; cx /= cl; cz /= cl;
        const straight = cx * ex + cz * ez;
        const side = ex * cz - ez * cx;   // + = candidate to the right of travel
        const score = straight + bias * side * 2.2;
        if (score > bestScore) { bestScore = score; best = cand; }
      }
      if (!best) break;
      railFrom = railTo; railTo = best.to;
      fp = nPos.get(railFrom); tp = nPos.get(railTo);
      ex = tp[0] - fp[0]; ez = tp[1] - fp[1];
      L = Math.sqrt(ex * ex + ez * ez) || 1; ex /= L; ez /= L;
      t = (st.x - fp[0]) * ex + (st.z - fp[1]) * ez;
    }
    const spd0 = Math.sqrt(st.vx * st.vx + st.vz * st.vz);
    let s2 = t + 8 + spd0 * 0.7;
    if (s2 > L) s2 = L;
    return { x: fp[0] + ex * s2, z: fp[1] + ez * s2 };
  }
  function autoSteerValue(bias) {
    let target = null;
    if (course) {
      const spd0 = Math.sqrt(st.vx * st.vx + st.vz * st.vz);
      /* CORRIDOR CLAMP (1.2.3): the car steers toward a chase point on the course
       * polyline; at speed the raw chase distance spans 90° corners and the car
       * drives the CHORD — cutting inside across grass. Shrink the chase distance
       * until the chord's midpoint stays near the line: straights keep the long,
       * stable lookahead; corners force a short one that hugs the arc.
       * Exact math only (squared-distance compares, float muls) — bit-reproducible. */
      let look = 11 + spd0 * 0.74;
      for (let k = 0; k < 3; k++) {
        const Pc = courseAt(prog.s + look + courseLen);
        const Mc = courseAt(prog.s + look * 0.5 + courseLen);
        const mx = (st.x + Pc.x) * 0.5 - Mc.x, mz = (st.z + Pc.z) * 0.5 - Mc.z;
        if (mx * mx + mz * mz <= 12.25) break;   // chord within 3.5m of the line — no real cut
        look *= 0.62;
        if (look < 12) { look = 12; break; }
      }
      const P = courseAt(prog.s + look + courseLen);
      const Q = courseAt(prog.s + look + 6 + courseLen);
      let dx = Q.x - P.x, dz = Q.z - P.z;
      const L = Math.sqrt(dx * dx + dz * dz) || 1; dx /= L; dz /= L;
      const nx = -dz, nz = dx;                       // right normal
      const ri = roadInfo(st.x, st.z);
      const laneMax = ri.seg ? Math.max(1.2, ri.seg.w / 2 - 1.3) : 2.6;
      if (bias > 0.05 || bias < -0.05) st.laneOff += bias * 7 * TICK;
      else st.laneOff -= st.laneOff * Math.min(1, 1.3 * TICK);
      if (st.laneOff > laneMax) st.laneOff = laneMax;
      if (st.laneOff < -laneMax) st.laneOff = -laneMax;
      target = { x: P.x + nx * st.laneOff, z: P.z + nz * st.laneOff };
    } else {
      target = railTarget(bias);
      if (!target) {
        const ri = roadInfo(st.x, st.z);
        if (ri.seg) target = { x: ri.qx, z: ri.qz };
        else return 0;
      }
    }
    const want = vecHeading(target.x - st.x, target.z - st.z);
    let err = wrapPi(want - st.heading);
    st.autoErr = err;
    let sv = err * (course ? 1.9 : 2.5);
    if (sv > 1) sv = 1; if (sv < -1) sv = -1;
    return sv;
  }
  function cornerCap() {
    // generous speed ceiling through upcoming curvature (auto mode keeps the car on the track)
    if (course) {
      const A = courseAt(prog.s + 10 + courseLen), B = courseAt(prog.s + 30 + courseLen), C = courseAt(prog.s + 52 + courseLen);
      const v1x = B.x - A.x, v1z = B.z - A.z, v2x = C.x - B.x, v2z = C.z - B.z;
      const l1 = Math.sqrt(v1x * v1x + v1z * v1z) + 1e-6, l2 = Math.sqrt(v2x * v2x + v2z * v2z) + 1e-6;
      const dot = (v1x * v2x + v1z * v2z) / (l1 * l2);
      const curve = 1 - Math.max(-1, Math.min(1, dot));
      // 1.2.3: with the corridor-clamped chase line the car TRACKS corners instead
      // of cutting them — entry speed must respect the true arc. Lower floor +
      // stronger curvature response keep tight 90° entries inside the asphalt.
      return Math.max(11.5, (34 - curve * 44)) * 1.12;
    }
    return 1e9;
  }
  const prog = { cp: 0, lap: 1, s: 0, lastS: 0 };  // race progress; s = arclength progress estimate
  let raceState = mode === 'race' ? 'countdown' : 'free';
  let cdT = 3.2;              // countdown seconds
  let raceT = 0, lapT = 0, bestLap = null, finished = false, finTime = null;
  const lapTimes = [];

  let tick = 0;
  const events = [];
  function emit(type, data) { events.push({ t: tick, type, ...(data || {}) }); }

  const rand = mulberry32(seed ^ 0xabc123);

  /* --- main tick --- */
  function step(input) {
    // input: {th:0..1, br:0..1, steer:-1..1, hb:0|1, reset:0|1}
    const th = raceState === 'countdown' ? 0 : Math.max(0, Math.min(1, input.th || 0));
    const br = raceState === 'countdown' ? 0 : Math.max(0, Math.min(1, input.br || 0));
    let steer = Math.max(-1, Math.min(1, input.steer || 0));
    const hb = input.hb ? 1 : 0;
    if (steerMode === 'auto' && raceState !== 'countdown') steer = autoSteerValue(steer);
    // precision steering (1.2.0): rate-limited command with self-centering —
    // speed-adaptive rate kills twitch; released wheel returns to center faster.
    {
      const spdF = Math.sqrt(st.vx * st.vx + st.vz * st.vz);
      const centering = (steer > -0.05 && steer < 0.05);
      // auto mode already produces continuous commands — fast follow keeps the
      // rail/pursuit crisp; the human-feel rates apply to manual hands only.
      const rate = steerMode === 'auto' ? (centering ? 9 : 7.5)
                                        : (centering ? 5.2 : 3.8 / (1 + spdF * 0.028));
      let dS = steer - st.steerCmd;
      const lim = rate * TICK;
      if (dS > lim) dS = lim; if (dS < -lim) dS = -lim;
      st.steerCmd += dS;
      steer = st.steerCmd;
    }

    if (raceState === 'countdown') {
      cdT -= TICK;
      if (cdT <= 0) { raceState = 'running'; emit('go'); }
    } else if (raceState === 'running') {
      raceT += TICK; lapT += TICK;
    }

    // reset to course/road
    if (input.reset) {
      if (course) {
        const P = courseAt(prog.s + courseLen);
        const Q = courseAt(prog.s + 6 + courseLen);
        st.x = P.x; st.z = P.z; st.vx = 0; st.vz = 0;
        st.heading = vecHeading(Q.x - P.x, Q.z - P.z);
      } else {
        const ri = roadInfo(st.x, st.z);
        if (ri.seg) { st.x = ri.qx; st.z = ri.qz; st.vx = 0; st.vz = 0; }
      }
      st.laneOff = 0; railFrom = null; railTo = null;
      emit('reset');
    }

    const fx = fcos(st.heading), fz = fsin(st.heading);
    const rx = -fz, rz = fx;
    let fSpeed = st.vx * fx + st.vz * fz;
    let lSpeed = st.vx * rx + st.vz * rz;

    // steering (1.2.0): speed-sensitive ratio + progressive understeer cap.
    // Requested yaw is limited by available lateral acceleration (grip*3.4);
    // the cap engages smoothly (r*(2-r), exact arithmetic) — the chassis pushes
    // wide progressively instead of snapping. Precision-machine turn-in.
    const spd = Math.sqrt(st.vx * st.vx + st.vz * st.vz);
    const steerAng = steer * carSpec.steer / (1 + spd * 0.062);
    if (spd > 0.4) {
      const dir = fSpeed >= 0 ? 1 : -1;
      let omega = dir * steerAng * (spd / (1 + spd * 0.012)) * 2.05;
      const aLatMax = carSpec.grip * DRV.grip * 3.4;
      const aReq = omega < 0 ? -omega * spd : omega * spd;
      if (aReq > aLatMax && aReq > 0.01) {
        const r = aLatMax / aReq;
        omega *= r * (2 - r);
      }
      // composure: absolute yaw-rate ceiling tightens with speed (parking agility kept)
      const yawCap = 1.35 + 14 / (spd + 4);
      if (omega > yawCap) omega = yawCap;
      if (omega < -yawCap) omega = -yawCap;
      st.heading = wrapPi(st.heading + omega * TICK);
    }
    st.steerVis += (steer - st.steerVis) * Math.min(1, 10 * TICK);

    // recompute axes after heading change
    const fx2 = fcos(st.heading), fz2 = fsin(st.heading);
    const rx2 = -fz2, rz2 = fx2;
    fSpeed = st.vx * fx2 + st.vz * fz2;
    lSpeed = st.vx * rx2 + st.vz * rz2;

    // engine / brake / drag
    const ri = roadInfo(st.x, st.z);
    st.offroadPrev = st.offroad;
    st.offroad = !ri.on;
    // 1.2.4: deterministic rough-ground wobble (position+tick seeded — replay-exact)
    if (st.offroad && fSpeed > 5) {
      st.heading += fsin(st.x * 0.73 + st.z * 0.61 + tick * 0.9) * 0.0011 * DRV.wob * (fSpeed > 22 ? 1 : fSpeed / 22);
    }
    const surface = st.offroad ? 0.55 : 1.0;
    let acc = th * carSpec.accel * DRV.acc * surface;
    // top speed limit via drag balance
    const topEff = carSpec.top * DRV.top * (st.offroad ? 0.55 : 1);
    if (fSpeed > topEff) acc = Math.min(acc, 0);
    let dec = br * carSpec.brake;
    // REVERSE (1.2.8): brake past standstill engages a real reverse gear —
    // hold ▼ to back out at up to ~17mph. Steering geometry already flips
    // with motion direction. (Before 1.2.8 reverse did not exist at all:
    // brake pinned the car at zero — the "can't back out" complaints.)
    let racc = 0;
    if (th === 0 && br > 0 && fSpeed < 0.4) { racc = -br * carSpec.accel * DRV.acc * 0.55 * surface; dec = 0; }
    if (steerMode === 'auto') {
      const cap = cornerCap();
      if (fSpeed > cap) { acc = 0; dec = Math.max(dec, Math.min(carSpec.brake, (fSpeed - cap) * 2.4)); }
      // 1.2.3: course-mode anticipatory braking — when the (corridor-clamped) chase
      // point demands a big heading change at speed, shed pace before the apex.
      // The roam chauffeur's trick, tuned lighter for racing.
      if (course) {
        const ea = st.autoErr < 0 ? -st.autoErr : st.autoErr;
        if (ea > 0.55 && fSpeed > 12) { acc = 0; dec = Math.max(dec, Math.min(carSpec.brake, (ea - 0.4) * 20)); }
      }
      // rail turns (roam): ease speed while steering hard
      if (!course) {
        // composed cruise: the chauffeur holds a civil pace on streets
        if (fSpeed > 24) { acc = 0; dec = Math.max(dec, (fSpeed - 24) * 1.5); }
        // anticipatory chauffeur braking: slow by how far the rail bends ahead,
        // before the wheel even builds — makes 90-degree junctions clean.
        const ea = st.autoErr < 0 ? -st.autoErr : st.autoErr;
        if (ea > 0.3 && fSpeed > 10) { acc = 0; dec = Math.max(dec, (ea - 0.2) * 26); }
        const sAbs = steer < 0 ? -steer : steer;
        if (sAbs > 0.82 && fSpeed > 9) { acc = 0; dec = Math.max(dec, 15); }
      }
    }
    // natural drag + rolling
    const drag = 0.28 + (st.offroad ? 1.7 : 0);
    fSpeed += ((acc + racc) - sgn(fSpeed) * dec - fSpeed * drag * 0.055 - sgn(fSpeed) * 0.5) * TICK;
    if (br > 0 && th > 0 && Math.abs(fSpeed) < 0.6) fSpeed = 0;   // both pedals = hold
    // reverse cap
    if (fSpeed < -7.5) fSpeed = -7.5;

    // lateral grip (1.2.0): progressive breakaway — grip fades as slip grows,
    // so slides develop and recover smoothly instead of binary snap.
    const gripBase = (hb ? carSpec.gripHb : carSpec.grip) * DRV.grip;
    const slipAbs = lSpeed < 0 ? -lSpeed : lSpeed;
    let grip = gripBase / (1 + (slipAbs / 6) * (slipAbs / 6) * 0.30);
    const gripFloor = gripBase * 0.45;
    if (grip < gripFloor) grip = gripFloor;
    if (st.offroad) grip *= 0.82;             // 1.2.4: dirt bites less
    const latDecay = Math.max(0, 1 - grip * TICK);
    lSpeed *= latDecay;
    const wasDrift = st.drift;
    st.drift = Math.abs(lSpeed) > 3.4 && spd > 9;
    if (st.drift !== wasDrift) emit(st.drift ? 'driftOn' : 'driftOff');
    if (st.offroad !== st.offroadPrev) emit(st.offroad ? 'offOn' : 'offOff');

    st.vx = fx2 * fSpeed + rx2 * lSpeed;
    st.vz = fz2 * fSpeed + rz2 * lSpeed;
    st.x += st.vx * TICK;
    st.z += st.vz * TICK;

    // collisions
    if (st.crashT > 0) st.crashT -= TICK;
    const hitB = collideBuildings(st, 1.15);
    if (hitB && spd > 7 && st.crashT <= 0) { st.crashT = 0.8; emit('crash', { kind: 'building' }); }
    // parked cars: circle-circle
    for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
      const arr = pHash.get(cellKey(st.x + ox * CELL, st.z + oz * CELL));
      if (!arr) continue;
      for (let ii = 0; ii < arr.length; ii++) {
        const pc = parked[arr[ii]];
        const dx = st.x - pc.x, dz = st.z - pc.z;
        const d2 = dx * dx + dz * dz, R = 2.2;
        if (d2 < R * R && d2 > 1e-9) {
          const d = Math.sqrt(d2);
          st.x = pc.x + (dx / d) * R; st.z = pc.z + (dz / d) * R;
          const vn = st.vx * (dx / d) + st.vz * (dz / d);
          if (vn < 0) { st.vx -= vn * (dx / d) * 1.6; st.vz -= vn * (dz / d) * 1.6; }
          st.vx *= 0.6; st.vz *= 0.6;
          if (spd > 7 && st.crashT <= 0) { st.crashT = 0.8; emit('crash', { kind: 'parked' }); }
        }
      }
    }
    // solids: the carbon city stands solid (1.2.4, roam only)
    if (solids.length) {
      for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
        const arr = sHash.get(cellKey(st.x + ox * CELL, st.z + oz * CELL));
        if (!arr) continue;
        for (let ii = 0; ii < arr.length; ii++) {
          const si = arr[ii];
          const sc = solids[si];
          if (sc.dead) continue;
          const dx = st.x - sc.x, dz = st.z - sc.z;
          const R = (sc.r || 2.6) + 1.1;
          const d2 = dx * dx + dz * dz;
          if (d2 < R * R && d2 > 1e-9) {
            if (breakables && sc.brk && spd > 6) {       // GTA mode: props SMASH at speed
              sc.dead = 1;                               // persists on the shared entry (stays broken this session)
              st.vx *= 0.88; st.vz *= 0.88;              // plow-through scrub, no wall
              emit('solidbreak', { i: si, speed: spd });
              continue;
            }
            const d = Math.sqrt(d2);
            st.x = sc.x + (dx / d) * R; st.z = sc.z + (dz / d) * R;
            const vn = st.vx * (dx / d) + st.vz * (dz / d);
            if (vn < 0) { st.vx -= vn * (dx / d) * 1.6; st.vz -= vn * (dz / d) * 1.6; }
            st.vx *= 0.62; st.vz *= 0.62;
            if (spd > 7 && st.crashT <= 0) { st.crashT = 0.8 * DRV.crash; emit('crash', { kind: 'solid' }); }
          }
        }
      }
    }
    // rivals: circle-circle — no ghosting through race cars (1.2.1)
    for (let i = 0; i < rivals.length; i++) {
      const rc = rivals[i];
      const dx = st.x - rc.x, dz = st.z - rc.z;
      const d2 = dx * dx + dz * dz, R = 2.1;
      if (d2 < R * R && d2 > 1e-9) {
        const d = Math.sqrt(d2);
        st.x = rc.x + (dx / d) * R; st.z = rc.z + (dz / d) * R;
        const vn = st.vx * (dx / d) + st.vz * (dz / d);
        if (vn < 0) { st.vx -= vn * (dx / d) * 1.5; st.vz -= vn * (dz / d) * 1.5; }
        st.vx *= 0.72; st.vz *= 0.72;
        if (spd > 8 && st.crashT <= 0) { st.crashT = 0.7 * DRV.crash; emit('crash', { kind: 'rival' }); }
      }
    }
    // TRACK LIMITS (1.2.8): a clean one-way WALL — a guardrail, never glue.
    // The Chairman's verdict on 1.2.6 field forces: "off-track static … don't
    // stick the car, just make a collision thing so I can't go past a point."
    // So: NO field forces anywhere. Off the asphalt you feel only the normal
    // surface tax. At 22m from the racing line stands a wall: position clamps
    // to the line, the OUTWARD velocity component dies (slight bounce), and
    // tangential/inward motion stays free — slide along it, steer off it, or
    // reverse out. One-way by construction: it can contain, never trap.
    if (mode === 'race' && course) {
      let LP = courseAt(prog.s + courseLen);
      let ldx = st.x - LP.x, ldz = st.z - LP.z;
      let lat2 = ldx * ldx + ldz * ldz;
      if (lat2 > 256 && (tick % 30) === 0) {           // re-acquire tracking (>16m, 1Hz)
        let bD = lat2, bS = prog.s;
        for (let s0 = 0; s0 < courseLen; s0 += 7) {
          const P = courseAt(s0);
          const d2 = (P.x - st.x) * (P.x - st.x) + (P.z - st.z) * (P.z - st.z);
          if (d2 < bD) { bD = d2; bS = s0; }
        }
        if (bS <= prog.s) prog.s = bS;                 // plain backward: always safe
        else if (bS - prog.s <= 60) prog.s = bS;       // small forward: window-equivalent
        else if (bS - prog.s < courseLen * 0.5) prog.s = prog.s + 60; // far forward: creep, no cut
        LP = courseAt(prog.s + courseLen);
        ldx = st.x - LP.x; ldz = st.z - LP.z; lat2 = ldx * ldx + ldz * ldz;
      }
      if (lat2 > 400 && (st.limitT == null || st.limitT <= 0)) { st.limitT = 1.6; emit('limits', {}); } // legality flag at 20m
      if (lat2 > 484) {                                // THE WALL at 22m
        const lat = Math.sqrt(lat2);
        const nx = ldx / lat, nz = ldz / lat;
        st.x = LP.x + nx * 22; st.z = LP.z + nz * 22;  // collision resolve to the line
        const vn = st.vx * nx + st.vz * nz;
        if (vn > 0) {
          st.vx -= vn * nx * 1.25; st.vz -= vn * nz * 1.25;   // kill + slight bounce
          if (vn > 6 && st.crashT <= 0) { st.crashT = 0.6 * DRV.crash; emit('crash', { kind: 'wall' }); }
        }
        // guardrail deflection: a nose-out car at rest would wedge (yaw needs
        // speed, and tire grip wipes injected lateral velocity). So the rail
        // PIVOTS the nose toward the tangent while the driver throttles into
        // it — like scraping along a real guardrail — until forward drive
        // builds along the wall and normal yaw authority returns.
        const spdw2 = st.vx * st.vx + st.vz * st.vz;
        if (th > 0 && spdw2 < 9) {
          const tx = -nz, tz = nx;
          const fdot = fx2 * tx + fz2 * tz;
          const sg = fdot >= 0 ? 1 : -1;
          st.heading = wrapPi(st.heading + sg * 1.5 * TICK);
        }
      }
      if (st.limitT > 0) st.limitT -= TICK;
    }
    // traffic collision (player vs moving)
    for (let i = 0; i < traffic.length; i++) {
      const c = traffic[i];
      const dx = st.x - c.x, dz = st.z - c.z;
      const d2 = dx * dx + dz * dz, R = 2.4;
      if (d2 < R * R && d2 > 1e-9) {
        const d = Math.sqrt(d2);
        st.x = c.x + (dx / d) * R; st.z = c.z + (dz / d) * R;
        const vn = st.vx * (dx / d) + st.vz * (dz / d);
        if (vn < 0) { st.vx -= vn * (dx / d) * 1.7; st.vz -= vn * (dz / d) * 1.7; }
        st.vx *= 0.55; st.vz *= 0.55;
        c.stopT = 2.5;
        if (spd > 6 && st.crashT <= 0) { st.crashT = 0.8; emit('crash', { kind: 'traffic' }); }
      }
    }

    // world bounds
    const bb = worldBB;
    if (st.x < bb[0]) { st.x = bb[0]; st.vx = Math.abs(st.vx) * 0.4; }
    if (st.x > bb[2]) { st.x = bb[2]; st.vx = -Math.abs(st.vx) * 0.4; }
    if (st.z < bb[1]) { st.z = bb[1]; st.vz = Math.abs(st.vz) * 0.4; }
    if (st.z > bb[3]) { st.z = bb[3]; st.vz = -Math.abs(st.vz) * 0.4; }

    // race progress
    if (course && raceState === 'running' && !finished) {
      // progress arclength: advance prog.s toward nearest course point ahead
      // sample window ahead of current s
      let bestD = 1e18, bestS = prog.s;
      for (let ds = -8; ds <= 60; ds += 4) {
        const P = courseAt(prog.s + ds + courseLen);
        const d2 = (P.x - st.x) ** 2 + (P.z - st.z) ** 2;
        if (d2 < bestD) { bestD = d2; bestS = prog.s + ds; }
      }
      prog.s = bestS;
      if (prog.cp < cps.length) {
        const cp = cps[prog.cp];
        const dx = st.x - cp[0], dz = st.z - cp[1];
        const gateArc = (prog.cp + 1) * (courseLen / (cps.length + 1));
        if (dx * dx + dz * dz < cpR * cpR || prog.s > gateArc + 30) {
          prog.cp++;
          emit('checkpoint', { i: prog.cp, of: cps.length });
        }
      }
      // lap gate: all cps hit + near start
      if (prog.cp >= cps.length) {
        const sp0 = course.pts[0];
        const ddx = st.x - sp0[0], ddz = st.z - sp0[1];
        if (ddx * ddx + ddz * ddz < cpR * cpR) {
          lapTimes.push(lapT);
          if (bestLap == null || lapT < bestLap) bestLap = lapT;
          emit('lap', { lap: prog.lap, time: lapT });
          prog.lap++; prog.cp = 0; lapT = 0; prog.s = 0;
          if (prog.lap > lapTotal) {
            finished = true; finTime = raceT; raceState = 'finished';
            emit('finish', { time: raceT, best: bestLap, pos: position() });
          }
        }
      }
    }

    if (mode === 'race' && raceState === 'running') rivalTick();   // grid holds until the green (1.2.1)
    trafficTick(rand);

    if (mode === 'race') poseLog.push(st.x, st.z, st.heading);
    tick++;
  }


  function position() {
    // 1 + rivals whose total progress exceeds player's
    if (!course) return 1;
    const mine = (prog.lap - 1) * courseLen + prog.s;
    let ahead = 0;
    for (let i = 0; i < rivals.length; i++) if (rivals[i].s > mine) ahead++;
    return 1 + ahead;
  }

  const worldBB = [pack.meta ? -2800 : -2800, -1800, 4000, 1400];
  // derive true bbox from roads
  {
    let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
    for (let i = 0; i < roads.length; i++) {
      const P = roads[i].p;
      for (let j = 0; j < P.length; j++) {
        if (P[j][0] < x0) x0 = P[j][0]; if (P[j][0] > x1) x1 = P[j][0];
        if (P[j][1] < z0) z0 = P[j][1]; if (P[j][1] > z1) z1 = P[j][1];
      }
    }
    worldBB[0] = x0 - 60; worldBB[1] = z0 - 60; worldBB[2] = x1 + 60; worldBB[3] = z1 + 60;
  }

  function hash() {
    let h = 2166136261 >>> 0;
    h = fnv(h, st.x); h = fnv(h, st.z); h = fnv(h, st.heading);
    h = fnv(h, st.vx); h = fnv(h, st.vz);
    h = fnv(h, prog.s); h = fnv(h, prog.cp + prog.lap * 100); h = fnv(h, st.laneOff);
    for (let i = 0; i < rivals.length; i++) { h = fnv(h, rivals[i].s); h = fnv(h, rivals[i].sp); }
    for (let i = 0; i < traffic.length; i++) { h = fnv(h, traffic[i].x); h = fnv(h, traffic[i].z); }
    return h >>> 0;
  }

  return {
    step, hash, events, poseLog, steerMode,
    st, prog, rivals, traffic, parked,
    addSolids(list) {                                    // 1.2.7: live solid registration (roam refine)
      for (const sc of list) { const i = solids.length; solids.push(sc); if (!sc.dead) hashInsert(sHash, sc.x, sc.z, sc.x, sc.z, i); }
    },
    removeSolid(i) { if (solids[i]) solids[i].dead = 1; },
    get tick() { return tick; },
    get raceState() { return raceState; },
    get countdown() { return cdT; },
    get raceTime() { return raceT; },
    get lapTime() { return lapT; },
    get bestLap() { return bestLap; },
    get lapTimes() { return lapTimes; },
    get finished() { return finished; },
    get finTime() { return finTime; },
    position, roadInfo, courseAt,
    courseLen, cps, lapTotal, worldBB,
    speed() { return Math.sqrt(st.vx * st.vx + st.vz * st.vz); },
    vecHeading,
  };
}
