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

export function deserialize(raw, seed, nowMs = Date.now()) {
  if (!raw) return defaultState(seed, nowMs);
  try {
    const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const bayCount = (seed?.bays || []).length;
    const bayOn = Array.isArray(o.bayOn)
      ? o.bayOn.slice(0, bayCount).map(Boolean)
      : Array.from({ length: bayCount }, () => true);
    while (bayOn.length < bayCount) bayOn.push(true);
    return accrue(
      seed,
      {
        level: Math.max(1, Number(o.level) || 1),
        wallet: Math.max(0, Number(o.wallet) || 0),
        pending: Math.max(0, Number(o.pending) || 0),
        lastMs: Number(o.lastMs) || nowMs,
        bayOn,
      },
      nowMs,
    );
  } catch {
    return defaultState(seed, nowMs);
  }
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
