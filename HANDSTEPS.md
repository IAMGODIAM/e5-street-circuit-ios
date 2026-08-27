# Release operator steps

1. Merge only after the **Release quality** workflow passes both `web` and `ios-simulator`.
2. In App Store Connect, confirm the `com.e5enclave.streetcircuit` app record, privacy answers, age rating, support URL, screenshots, and export-compliance answer.
3. Run the manual **TestFlight** workflow in GitHub Actions, or `street-circuit-testflight` in Codemagic.
4. Wait for Apple processing, add the build to an internal testing group, and execute the device matrix in `RELEASE_CHECKLIST.md`.
5. Promote the tested build to App Review. Never refresh `www/` inside a signing workflow.

Repository secrets required by the GitHub path are `ASC_KEY_ID`, `ASC_ISSUER_ID`, and `ASC_KEY_P8`. Codemagic uses the `appstore_credentials` group and, for optional Ad Hoc mirror publishing, `circuit_ota`.
