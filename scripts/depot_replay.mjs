#!/usr/bin/env node
/**
 * Olive Depot Idle — rerun a playtest trace export against the pure core.
 *
 *   node scripts/depot_replay.mjs path/to/export.json     (from EXPORT TRACE in depot-idle.html?playtest=1)
 *   npm run playtest:replay -- path/to/export.json
 *
 * find:    lists every return (real vs simulated), gap, crates gained, cap hits
 * explain: summary the playtest note needs (real returns, claims after a real return)
 * rerun:   re-applies each recorded event (return/resume/claim/upgrade/toggle/ff) and fails
 *          non-zero if any recorded `after` differs from what the core computes today.
 * Offline only. Reads a local file; no network.
 */
import { readFile } from 'node:fs/promises';
import { replayEvent, summarizeTrace } from '../www/depot-idle-core.js';

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/depot_replay.mjs <playtest-export.json>');
  process.exit(2);
}
const seed = JSON.parse(await readFile(new URL('../www/depot/olive_depot_seed.json', import.meta.url), 'utf8'));
const bundle = JSON.parse(await readFile(file, 'utf8'));
const trace = Array.isArray(bundle) ? bundle : bundle.trace || [];

const fmtDur = (ms) => {
  const m = Math.floor((ms || 0) / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m` : `${m}m`;
};
const iso = (ms) => (ms ? new Date(ms).toISOString() : '—');

let bad = 0, replayed = 0;
for (const [i, e] of trace.entries()) {
  const r = replayEvent(seed, e);
  if (!r.skipped) replayed++;
  if (!r.ok) bad++;
  if (e.kind === 'return' || e.kind === 'resume' || e.kind === 'first_open' || e.kind === 'claim' || e.kind === 'ff' || !r.ok) {
    const bits = [
      String(i).padStart(3), iso(e.nowMs ?? e.t), (e.kind + (e.via ? '/' + e.via : '')).padEnd(15),
      e.gapMs != null ? `gap=${fmtDur(e.gapMs)} +${(e.gained || 0).toFixed(1)}cr${e.capped ? ' CAP' : ''}${e.simulated ? ' SIMULATED' : ''}` : '',
      e.claimed != null ? `claimed=${e.claimed.toFixed(1)}` : '',
      e.kind === 'ff' ? `away=${fmtDur(e.awayMs)}` : '',
      r.ok ? (r.skipped ? '' : 'rerun=OK') : `rerun=MISMATCH ${r.why}`,
    ].filter(Boolean);
    console.log(bits.join('  '));
  }
}
const s = summarizeTrace(trace);
console.log('\nsummary', JSON.stringify(s, null, 1));
console.log(`\nreplayed ${replayed} events · mismatches ${bad} · real returns ${s.realReturns} · simulated ${s.simulatedReturns}`);
console.log('came-back-after-timer (from trace):', s.realReturns > 0 ? 'Y (real return logged — confirm with the human who played)' : 'UNVERIFIED (no real return in this trace)');
process.exit(bad ? 1 : 0);
