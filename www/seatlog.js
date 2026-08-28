/* SEAT LOG — the drive-your-seat input contract (engine 1.2.x).
 * One tick = one packed integer:
 *   bits 0-8 : steerQ + 256   (steer quantized to 1/128 steps, -128..128 -> 128..384... packed as q+256 in 0..511)
 *   bit  9   : throttle
 *   bit 10   : brake
 *   bit 11   : handbrake
 *   bit 12   : reset
 * The QUANTIZED steer value (q/128) is what the local sim MUST apply, so the
 * verifier's re-simulation is bit-exact. Log is RLE-encoded [value,count,...].
 */
export const SEAT_LOG_VERSION = 1;

export function quantSteer(s) {
  let q = Math.round(Math.max(-1, Math.min(1, s || 0)) * 128);
  if (q > 128) q = 128; if (q < -128) q = -128;
  return q;
}
export function packTick(steerQ, th, br, hb, reset) {
  return (steerQ + 256) | (th ? 512 : 0) | (br ? 1024 : 0) | (hb ? 2048 : 0) | (reset ? 4096 : 0);
}
export function unpackTick(v) {
  return {
    steer: ((v & 511) - 256) / 128,
    th: (v & 512) ? 1 : 0,
    br: (v & 1024) ? 1 : 0,
    hb: (v & 2048) ? 1 : 0,
    reset: (v & 4096) ? 1 : 0,
  };
}
export function rleEncode(ticks) {
  const out = [];
  let i = 0;
  while (i < ticks.length) {
    const v = ticks[i]; let n = 1;
    while (i + n < ticks.length && ticks[i + n] === v) n++;
    out.push(v, n); i += n;
  }
  return out;
}
export function rleDecode(rle, maxTicks) {
  const out = [];
  for (let i = 0; i + 1 < rle.length; i += 2) {
    const v = rle[i], n = rle[i + 1];
    if (!Number.isInteger(v) || !Number.isInteger(n) || n <= 0 || v < 0 || v > 8191) return null;
    for (let k = 0; k < n; k++) { out.push(v); if (out.length > maxTicks) return null; }
  }
  return out;
}

/* Re-simulate an input log through the engine. Returns the seat result.
 * createSim: the engine factory; pack/course/car/seed define the world.
 * Contract matches the auto trials: ONE LAP from a standing start.  */
export function replaySeat(createSim, pack, course, car, seed, rle, steerMode = 'auto', maxSeconds = 400) {
  const ticks = rleDecode(rle, Math.ceil(maxSeconds * 30) + 1);
  if (!ticks) return { ok: false, error: 'bad_log' };
  const sim = createSim({ pack, mode: 'race', course, car, steer: steerMode === 'manual' ? 'manual' : 'auto', traffic: 0, rivals: 0, seed });
  let lap = null, cursor = 0, used = 0;
  for (let i = 0; i < ticks.length && lap == null; i++) {
    const inp = unpackTick(ticks[i]);
    sim.step(inp);
    used++;
    const evs = sim.events;
    for (; cursor < evs.length; cursor++) if (evs[cursor].type === 'lap') { lap = evs[cursor].time; break; }
  }
  if (lap == null) return { ok: false, error: 'no_lap', ticksUsed: used, hash: sim.hash() };
  return { ok: true, timeMs: Math.round(lap * 1000), ticksUsed: used, hash: sim.hash() };
}
