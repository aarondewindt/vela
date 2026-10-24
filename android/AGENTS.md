# Android Companion instructions

Read root `AGENTS.md`, `android/README.md`, and issues #58/#88 before substantial changes. This is a standalone Gradle project; do not add it to Yarn or replace the Next.js build.

- Current scope includes Phase 3 (#90): authenticated manual sync of read-only Samsung Health activity-summary snapshots. Read `../docs/ANDROID_HEALTH_VALIDATION.md` before health changes. Device pairing (#93) and manual ingestion (#90) are implemented; background work (#91) is implemented; see `../docs/ANDROID_BACKGROUND_SYNC.md`. Read `../docs/ANDROID_MANUAL_SYNC.md` for ingestion behavior. Never infer calorie semantics from API names; physical-device comparisons are the feasibility gate.
- Use Kotlin, Kotlin DSL and Material 3 Compose. Keep dependency/plugin versions fixed and update Kotlin/Compose compiler versions together. Use the committed Gradle wrapper with JDK 17.
- The VS Code devcontainer includes JDK 17/headless SDK and persistent Gradle/signing volumes. Read `../docs/ANDROID_DEVCONTAINER.md` for builds and secure host ADB relay setup. USB and the single ADB server stay on Ubuntu; no emulator or USB passthrough. Host builds remain supported; do not assume host paths exist in the container.
- Keep local.properties, IDE caches, APKs, SDK downloads, signing material and credentials out of Git. Never commit a host SDK path. Avoid simultaneous host/container Gradle builds in the shared directory.
- Check `:app:assembleDebug :app:testDebugUnitTest :app:lintDebug :app:assembleDebugAndroidTest` when Android tooling is available. Run `:app:connectedDebugAndroidTest` on an authorized device; distinguish compilation from physical-device verification. Native tests belong in Gradle source sets, not web Jest.
- Later health integrations must remain read-only behind a provider boundary; deterministic Vela services retain validation and persistence. Do not add fake sync success, browser-session credentials or speculative server contracts to the shell.
