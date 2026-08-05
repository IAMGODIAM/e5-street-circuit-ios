# E5 Street Circuit iOS — Ship Runbook (for the dispatched executor)

GOAL: get the signed Ad Hoc IPA onto the E5 mirror so the Chairman installs OTA.

STATE: project files in this kit are push-ready. No GitHub repo exists yet (integration
token cannot create repos — 403). No Codemagic API token exists. The vault holds the
E5 dist cert (signing/e5_dist_cert_key.pem); Codemagic team group `appstore_credentials`
signs everything (proven by Abba Talk).

STEPS:
1. GitHub device flow (client_id 178c6fc778ccc68e1d6a, scope "repo workflow"):
   POST https://github.com/login/device/code → give the Chairman the user_code +
   https://github.com/login/device → poll access_token (grant urn:ietf:params:oauth:grant-type:device_code).
   Token → file only, NEVER chat. Vault it at treasurebox github/device-token.txt afterward.
2. POST /user/repos {"name":"e5-street-circuit-ios","private":true} as IAMGODIAM.
3. git push this kit's files to main (https://x-access-token:TOKEN@github.com/IAMGODIAM/e5-street-circuit-ios.git).
4. DELETE /repos/IAMGODIAM/abba-talk-ios/git/refs/heads/circuit-build (scrub the old carrier branch).
5. Chairman (2 clicks): codemagic.io → Add application → e5-street-circuit-ios →
   Start new build → workflow "E5 Street Circuit — Ad Hoc OTA" (branch main).
6. Watch beacons: https://pub-1dfdb97841574c448cb7657c069dbdc6.r2.dev/drivegame/app/build/status.txt
   (stage markers), .../build/xcode.log (uploaded on success AND failure).
   IPA lands at .../drivegame/app/E5StreetCircuit.ipa (presigned lanes inside codemagic.yaml, valid to ~Aug 12).
7. VERIFY before offering install (gate is MANDATORY): download the IPA, unzip,
   Payload/App.app/Info.plist → CFBundleIdentifier MUST be com.e5enclave.streetcircuit,
   CFBundleShortVersionString must match the manifest (1.0.0 — if it differs, fix
   drivegame/app/manifest.plist on the mirror to match the IPA); extract the XML plist
   inside embedded.mobileprovision → ProvisionedDevices MUST include
   00008030-00024920147B802E and/or 00008140-000644CC3CD8801C (the Abba-proven devices),
   team 32SLSDKAT5, get-task-allow false.
8. Install page (already live, self-arming): https://pub-1dfdb97841574c448cb7657c069dbdc6.r2.dev/drivegame/app/install.html
   On-device: Safari → INSTALL → trust E5 ENCLAVE under VPN & Device Management.

FAILURE TRIAGE: last status.txt stage = the dying step; xcode.log has the detail.
Common: fetch-signing-files needs the ASC key in the group (it's there per Abba);
cap add ios needs @capacitor/ios (in package.json); capacitor-assets step is best-effort.
