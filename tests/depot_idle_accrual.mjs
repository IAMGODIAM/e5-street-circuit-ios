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

console.log(
  `depot idle OK · v${DEPOT_IDLE_VERSION} · rpm=${rpm.toFixed(2)} · pending@10m=${s.pending.toFixed(2)} · hq=${seed.hq.addr}`,
);
