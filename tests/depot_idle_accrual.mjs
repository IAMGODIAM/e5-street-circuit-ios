import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DEPOT_IDLE_VERSION,
  accrue,
  claim,
  defaultState,
  deserialize,
  ratePerMin,
  serialize,
  upgrade,
  RETURN_THRESHOLD_MS,
  appendTrace,
  capCrates,
  parseSave,
  replayEvent,
  returnReport,
  returnReportFromState,
  rewindSave,
  snap,
  summarizeTrace,
  toggleBay,
} from '../www/depot-idle-core.js';

const seed = JSON.parse(
  await readFile(new URL('../www/depot/olive_depot_seed.json', import.meta.url), 'utf8'),
);

assert.equal(seed.hq.addr, '6704 IRON OAK DR');
assert.ok(seed.constraints.offline_only);
assert.equal(seed.constraints.spend_usd, 0);

const t0 = 1_000_000;
let s = defaultState(seed, t0);
assert.equal(s.level, 1);
assert.equal(s.pending, 0);

const rpm = ratePerMin(seed, s);
assert.ok(rpm > 2, `expected hq+bays rate > 2, got ${rpm}`);

// 10 minutes online accrual
s = accrue(seed, s, t0 + 10 * 60_000);
// 10 minutes * rpm crates/min
const expected10 = Math.min(seed.hq.cap_crates, 10 * rpm);
assert.ok(Math.abs(s.pending - expected10) < 1e-9, `pending ${s.pending} vs ${expected10}`);

// twin: same inputs → same pending
const a = accrue(seed, defaultState(seed, t0), t0 + 7 * 60_000);
const b = accrue(seed, defaultState(seed, t0), t0 + 7 * 60_000);
assert.equal(a.pending, b.pending);
assert.equal(serialize(a), serialize(b));

// claim
const claimed = claim(seed, s, s.lastMs);
assert.ok(claimed.claimed > 0);
assert.equal(claimed.state.pending, 0);
assert.ok(claimed.state.wallet >= claimed.claimed - 1e-9);

// upgrade gate — empty wallet cannot upgrade
let u = upgrade(seed, { ...claimed.state, wallet: 0 }, claimed.state.lastMs);
assert.equal(u.ok, false);
assert.equal(u.reason, 'need_crates');

// enough crates → level up
const rich = { ...claimed.state, wallet: Math.max(200, seed.economy.upgrade_cost_crates) };
u = upgrade(seed, rich, rich.lastMs);
assert.equal(u.ok, true);
assert.equal(u.state.level, 2);

// offline round-trip via serialize
const raw = serialize(a);
const back = deserialize(raw, seed, a.lastMs);
assert.equal(back.pending, a.pending);
assert.equal(back.level, a.level);

// ---------------------------------------------------------------------------
// Return-after-timer path: save → leave → reopen → accrue → claim (instrumented)
// ---------------------------------------------------------------------------
const HOUR = 3_600_000;
const tLeave = 5_000_000;
let p0 = defaultState(seed, tLeave);
const savedAtLeave = serialize(p0);

// first open (no save) is explained, not mistaken for a return
const fo = returnReport(seed, null, tLeave);
assert.equal(fo.kind, 'first_open');

// short gap = resume, not a return
const short = returnReport(seed, savedAtLeave, tLeave + RETURN_THRESHOLD_MS - 1);
assert.equal(short.kind, 'resume');

// 20 min real gap → return, uncapped, gain = 20 * rpm
const r20 = returnReport(seed, savedAtLeave, tLeave + 20 * 60_000);
assert.equal(r20.kind, 'return');
assert.equal(r20.simulated, false);
assert.equal(r20.gapMs, 20 * 60_000);
assert.ok(Math.abs(r20.gained - Math.min(capCrates(seed, p0), 20 * rpm)) < 1e-9);
assert.equal(r20.capped, 20 * rpm > capCrates(seed, p0));
// report.after is exactly what the loader produces
assert.equal(r20.after.pending, deserialize(savedAtLeave, seed, tLeave + 20 * 60_000).pending);

// overnight (8h) → capped at HQ cap, wasted time explained
const r8h = returnReport(seed, savedAtLeave, tLeave + 8 * HOUR);
assert.equal(r8h.kind, 'return');
assert.equal(r8h.capped, true);
assert.equal(r8h.pendingAfter, capCrates(seed, p0));
const fillMs = (capCrates(seed, p0) / rpm) * 60_000;
assert.ok(Math.abs(r8h.wastedMs - (8 * HOUR - fillMs)) < 1, `wasted ${r8h.wastedMs}`);

// claim after return moves everything to wallet
const back8 = deserialize(savedAtLeave, seed, tLeave + 8 * HOUR);
const c8 = claim(seed, back8, tLeave + 8 * HOUR);
assert.equal(c8.claimed, capCrates(seed, p0));
assert.equal(c8.state.pending, 0);

// clock skew backwards never produces negative or phantom crates
const skew = returnReport(seed, savedAtLeave, tLeave - HOUR);
assert.equal(skew.gained, 0);
assert.equal(skew.gapMs, 0);

// playtest fast-forward: rewindSave runs the SAME loader path, flagged simulated
const ff = rewindSave(savedAtLeave, 8 * HOUR, tLeave);
assert.equal(parseSave(ff, seed, tLeave).ffMs, 8 * HOUR);
const rff = returnReport(seed, ff, tLeave);
assert.equal(rff.kind, 'return');
assert.equal(rff.simulated, true);
assert.equal(rff.pendingAfter, r8h.pendingAfter); // fast-forward == real wait, numerically
// re-saving clears the marker (serialize never writes ffMs)
assert.equal(parseSave(serialize(deserialize(ff, seed, tLeave)), seed, tLeave).ffMs, 0);
// rewind on a missing/corrupt save still yields a usable save
assert.ok(parseSave(rewindSave('not json', HOUR, tLeave), seed, tLeave));

// resume (iOS background → foreground without reload)
const rres = returnReportFromState(seed, p0, tLeave + 2 * HOUR, { via: 'resume' });
assert.equal(rres.via, 'resume');
assert.equal(rres.kind, 'return');

// trace: ring buffer bound + replay + summary (find / explain / rerun)
let trace = [];
for (let i = 0; i < 250; i++) trace = appendTrace(trace, { kind: 'noop', i }, 200);
assert.equal(trace.length, 200);
assert.equal(trace[0].i, 50);

const tNow = tLeave + 8 * HOUR;
const togBefore = snap(c8.state);
const togAfter = toggleBay(seed, c8.state, 0, tNow + 1000);
const ffEvt = (() => {
  const before = snap(togAfter);
  const acc = accrue(seed, togAfter, tNow + 2000);
  return { kind: 'ff', nowMs: tNow + 2000, awayMs: HOUR, before, after: { ...snap(acc), lastMs: acc.lastMs - HOUR } };
})();
trace = [
  { ...fo, t: tLeave },
  { kind: 'hidden', nowMs: tLeave, state: snap(p0) },
  { ...r8h, t: tNow },
  { kind: 'claim', nowMs: tNow, claimed: c8.claimed, before: snap(back8), after: snap(c8.state) },
  { kind: 'toggle', bay: 0, nowMs: tNow + 1000, before: togBefore, after: snap(togAfter) },
  ffEvt,
  { ...rff, t: tNow + 3000 },
];
for (const e of trace) {
  const r = replayEvent(seed, e);
  assert.ok(r.ok, `replay ${e.kind}: ${r.why || ''}`);
}
// a tampered event is caught
const tampered = { ...trace[3], after: { ...trace[3].after, wallet: 9999 } };
assert.equal(replayEvent(seed, tampered).ok, false);

const sum = summarizeTrace(trace);
assert.equal(sum.realReturns, 1);
assert.equal(sum.simulatedReturns, 1);
assert.equal(sum.claimsAfterRealReturn, 1);
assert.equal(sum.maxRealGapMs, 8 * HOUR);
assert.equal(sum.realReturnsCapped, 1);

console.log(
  `depot return-after-timer OK · 20m +${r20.gained.toFixed(1)} · 8h +${r8h.gained.toFixed(1)} (cap, ${(r8h.wastedMs / 60000).toFixed(0)}m idle) · ff==real · replay ${trace.length} events`,
);

console.log(
  `depot idle OK · v${DEPOT_IDLE_VERSION} · rpm=${rpm.toFixed(2)} · pending@10m=${s.pending.toFixed(2)} · hq=${seed.hq.addr}`,
);
