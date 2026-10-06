# Olive Depot Idle — return-after-timer playtest path

**Entity:** IAMGODIAM C-Corp game IP (not E5 charity). **Constraints:** offline only · $0 · no Upland write · no Maps · no parcel buy.
**DoD item:** internal playtest note — *does a person come back after the offline timer?* Deadline ≈ 2026-10-13 3:00 AM ET.

Kept under `docs/` (not `www/`) so playtest docs never ship in the iOS bundle.

## The loop being tested
`leave (save lastMs)` → `offline timer (no network)` → `return (open or iOS resume)` → `accrue (pure core)` → `WHILE YOU WERE AWAY` banner → `claim`.

Economy at v0 (seed `www/depot/olive_depot_seed.json`): 4 crates/min at L1 (HQ 2 + 4 bays × 0.5), cap 120 → **the depot fills in 30 min**. Any longer absence shows `CAP HIT` and how long the depot sat full. That number is the main design signal the note should record. Retuning the cap is a separate call and is not part of this PR.

## Instrumentation (find / explain / rerun)
| | What | Where |
|---|---|---|
| **find** | Every open/resume is logged *before* accrual as `first_open` / `resume` (<60 s gap) / `return` (≥60 s gap), with `via: open\|resume` | `localStorage['e5sc_depot_idle_v0_trace']`, ring buffer of 200 events, local only |
| **explain** | Each return carries `gapMs, rpm, cap, pendingBefore, pendingAfter, gained, capped, wastedMs, simulated, before, after` | `returnReport()` / `returnReportFromState()` in `www/depot-idle-core.js` |
| **rerun** | Each event with `before + nowMs + after` (return/resume/claim/upgrade/toggle/ff) is replayed against the pure core. Exits non-zero on any mismatch | `npm run playtest:replay -- export.json` (`scripts/depot_replay.mjs`) |

iOS note: backgrounding the app usually does **not** reload the WKWebView, so a return on device is usually a `visibilitychange` resume (`via: resume`), not a page open. The tick stops while the app is hidden so `lastMs` freezes at the moment the player left.

Simulated returns are always flagged `simulated: true` and never count toward `realReturns`.

## Harness (dev only): `depot-idle.html?playtest=1`
Without `?playtest=1` the page looks the same as before, except the old always-visible `+5 MIN (DEV)` button is gone (moved into the harness).

- **AWAY 5 MIN / 1 H / 8 H / 24 H**: rewinds the saved `lastMs` (`rewindSave`), then reloads. The real load path runs, and the event is logged `ff` + `return … simulated:true`.
- **URL form:** `depot-idle.html?playtest=1&away=480` does the same on load (480 = minutes), then strips `away` so a refresh doesn't apply it again.
- **EXPORT TRACE**: copies a JSON bundle (save + summary + trace) to the clipboard and also shows it in a text box.
- **CLEAR TRACE / RESET SAVE**: start a clean session.

## Steps
```bash
npm run test:depot                        # pure core incl. return-after-timer, cap, skew, ff==real, replay
cd www && python3 -m http.server 4173     # any static server; no network calls beyond same-origin
```
1. **Rehearse (2 min, simulated):** open `http://127.0.0.1:4173/depot-idle.html?playtest=1` → RESET SAVE → CLAIM → AWAY 8 H. You should see `SIMULATED (PLAYTEST) · WHILE YOU WERE AWAY 8h 0m · +120 CR · CAP HIT (7h 30m idle…)`. CLAIM moves 120 to the wallet.
2. **Real playtest (what counts):** on the tester's device (Safari, or the Ad Hoc / TestFlight build → DEPOT IDLE), CLEAR TRACE, play normally, then leave. **Do not prompt them to come back.** When they next open it on their own, the trace logs `return` with `simulated:false`.
3. At the end of the window, open `?playtest=1` on that device → EXPORT TRACE → save it as `playtest-<who>-<date>.json`.
4. `npm run playtest:replay -- playtest-<who>-<date>.json` prints each return/claim, `rerun=OK|MISMATCH`, and the summary (`realReturns`, `maxRealGapMs`, `realReturnsCapped`, `claimsAfterRealReturn`).
5. Fill in the internal note (date, who played, came back after timer Y/N/UNVERIFIED, notes). Put **UNVERIFIED** unless a human actually played and a real (non-simulated) return is in the trace.

## Honesty rails
- A simulated return never counts. A trace from the dev or harness device isn't a playtest.
- The trace stays on the device and is only exported by hand. No telemetry, no network, no account.
- This page does not name who pays. That belongs to Money maker's note, and it depends on this result.
