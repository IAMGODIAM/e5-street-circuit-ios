# E5 Street Circuit — iOS

The sovereign Upland racing game, packaged for iPhone. Real Bakersfield streets,
real Upland Speedways, deterministic physics, verified-lap ghosts, and
drive-your-seat tournament entries — the same engine that settles provably-fair
races on the E5 Circuit rail.

## Architecture

- **`www/` is generated, never committed.** `scripts/fetch_assets.sh` snapshots the
  live game from the E5 R2 mirror (single source of truth) and vendors the render
  stack (three.js + Draco/KTX2 decoders) into the binary for offline core play.
- **`ios/` is generated, never committed.** `npx cap add ios` produces the native
  project fresh each build; `scripts/patch_ios.sh` applies every platform decision
  (landscape-only, hidden status bar, `e5circuit://` deep links, 120 Hz, export
  compliance). No hand-maintained Xcode project to drift.
- **Cloud signing, no Mac.** Primary pipeline: **Codemagic** (`codemagic.yaml`),
  riding E5's existing `appstore_credentials` group — the same rail that ships
  Abba Talk — with `submit_to_testflight: true`. Fallback: GitHub Actions with
  `xcodebuild -allowProvisioningUpdates` cloud signing.
- **The game itself is shell-aware.** The web build carries a Capacitor bridge that
  no-ops in browsers: haptics on crashes/laps/verdicts, seat-token deep links,
  AudioContext lifecycle hardening. One `index.html` serves web and app.

## Build

See **HANDSTEPS.md** — one-time setup (~10 min on the existing E5 Codemagic rail), then one button per build.

## Layout

```
assets/            icon + splash source art (all sizes generated in CI)
scripts/           fetch_assets.sh · patch_ios.sh
.github/workflows/ testflight.yml
capacitor.config.json · package.json
```

— E5 Enclave · built on Upland, beyond Upland
