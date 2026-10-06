/**
 * Olive Depot Idle v0 — pure accrual core (offline, no network).
 * Deterministic given (state, nowMs, seed). Wall clock is an input, not a side effect.
 * Entity: IAMGODIAM C-Corp game IP (repo name does not make this E5 charity).
 */
export const DEPOT_IDLE_VERSION = '0.1.0';
export const SAVE_KEY = 'e5sc_depot_idle_v0';

/** @typedef {{ level: number, wallet: number, pending: number, lastMs: number, bayOn: boolean[] }} DepotState */

export function defaultState(seed, nowMs = 0) {
  const bayCount = (seed?.bays || []).length;
  return {
    level: 1,
    wallet: 0,
    pending: 0,
    lastMs: nowMs,
    bayOn: Array.from({ length: bayCount }, () => true),
  };
}

export function ratePerMin(seed, state) {
  const eco = seed.economy || {};
  const hq = seed.hq || {};
  let rpm = Number(hq.rate_crates_per_min) || 0;
  rpm += (Math.max(1, state.level) - 1) * (Number(eco.upgrade_rate_bonus_per_min) || 0);
  const bays = seed.bays || [];
  for (let i = 0; i < bays.length; i++) {
    if (state.bayOn?.[i]) rpm += Number(bays[i].rate_crates_per_min) || 0;
  }
  return rpm;
}

export function capCrates(seed, state) {
  const eco = seed.economy || {};
  const hq = seed.hq || {};
  return (Number(hq.cap_crates) || 0) + (Math.max(1, state.level) - 1) * (Number(eco.upgrade_cap_bonus) || 0);
}

/**
 * Accrue pending crates from lastMs → nowMs. Pure.
 * @returns {DepotState}
 */
export function accrue(seed, state, nowMs) {
  const s = { ...state, bayOn: [...(state.bayOn || [])] };
  const now = Math.max(Number(nowMs) || 0, Number(s.lastMs) || 0);
  const elapsedMs = now - (Number(s.lastMs) || 0);
  if (elapsedMs <= 0) {
    s.lastMs = now;
    return s;
  }
  const rpm = ratePerMin(seed, s);
  const gained = (elapsedMs / 60000) * rpm;
  const cap = capCrates(seed, s);
  s.pending = Math.min(cap, (Number(s.pending) || 0) + gained);
  s.lastMs = now;
  return s;
}

/** Claim pending into wallet. Pure. */
export function claim(seed, state, nowMs) {
  let s = accrue(seed, state, nowMs);
  const take = Number(s.pending) || 0;
  s = { ...s, wallet: (Number(s.wallet) || 0) + take, pending: 0 };
  return { state: s, claimed: take };
}

/** Spend crates to upgrade depot level. Pure. */
export function upgrade(seed, state, nowMs) {
  let s = accrue(seed, state, nowMs);
  const eco = seed.economy || {};
  const maxLevel = Number(eco.max_level) || 5;
  const cost = Number(eco.upgrade_cost_crates) || 40;
  if (s.level >= maxLevel) return { state: s, ok: false, reason: 'max_level' };
  if ((Number(s.wallet) || 0) < cost) return { state: s, ok: false, reason: 'need_crates' };
  s = { ...s, wallet: s.wallet - cost, level: s.level + 1 };
  return { state: s, ok: true, reason: 'upgraded' };
}

export function toggleBay(seed, state, index, nowMs) {
  let s = accrue(seed, state, nowMs);
  const bayOn = [...(s.bayOn || [])];
  if (index < 0 || index >= (seed.bays || []).length) return s;
  bayOn[index] = !bayOn[index];
  return { ...s, bayOn };
}

export function serialize(state) {
  return JSON.stringify({
    v: DEPOT_IDLE_VERSION,
    level: state.level,
    wallet: Math.floor(state.wallet * 1000) / 1000,
    pending: Math.floor(state.pending * 1000) / 1000,
    lastMs: state.lastMs,
    bayOn: state.bayOn,
  });
}

/**
 * Parse a raw save WITHOUT accruing (the "before" side of a return). Pure.
 * Returns null for a missing/corrupt save. `ffMs` is set only when the save
 * was rewound by the playtest harness (see rewindSave) so simulated returns
 * can never be mistaken for real ones in the trace.
 */
export function parseSave(raw, seed, nowMs = Date.now()) {
  if (!raw) return null;
  try {
    const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!o || typeof o !== 'object') return null;
    const bayCount = (seed?.bays || []).length;
    const bayOn = Array.isArray(o.bayOn)
      ? o.bayOn.slice(0, bayCount).map(Boolean)
      : Array.from({ length: bayCount }, () => true);
    while (bayOn.length < bayCount) bayOn.push(true);
    return {
      state: {
        level: Math.max(1, Number(o.level) || 1),
        wallet: Math.max(0, Number(o.wallet) || 0),
        pending: Math.max(0, Number(o.pending) || 0),
        lastMs: Number(o.lastMs) || nowMs,
        bayOn,
      },
      ffMs: Math.max(0, Number(o.ffMs) || 0),
    };
  } catch {
    return null;
  }
}

export function deserialize(raw, seed, nowMs = Date.now()) {
  const parsed = parseSave(raw, seed, nowMs);
  if (!parsed) return defaultState(seed, nowMs);
  return accrue(seed, parsed.state, nowMs);
}

export function loadLocal(seed, storage = globalThis.localStorage, nowMs = Date.now()) {
  try {
    return deserialize(storage?.getItem?.(SAVE_KEY), seed, nowMs);
  } catch {
    return defaultState(seed, nowMs);
  }
}

export function saveLocal(state, storage = globalThis.localStorage) {
  try {
    storage?.setItem?.(SAVE_KEY, serialize(state));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Return-after-timer instrumentation (find / explain / rerun)
// ---------------------------------------------------------------------------

export const TRACE_KEY = 'e5sc_depot_idle_v0_trace';
export const TRACE_MAX = 200;
/** A gap at least this long between sessions counts as "came back after the timer". */
export const RETURN_THRESHOLD_MS = 60_000;

/** Compact, JSON-safe snapshot of state for trace events. */
export function snap(state) {
  return {
    level: state.level,
    wallet: state.wallet,
    pending: state.pending,
    lastMs: state.lastMs,
    bayOn: [...(state.bayOn || [])],
  };
}

/**
 * Explain what an offline gap did, from an un-accrued `before` state. Pure.
 * kind: 'return' (gap >= threshold) | 'resume' (short gap).
 */
export function returnReportFromState(seed, before, nowMs, { simulated = false, via = 'open' } = {}) {
  const after = accrue(seed, before, nowMs);
  const gapMs = Math.max(0, Number(nowMs) - (Number(before.lastMs) || 0));
  const cap = capCrates(seed, before);
  const rpm = ratePerMin(seed, before);
  const uncapped = (Number(before.pending) || 0) + (gapMs / 60000) * rpm;
  return {
    kind: gapMs >= RETURN_THRESHOLD_MS ? 'return' : 'resume',
    via,
    simulated: Boolean(simulated),
    nowMs: Number(nowMs),
    gapMs,
    rpm,
    cap,
    pendingBefore: Number(before.pending) || 0,
    pendingAfter: after.pending,
    gained: after.pending - (Number(before.pending) || 0),
    capped: gapMs > 0 && uncapped > cap + 1e-9,
    /** ms of the gap that produced nothing because the depot sat at cap */
    wastedMs: rpm > 0 ? Math.max(0, gapMs - Math.max(0, (cap - (Number(before.pending) || 0)) / rpm) * 60000) : 0,
    before: snap(before),
    after: snap(after),
  };
}

/** Explain a page-open from the raw save. First open (no save) → kind 'first_open'. Pure. */
export function returnReport(seed, raw, nowMs) {
  const parsed = parseSave(raw, seed, nowMs);
  if (!parsed) {
    const s = defaultState(seed, nowMs);
    return { kind: 'first_open', via: 'open', simulated: false, nowMs, gapMs: 0, rpm: ratePerMin(seed, s), cap: capCrates(seed, s),
      pendingBefore: 0, pendingAfter: 0, gained: 0, capped: false, wastedMs: 0, before: snap(s), after: snap(s) };
  }
  return returnReportFromState(seed, parsed.state, nowMs, { simulated: parsed.ffMs > 0, via: 'open' });
}

/**
 * PLAYTEST ONLY: shift a raw save's lastMs back by `awayMs` so the next load
 * runs the real return path as if the player had been away. Marks the save
 * with ffMs so the resulting return is logged simulated=true. Pure.
 */
export function rewindSave(raw, awayMs, nowMs = Date.now()) {
  let o;
  try { o = raw ? (typeof raw === 'string' ? JSON.parse(raw) : { ...raw }) : null; } catch { o = null; }
  if (!o || typeof o !== 'object') o = { v: DEPOT_IDLE_VERSION, level: 1, wallet: 0, pending: 0, lastMs: nowMs, bayOn: null };
  const ms = Math.max(0, Number(awayMs) || 0);
  o.lastMs = (Number(o.lastMs) || nowMs) - ms;
  o.ffMs = (Number(o.ffMs) || 0) + ms;
  return JSON.stringify(o);
}

/** Append an event to a bounded trace (ring buffer). Pure. */
export function appendTrace(trace, evt, max = TRACE_MAX) {
  const next = [...(Array.isArray(trace) ? trace : []), evt];
  return next.length > max ? next.slice(next.length - max) : next;
}

export function loadTrace(storage = globalThis.localStorage) {
  try {
    const t = JSON.parse(storage?.getItem?.(TRACE_KEY) || '[]');
    return Array.isArray(t) ? t : [];
  } catch {
    return [];
  }
}

export function saveTrace(trace, storage = globalThis.localStorage) {
  try {
    storage?.setItem?.(TRACE_KEY, JSON.stringify(trace));
    return true;
  } catch {
    return false;
  }
}

/**
 * Re-run one recorded event against the pure core and compare. Pure.
 * Events that carry `before` + `nowMs` are deterministic and replayable.
 * @returns {{ ok: boolean, kind: string, skipped?: boolean, why?: string }}
 */
export function replayEvent(seed, evt) {
  const eps = 1e-6;
  const near = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < eps;
  const sameState = (a, b) => a && b && a.level === b.level && near(a.wallet, b.wallet) && near(a.pending, b.pending)
    && Number(a.lastMs) === Number(b.lastMs) && JSON.stringify(a.bayOn) === JSON.stringify(b.bayOn);
  if (!evt || !evt.before || evt.nowMs == null || !evt.after) return { ok: true, kind: evt?.kind, skipped: true };
  let got;
  switch (evt.kind) {
    case 'return':
    case 'resume':
    case 'first_open':
      got = accrue(seed, evt.before, evt.nowMs); break;
    case 'claim':
      got = claim(seed, evt.before, evt.nowMs).state; break;
    case 'upgrade':
      got = upgrade(seed, evt.before, evt.nowMs).state; break;
    case 'toggle':
      got = toggleBay(seed, evt.before, evt.bay, evt.nowMs); break;
    case 'ff':
      got = { ...accrue(seed, evt.before, evt.nowMs) };
      got = { ...got, lastMs: got.lastMs - (Number(evt.awayMs) || 0) };
      break;
    default:
      return { ok: true, kind: evt.kind, skipped: true };
  }
  const ok = sameState(snap(got), evt.after);
  return ok ? { ok, kind: evt.kind } : { ok, kind: evt.kind, why: `expected ${JSON.stringify(evt.after)} got ${JSON.stringify(snap(got))}` };
}

/** Roll a trace up into the numbers a playtest note needs. Pure. */
export function summarizeTrace(trace) {
  const t = Array.isArray(trace) ? trace : [];
  const returns = t.filter(e => e.kind === 'return');
  const real = returns.filter(e => !e.simulated);
  const sim = returns.filter(e => e.simulated);
  const claimsAfterReturn = t.filter((e, i) => e.kind === 'claim' && t.slice(0, i).some(r => r.kind === 'return' && !r.simulated));
  return {
    events: t.length,
    opens: t.filter(e => e.via === 'open').length,
    realReturns: real.length,
    simulatedReturns: sim.length,
    maxRealGapMs: real.reduce((m, e) => Math.max(m, e.gapMs || 0), 0),
    realReturnsCapped: real.filter(e => e.capped).length,
    claims: t.filter(e => e.kind === 'claim').length,
    claimsAfterRealReturn: claimsAfterReturn.length,
    upgrades: t.filter(e => e.kind === 'upgrade' && e.ok).length,
    firstMs: t[0]?.nowMs ?? t[0]?.t ?? null,
    lastMs: t[t.length - 1]?.nowMs ?? t[t.length - 1]?.t ?? null,
  };
}
