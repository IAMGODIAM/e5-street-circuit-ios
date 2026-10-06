# E5 Street Circuit

E5 Street Circuit is E5 Enclave's deterministic real-map racing game for web and iOS. The release is self-contained: the Capacitor app loads the reviewed, version-controlled `www/` bundle and never snapshots a mutable website during a build.

## Release contract

- Node.js 22 or newer; dependencies are pinned in `package-lock.json`.
- Capacitor 8 with a committed Swift Package Manager iOS project.
- iOS 15 minimum; Xcode 26.4 in CI.
- Core free roam, courses, cars, and deterministic physics are bundled. Live seats, records, and optional diagnostics are network features.
- Seat tokens move immediately into session storage and are removed from visible URLs.
- Diagnostics are off until the player opts in on `privacy.html`.
- Every web release is recorded in `release-manifest.json`; CI rejects drift.

## Verify locally

```sh
npm ci
npm run check
npm run ios:sync
npm run verify:native
```

`npm run check` verifies the immutable source bundle, deterministic twin simulation, and seat-log codec round trips. After sync, `npm run verify:native` proves the generated native copy matches every manifest hash. Do not run `cap add ios` or download game assets in CI; both `www/` and `ios/` are reviewed source.

## Shipping

- Every push and pull request runs the web gate and an unsigned iOS Simulator compile in `.github/workflows/quality.yml`.
- `.github/workflows/testflight.yml` is a manual cloud-signed TestFlight upload using repository secrets `ASC_KEY_ID`, `ASC_ISSUER_ID`, and `ASC_KEY_P8`.
- `codemagic.yaml` provides equivalent Ad Hoc and TestFlight workflows using E5's existing credential groups.

See `RELEASE_CHECKLIST.md` for App Store Connect declarations and reviewer notes.

## Olive Depot Idle (SEAL A thin-rail)

Offline logistics idle prototype on Olive Drive assets. **IAMGODIAM C-Corp game IP** (repo name does not make this an E5 charity product).

```sh
# after any static server pointing at www/, open depot-idle.html
npx --yes serve www -p 4173
# → http://127.0.0.1:4173/depot-idle.html
npm run test:depot
```

Constraints: offline only · no Upland write · no Maps bill · no parcel buy · $0. Seed: `www/depot/olive_depot_seed.json` (from `olive_drive` pack + `6704 IRON OAK DR`). Kill rule and stubs: `docs/olive-depot-idle/`.
