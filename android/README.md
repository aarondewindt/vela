# Vela Android Companion — Phase 1

This is the standalone Kotlin/Jetpack Compose project for [#88](https://github.com/aarondewindt/vela/issues/88), under the architecture in [#58](https://github.com/aarondewindt/vela/issues/58). Open **this directory** as a project in Android Studio. It is independent of Yarn and Next.js.

Phase 1 provides a launchable Material 3 status screen, JVM test entry point and Compose device smoke test. It requests **no health, network or runtime permissions** and does not read Samsung Health, connect to Vela, store credentials or synchronize anything. AndroidX adds its own signature-protected internal receiver permission during manifest merging. Samsung Health feasibility/provider integration is #89; secure pairing/ingestion/manual sync is #90; background work is #91. There is no Samsung SDK AAR to download for this phase.

## Development split

| Location | Responsibilities |
| --- | --- |
| VS Code devcontainer | Codex, Kotlin source edits, existing `yarn dev` and web/database tools |
| Ubuntu host | Android Studio, JDK/Android SDK, Gradle builds, ADB and USB phone debugging |
| Galaxy S25 FE | Install/run the debug APK and perform the physical-device checks below |

The existing Compose mount `..:/workspaces/vela:cached` exposes the same checkout in both environments. If Ubuntu has the repository at `~/projects/vela`, open `~/projects/vela/android` in **host Android Studio**, while VS Code sees `/workspaces/vela/android`. Do not copy the project, open the container-only path on the host, or open the web root as an Android project. Source edits appear in both editors.

**Build choice:** host-side Gradle is the default fallback for Codex work. The existing Node/Docker devcontainer has no Java or Android SDK; its image, lifecycle commands and ports remain unchanged. Run the commands below in an Ubuntu terminal (outside the VS Code container terminal), or use Android Studio's terminal. Codex can edit and review from the container; it cannot invoke host tools simply by using a host path. Android CI also runs the same build independently of web CI.

## Host shortcuts

After the JDK/SDK setup below, run these scripts in an **Ubuntu host terminal**
from the repository root (they also work via an absolute path from any directory):

```bash
./android/scripts/build.sh                 # Build the debug APK
./android/scripts/deploy.sh                # Build, install/update and launch on USB phone
./android/scripts/deploy.sh --no-build     # Install and launch the existing APK
./android/scripts/deploy.sh --serial SERIAL # Select a specific device
```

The scripts select JDK 17 for their own process, keeping your system Java 25
default intact. They use an existing JDK 17 `JAVA_HOME` or search Ubuntu's
`/usr/lib/jvm/` installations; set `VELA_ANDROID_JAVA_HOME` for a custom JDK 17
location. SDK discovery uses `ANDROID_HOME`, then `ANDROID_SDK_ROOT`, then
`~/Android/Sdk`; Gradle also honors its existing `local.properties`. ADB is found
in the selected SDK's `platform-tools` or on `PATH`, so no global PATH edit is
needed with the standard SDK location.

Deployment checks device access before building. It targets the single USB
device by default; `ANDROID_SERIAL` or `--serial` selects a specific device
(including a wireless device). Installation uses `adb install -r` to retain app
data; signing conflicts still require the manual recovery described below.
The scripts do not install tooling or change networking/port forwarding.

Extra Gradle options/tasks can be passed to the build script:

```bash
./android/scripts/build.sh --offline
./android/scripts/build.sh :app:testDebugUnitTest :app:lintDebug :app:assembleDebugAndroidTest
```

## Pinned build setup on Ubuntu

| Tool | Version |
| --- | --- |
| JDK / JVM bytecode | 17 |
| Gradle | 8.13, committed wrapper with distribution SHA-256 |
| Android Gradle Plugin (AGP) | 8.13.2 |
| Kotlin and Compose compiler plugin | 2.3.10 |
| Compose BOM | 2025.12.00 (Material 3) |
| Activity Compose | 1.12.4 |
| SDK platform / compile / target | Android 16 / API 36 |
| SDK Build Tools | 35.0.0 |
| Minimum phone OS | Android 9 / API 28 |

These are deliberate fixed stable versions, not requests for the latest versions. AGP's [compatibility table](https://developer.android.com/build/releases/agp-8-13-0-release-notes) specifies Gradle 8.13, JDK 17 and Build Tools 35.0.0. Check the [Kotlin compatibility table](https://kotlinlang.org/docs/gradle-configure-project.html) when updating the plugins together. Use Android Studio with AGP 8.13 support (Otter 2025.2.1 or newer compatible Studio); decline automatic build-tool upgrades when first importing.

Java 25 can remain your system default. This project's Gradle 8.13 cannot run on Java 25; [Gradle's Java compatibility matrix](https://docs.gradle.org/current/userguide/compatibility.html#java_runtime) requires Gradle 9.1 or newer for that runtime. Install JDK 17 alongside it and select 17 only for Android builds. You do not need to change `update-alternatives` or uninstall Java 25.

1. Install JDK 17 on the Ubuntu **host** and select it in the current build terminal:

   ```bash
   sudo apt-get update
   sudo apt-get install openjdk-17-jdk
   export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
   export PATH="$JAVA_HOME/bin:$PATH"
   java -version
   ```

   The exports above affect this terminal and its child processes only. To keep Java 25 in the rest of your shell sessions, do not add these JDK exports to your global shell profile. You can also select JDK 17 for one command: `JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 ./gradlew --version`.

   That path is for x86-64 Ubuntu; use your installed JDK 17 path on other architectures. In Android Studio → Settings → Build, Execution, Deployment → Build Tools → Gradle, select the same JDK 17 as **Gradle JDK** and use the project's Gradle wrapper. Studio's own runtime can remain its bundled JBR. No system Gradle installation is needed.

2. Install Android Studio on the host. In SDK Manager install **Android SDK Platform 36**, **Android SDK Build-Tools 35.0.0** (enable “Show Package Details”), **Android SDK Command-line Tools** and **Android SDK Platform-Tools**. No emulator, NDK or CMake is required. Set the actual SDK path shown in SDK Manager:

   ```bash
   export ANDROID_HOME="$HOME/Android/Sdk"
   export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
   sdkmanager --licenses
   sdkmanager 'platforms;android-36' 'build-tools;35.0.0' 'platform-tools'
   ```

   Read and accept the SDK licenses interactively. Keep these exports in your host shell profile if desired. Android Studio may create `android/local.properties` with `sdk.dir`; it is ignored and must never be committed. Environment-only CLI setup needs no such file.

3. From the **host checkout**:

   ```bash
   cd ~/projects/vela/android # substitute your Ubuntu checkout path
   ./gradlew --version
   ./gradlew --no-daemon :app:assembleDebug :app:testDebugUnitTest :app:lintDebug :app:assembleDebugAndroidTest
   ```

   The first run requires internet access to Gradle, Google Maven and Maven Central. The wrapper verifies the downloaded Gradle ZIP against its committed checksum. Output APK: `app/build/outputs/apk/debug/app-debug.apk`. Reports: `app/build/reports/tests/testDebugUnitTest/index.html` and `app/build/reports/lint-results-debug.html`. `assembleDebugAndroidTest` compiles device tests without requiring a phone; it does not run them. Subsequent cached builds may use `--offline` after all required artifacts have been downloaded.

Versions and SDK package levels are pinned and `app/gradle.lockfile` records resolved dependency versions for repeatable compilation; this does not promise byte-identical debug APKs across machines (local debug certificates differ). Always use the wrapper. For an intentional dependency update, change the pinned versions and run the build/check command above with `--write-locks`, then review and commit the lockfile changes. Generated build/IDE files, SDK paths, signing keys, credentials and APKs stay ignored.

### Optional container builds

There is deliberately no automatic SDK installer or host SDK mount. If local Codex build feedback becomes useful, opt into a **separate container-local** JDK 17 and Linux Android SDK with the same packages above, set `JAVA_HOME`/`ANDROID_HOME`, accept licenses, and run the same wrapper commands from `/workspaces/vela/android`. These tools can live outside the repository and be discarded when rebuilding the container. This is optional; the host workflow above is sufficient.

Host `android/local.properties` contains a host-only path: it takes precedence over `ANDROID_HOME`. Before switching build environments, close Android Studio and move that ignored file aside (restore it before returning to Studio), or use a separate checkout for container builds. Do not share Gradle user caches or run host and container Gradle simultaneously against the same build outputs. A container Gradle build produces the same APK location visible to host ADB; it does not grant USB access. No privileged container, USB passthrough, host ADB server exposure or change to Docker-in-Docker is needed.

## Install and launch on the Galaxy S25 FE

Run all ADB commands on the **Ubuntu host**, using SDK Platform-Tools:

1. On the phone, open Settings → About phone → Software information; tap Build number seven times and authenticate if asked. Under Settings → Developer options, enable USB debugging. Connect with a USB **data** cable, unlock the phone and approve the host's RSA debugging prompt. Android developer options are separate from Samsung Health developer mode; the latter is unnecessary for Phase 1.
2. For Ubuntu USB access, follow the [Android hardware-device setup](https://developer.android.com/studio/run/device):

   ```bash
   sudo apt-get install android-sdk-platform-tools-common
   sudo usermod -aG plugdev "$USER"
   ```

   Log out/in after changing groups, then unplug/replug the phone. Use the SDK's `adb` rather than starting a second ADB version with `sudo`.
3. Verify authorization and install the host-built APK:

   ```bash
   adb devices -l
   # The phone must show "device", not "unauthorized" or "no permissions".
   # Set this to its actual serial from the previous command:
   export ANDROID_SERIAL=YOUR_PHONE_SERIAL
   adb -s "$ANDROID_SERIAL" install -r app/build/outputs/apk/debug/app-debug.apk
   adb -s "$ANDROID_SERIAL" shell am start -W -n space.aarondewindt.vela.companion/.MainActivity
   ```

   Alternatively select the phone and the `app` configuration in Android Studio and click Run. The launcher name is **Vela Companion**; the application ID is `space.aarondewindt.vela.companion`.

Debug signing is local (`~/.android/debug.keystore`); preserve that key privately if you need stable signing identity for later Samsung registration. Build/install consistently on the host to keep it stable. If a temporary container or another machine signed an earlier install, Android may report `INSTALL_FAILED_UPDATE_INCOMPATIBLE`: uninstall with `adb -s "$ANDROID_SERIAL" uninstall space.aarondewindt.vela.companion`, then reinstall. Uninstalling clears app data. No release keys or release publishing are configured in this phase.

## Debug and verify

In host Android Studio choose the `debug` build variant and Galaxy device, set a breakpoint in `MainActivity.onCreate`, and click Debug. To attach to an already running APK, choose “Attach debugger to Android process” and select this app. Use Logcat filtered to `package:space.aarondewindt.vela.companion` for lifecycle/crash diagnostics.

For CLI debugging and device tests, from host `android/`:

```bash
adb -s "$ANDROID_SERIAL" logcat --pid="$(adb -s "$ANDROID_SERIAL" shell pidof -s space.aarondewindt.vela.companion)"
./gradlew :app:connectedDebugAndroidTest
```

The app must be running for the PID command; rerun it after restarting the process. The connected test uses the authorized device (disconnect other devices/emulators if selection is ambiguous). Results are under `app/build/reports/androidTests/connected/`.

Physical-device acceptance checklist:

- Install and launch on the S25 FE; confirm the app title and all three unconnected status cards, with no permission prompts.
- Rotate, switch light/dark mode, increase font size and scroll; content should remain readable and clear of system bars.
- Relaunch from the launcher; confirm it still shows no connection and no completed sync.
- Hit the `onCreate` breakpoint and inspect Logcat; run the connected smoke test.

## Container → Ubuntu → phone networking

Phase 1 makes **no network requests**. For browser checks over the LAN, open
`http://192.168.0.106:3000` on the phone while connected to the same LAN (use the
desktop’s current LAN IP if it changes). See [LAN development access](../docs/DAILY_USE_DEPLOYMENT.md#lan-development-access)
for origin configuration. If this works, no ADB reverse is necessary.

The following optional USB route provides loopback access for browser checks now
and later API work:

```text
phone 127.0.0.1:3000
    → host ADB reverse over USB
Ubuntu 127.0.0.1:3000
    → existing outer Docker Compose port publication
devcontainer :3000 (yarn dev listening on 0.0.0.0)
```

1. In the **devcontainer**, start Vela normally with `yarn dev`.
2. On **Ubuntu**, check `curl -I http://127.0.0.1:3000`. The existing outer `.devcontainer/docker-compose.yml` publishes `3000:3000`; `.devcontainer/devcontainer.json` also forwards 3000 in VS Code. Verify VS Code's Ports panel has not selected a different host port because 3000 was already occupied. Prefer the explicit Compose mapping. Containers created before that mapping changed need recreation; a VS Code rebuild stops running app processes, so restart them afterward.
3. On **Ubuntu**, with the phone authorized:

   ```bash
   adb -s "$ANDROID_SERIAL" reverse tcp:3000 tcp:3000
   adb -s "$ANDROID_SERIAL" reverse --list
   ```

4. In the **phone browser**, open `http://127.0.0.1:3000`. A Vela page/login response proves reachability. It does not prove native pairing/authentication. Reapply reverse after a device disconnect/reboot. Remove it when done:

   ```bash
   adb -s "$ANDROID_SERIAL" reverse --remove tcp:3000
   ```

`localhost` in the phone normally means the phone, in Ubuntu means Ubuntu, and in the container means the container. `10.0.2.2` is an emulator convention and is not the physical S25 FE's host address. ADB reverse still uses loopback even though Compose also publishes port 3000 for LAN development. No extra port or ADB-in-container workaround is necessary. Do not expose the dev server through a public tunnel. Existing public production port 3001 and database ports are unaffected.

The browser check works independently of Android app networking policy. This APK has no `INTERNET` permission or cleartext allowance. When native development networking is introduced in #90, use HTTPS for credentials/health uploads and scope any local HTTP exception to a debug variant. Do not weaken release transport policy to make this browser check work. Existing Better Auth browser sessions are not device credentials.

## Verification record

The user confirmed the build/deployment scripts work and the app launches on the
S25 FE (2026-10-24). Android Studio debugger attachment, the connected smoke test and the
remaining layout checks are still manual gates. See [the shared handoff](../docs/agent-handoff.md)
for the latest performed checks. CI and compiling the instrumented test APK cannot
establish physical-device results.

Future Samsung Health testing must happen on the real phone in #89: emulator launchability only validates this shell. That phase must prove total/active calorie access and elapsed-day versus projected-day semantics before backend ingestion depends on it.
