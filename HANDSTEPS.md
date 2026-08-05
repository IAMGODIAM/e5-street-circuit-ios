# TestFlight — the Chairman's Hand-Steps

The pipeline rides E5's **established Codemagic rail** — the same `appstore_credentials`
setup that already ships Abba Talk. If that group is healthy, there is **no new Apple
credential work at all**. A GitHub Actions fallback pipeline is also included.

---

## One-time setup (~10 minutes)

### 0 — Create the repo (the integration can't; 30 seconds)
github.com/new → Owner **IAMGODIAM** → Name **`e5-street-circuit-ios`** → Private →
**no** README → Create. Then tell Thoth "repo created" — the full project gets pushed
within a minute.

### 1 — Register the App ID (developer.apple.com)
**Certificates, Identifiers & Profiles → Identifiers → +** → App IDs → App →
Description `E5 Street Circuit` · Bundle ID (explicit): **`com.e5enclave.streetcircuit`**
→ Register. *(Same family as `com.e5enclave.abbatalk`.)*

### 2 — Create the app record (appstoreconnect.apple.com)
**Apps → + → New App** → iOS · Name **E5 Street Circuit** · English (U.S.) ·
Bundle ID `com.e5enclave.streetcircuit` · SKU `e5-street-circuit` → Create.

### 3 — Add the repo to Codemagic
codemagic.io → **Add application** → GitHub → `IAMGODIAM/e5-street-circuit-ios` →
it auto-detects `codemagic.yaml`.

Credentials check (should already be done from Abba Talk): the **`appstore_credentials`**
environment group must contain
`APP_STORE_CONNECT_PRIVATE_KEY`, `APP_STORE_CONNECT_KEY_IDENTIFIER`,
`APP_STORE_CONNECT_ISSUER_ID`, `CERTIFICATE_PRIVATE_KEY`.
If it exists (it ships Abba Talk builds), skip ahead.

---

## Every build (one button)

### 4 — Start the build
Codemagic → the app → **Start new build** → workflow **E5 Street Circuit — TestFlight**.
~20–30 min: snapshots the live game from the E5 mirror, generates the iOS project,
signs, builds, and pushes straight to TestFlight (`submit_to_testflight: true`).

### 5 — Install on your iPhone
1. After Apple finishes processing (5–30 min): App Store Connect → the app →
   **TestFlight** tab → the build appears
2. First time: **Internal Testing → +** group `Enclave`, add yourself
3. iPhone → **TestFlight** app → Install → drive

---

## Fallback pipeline (GitHub Actions)
`.github/workflows/testflight.yml` does the same job on GitHub's macOS runners with
cloud signing — needs repo secrets `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8`
(App Store Connect API key). Use it only if Codemagic is ever unavailable.

## Notes
- **Export compliance** pre-answered (`ITSAppUsesNonExemptEncryption=false`) — no per-build questionnaire.
- **Seat links**: `e5circuit://seat?...` opens the app into the armed seat; the web seat
  page shows "OPEN IN THE APP" automatically on iPhones.
- **Money stays out of the app** by design — no UPX, fees, or purchase links. Escrow
  lives in Upland's own app; this app is the driving, ghosts, and verified laps.
- **Universal links (later)**: front the game with a real domain, set `UL_DOMAIN`,
  serve an `apple-app-site-association` — the patch script already handles the entitlement.
- **Public App Store release (after TestFlight)**: screenshots, description, privacy
  label ("Data Not Collected"), Submit for Review — say the word and the listing kit gets prepared.
