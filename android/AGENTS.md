# Android Companion instructions

Read root `AGENTS.md`, `android/README.md`, and issues #58/#88 before substantial changes. This is a standalone Gradle project; do not add it to Yarn or replace the Next.js build.

- Current scope is Phase 1 (#88): the Compose shell and reproducible host build/device workflow. Samsung SDK/provider work (#89), device pairing/ingestion (#90) and background work (#91) are later phases.
- Use Kotlin, Kotlin DSL and Material 3 Compose. Keep dependency/plugin versions fixed and update Kotlin/Compose compiler versions together. Use the committed Gradle wrapper with JDK 17.
- Default build/ADB environment is the Ubuntu host. VS Code/Codex edits live in the existing Node devcontainer. Do not assume Java, SDK, host paths or USB access exist inside it; keep Android tooling opt-in.
- Keep local.properties, IDE caches, APKs, SDK downloads, signing material and credentials out of Git. Never commit a host SDK path. Avoid simultaneous host/container Gradle builds in the shared directory.
- Check `:app:assembleDebug :app:testDebugUnitTest :app:lintDebug :app:assembleDebugAndroidTest` when Android tooling is available. Run `:app:connectedDebugAndroidTest` on an authorized device; distinguish compilation from physical-device verification. Native tests belong in Gradle source sets, not web Jest.
- Later health integrations must remain read-only behind a provider boundary; deterministic Vela services retain validation and persistence. Do not add fake sync success, browser-session credentials or speculative server contracts to the shell.
