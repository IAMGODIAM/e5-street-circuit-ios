# E5 Street Circuit release checklist

## App Store record

- Name: **E5 Street Circuit**
- Bundle ID: `com.e5enclave.streetcircuit`
- Version: `1.0.0`
- Category: Games — Racing
- Support URL: `https://e5enclave.com/contact/`
- Privacy URL: `https://e5enclave.com/privacy`

Suggested subtitle: **Drive the real streets**

Suggested promotional text: **Race street-true courses, preserve your best ghosts, and submit deterministic live-seat laps that can be verified tick for tick.**

Suggested description:

> Drive the Olive Drive grid in free roam or attack handcrafted circuits built from real streets. Choose from the E5 house car and a detailed garage, race responsive rivals, preserve local ghosts, replay a settled Enclave Cup, and enter optional live seats whose input logs are deterministically re-simulated for a fair result.

Keywords: `racing,street circuit,driving,ghost,deterministic,real map`

## App privacy answers

Declare no tracking and no advertising. Declare these uses consistently with `PrivacyInfo.xcprivacy` and `www/privacy.html`:

- User Content → Gameplay Content: linked to the event participant, App Functionality, for optional live-seat submissions.
- Diagnostics → Crash Data and Performance Data: not linked, App Functionality, collected only after opt-in.

## Review notes

Free roam and standard races require no account and use only bundled game code and assets. Live-seat tokens are optional, single-purpose credentials supplied by an event organizer; review does not need one to exercise the full core game. There are no in-app purchases, advertising SDKs, or downloaded executable game code. Upland-related property, vehicle, and map references are attributed on the Credits screen.

## Release gate

1. `npm ci && npm run check`
2. Confirm the GitHub **Release quality** workflow is green, including the iOS Simulator compile.
3. Test on a low-memory iPhone and one iPad: cold boot, all control modes, 20-minute race, background/resume, audio interruption, WebGL recovery, offline core play, invalid/expired seat token, and VoiceOver menu navigation.
4. Verify at least 30 FPS at the supported low tier and no unbounded renderer memory growth across five race restarts.
5. Archive with Xcode 26.4 or newer and inspect the generated privacy report.
6. Run the manual **TestFlight** workflow; complete internal testing before App Review submission.
7. Confirm live-seat tokens are short-lived, attempt-limited, redacted from edge/application logs, and invalidated after the event; the verification API must rate-limit requests and reject oversized tick logs.
8. Before App Review, update `https://e5enclave.com/privacy` so the public policy includes the Street Circuit live-seat, gameplay-log, public Upland profile, and opt-in diagnostics disclosures already present in the bundled Privacy screen.
