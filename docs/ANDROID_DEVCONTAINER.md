# Android development in the Vela devcontainer (#104)

The existing VS Code container includes a headless Android toolchain. Android
Studio and USB stay on Ubuntu. No emulator, USB passthrough, host networking or
published ADB port is added. Issue #103 is outside this setup's scope.

## Rebuild and first verification

Prerequisites: Ubuntu with Docker Engine/Compose, VS Code Dev Containers, and
Python 3 on the host. Open the repository through **Dev Containers: Rebuild
Container**. Use the normal rebuild (Docker's cached layers), rather than
“Rebuild Without Cache”. The existing Yarn installation and inner Docker Compose
PostgreSQL/pgAdmin startup still run. Existing app ports are unchanged.

The host initialize command creates `~/.local/share/vela-adb` with mode 0700 even
if you do not use a phone. Compose mounts that directory read-only. No host ADB
server starts automatically. The VS Code remote user is `node`; Dev Containers
normally maps its UID to the Ubuntu user. This UID must match to access the 0600
host socket. Do not solve a mismatch by making the socket world-writable.

The licensed Samsung Health Data SDK is still a separately supplied prerequisite:
put the verified 1.1.0 AAR at
`android/app/libs/samsung-health-data-api-1.1.0.aar` as described in
[SDK setup](ANDROID_HEALTH_VALIDATION.md). This ignored file is already available
in the current checkout; it is never downloaded or baked into the image.

From a **container** terminal at the repository root:

```bash
java -version
sdkmanager --version
sdkmanager --list_installed
adb version
cd android
./gradlew --version
cd ..
./android/scripts/verify.sh
```

The verification script uses the committed Gradle 8.13 wrapper, JDK 17, and runs
`:app:assembleDebug :app:testDebugUnitTest :app:lintDebug
:app:assembleDebugAndroidTest`. It never requires ADB or a phone. The equivalent
VS Code task is **Android: verify (no phone required)**. After dependencies have
been cached, `./android/scripts/verify.sh --offline` supports offline builds.
First Gradle execution needs access to Gradle distributions, Google Maven and
Maven Central. Build output and reports remain under `android/app/build/`.

The SDK environment is `/opt/android-sdk` (`ANDROID_HOME` and the compatibility
alias `ANDROID_SDK_ROOT`); `JAVA_HOME` is `/opt/java/openjdk`. Both are on PATH.
Host Android Studio can leave an ignored `android/local.properties`: AGP 8.13
warns about an unavailable host `sdk.dir` and falls back to the container's
`ANDROID_HOME` (verified). If that file names a path which also exists inside the
container but is the wrong SDK, move it aside before switching environments and
restore it for Studio. No script rewrites it. Close Studio's active Gradle build
before building inside the container; both use the same project outputs.

## Tool versions and persistence

- Temurin JDK 17.0.18+8, copied from its versioned Ubuntu/glibc image because Debian
  Trixie does not package JDK 17. Java/Kotlin bytecode stays at 17.
- Android command-line tools build 13114758 (19.0), with archive SHA-256.
- Platform-Tools 37.0.1, with versioned archive and SHA-256.
- SDK platform `platforms;android-36` and Build Tools `build-tools;35.0.0`, matching
  `android/app/build.gradle.kts`; licenses are accepted during image construction.
- Official Linux SDK binaries require **x86-64**. The image fails early on ARM64;
  this setup targets the Ubuntu x86-64 workstation.

SDK packages and accepted licenses live in Docker image layers, without a volume
over `/opt/android-sdk`. Ordinary rebuilds reuse that layer and never hide new
image tools behind an old SDK volume. Rebuilding without cache or changing the
SDK installation layer downloads those packages again. `sdkmanager` may receive
new revisions for the same platform package; command tools and Platform-Tools
archives are checksum pinned. Do not run routine `sdkmanager --update`.

Compose named volumes persist `/home/node/.gradle` (wrapper distributions,
dependencies and caches) and `/home/node/.android` (including the debug signing
key). The post-create script repairs ownership after UID remapping. They are
separate from host Gradle caches. `docker compose down` retains them;
`docker compose down -v` deletes them. Keep a private backup of the debug key if
its identity matters. Host and container keys can differ: an APK signed with a
different key cannot update an existing installation. Prefer keeping one key;
uninstalling the app to recover deletes its local pairing/data and must be an
intentional manual action.

For upgrades, edit the Dockerfile's pinned tool versions/checksums, align platform
and Build Tools packages with Gradle, rebuild, and rerun verification. Obtain
archives/checksums from [Google's SDK tools](https://developer.android.com/studio#command-tools)
and [Android package metadata](https://dl.google.com/android/repository/repository2-3.xml).
Use the [AGP compatibility table](https://developer.android.com/build/releases/agp-8-13-0-release-notes)
when changing JDK or wrapper versions. Do not install system Gradle.

## Ubuntu host ADB setup (Option B)

Run these commands in an **Ubuntu host terminal**, from your checkout root:

```bash
sudo apt-get update
sudo apt-get install python3 iproute2 curl unzip android-sdk-platform-tools-common
sudo usermod -aG plugdev "$USER"
```

Log out/in if the group changed. Enable USB debugging on the Galaxy S25 FE,
connect a data cable, unlock it, and approve Ubuntu's RSA prompt. The container
has no USB access and does not need its own RSA authorization.

Use the same SDK Platform-Tools version in host Android Studio and the container
(prefer 37.0.1 on both). To install the pinned host Linux version alongside an
existing SDK without replacing Studio's files:

```bash
mkdir -p "$HOME/.local/share/vela-platform-tools-37.0.1"
curl -fL --retry 3 https://dl.google.com/android/repository/platform-tools_r37.0.1-linux.zip \
  -o "$HOME/.local/share/vela-platform-tools-37.0.1/tools.zip"
printf '%s  %s\n' d230f13842f60f782a8645f9c813f8f845bf36089ea7289f28c48f17979313f1 \
  "$HOME/.local/share/vela-platform-tools-37.0.1/tools.zip" | sha256sum -c -
unzip -o "$HOME/.local/share/vela-platform-tools-37.0.1/tools.zip" \
  -d "$HOME/.local/share/vela-platform-tools-37.0.1"
```

Normally use Studio's SDK executable below. If necessary, substitute the pinned
`$HOME/.local/share/vela-platform-tools-37.0.1/platform-tools/adb` path in **all**
host commands and the relay's `--adb` argument. Configure Studio to use matching
Platform-Tools before reopening it; two versions must not fight over port 5037.

```bash
"$HOME/Android/Sdk/platform-tools/adb" version
ss -ltn 'sport = :5037'
python3 .devcontainer/scripts/host-adb-relay.py \
  --adb "$HOME/Android/Sdk/platform-tools/adb"
```

Leave the relay running in that terminal. It starts/reuses the host ADB server
bound to **127.0.0.1:5037**, checks that existing listeners are loopback-only, and
creates `~/.local/share/vela-adb/adb.sock` with mode **0600**. Ctrl-C stops the
relay and removes the socket; the host ADB server and Android Studio can keep
running. Run the same command again after a host reboot. To stop the host server
as well, close Studio and run its `adb kill-server` **on Ubuntu**.

If the relay rejects an existing wildcard/LAN listener, close Studio and other
ADB clients, run the host `adb kill-server`, and rerun the relay. Never use
`adb -a`, `adb tcpip`, `0.0.0.0:5037`, or a firewall opening for this setup. The
relay refuses insecure existing bindings; it does not silently reconfigure them.
If Studio later restarts ADB, keep its default loopback binding.

The complete route is:

```text
container CLI + Gradle/ddmlib → container 127.0.0.1:5037 (relay only)
  → read-only bind-mounted, user-private Unix socket
  → Ubuntu 127.0.0.1:5037 (one host ADB server) → USB → Galaxy
```

The container relay starts on each container start, accepts only loopback TCP,
and forwards bytes to the Unix socket; it is not an ADB daemon. There are no new
Docker ports or host-gateway mappings. Using a directory mount makes socket
replacement after a host relay restart visible without rebuilding. Access to the
socket grants control of host-authorized ADB devices; only mount it into trusted
development containers. This is a local Docker Engine design, not remote Docker
or Docker Desktop filesystem forwarding.

`ADB_SERVER_SOCKET=tcp:127.0.0.1:5037` targets the container relay; the explicit
numeric host makes ADB treat it as a remote server, preventing automatic daemon
startup if the relay is unavailable. Do not unset it or use `adb start-server`,
`kill-server`, `-H`, `-P` or `-L` overrides inside the container. Those server
management commands could affect the Ubuntu server through the relay. Upstream
[ADB socket handling](https://android.googlesource.com/platform/packages/modules/adb/+/refs/heads/main/socket_spec.cpp)
distinguishes an explicit TCP host from the local default. Gradle/ddmlib uses the
same loopback TCP port; a Unix socket alone would not support its device tests.

## Verify Codex → Galaxy and debug

In a second **host** terminal:

```bash
"$HOME/Android/Sdk/platform-tools/adb" devices -l
```

In the **container**:

```bash
adb devices -l
export ANDROID_SERIAL=YOUR_PHONE_SERIAL
adb -s "$ANDROID_SERIAL" get-state
adb -s "$ANDROID_SERIAL" shell getprop ro.product.model
./android/scripts/deploy.sh --serial "$ANDROID_SERIAL"
adb -s "$ANDROID_SERIAL" logcat -d -t 100 -s AndroidRuntime
cd android
./gradlew --no-daemon :app:connectedDebugAndroidTest
```

Both device lists must show the same serial in `device` state. The model command
confirms which phone Codex is talking to. `unauthorized` requires approval on the
phone; do not bypass it. Choose one device for instrumentation tests (disconnect
others; Gradle can target all attached devices). Device-test results are under
`android/app/build/reports/androidTests/connected/`.

CLI installation, activity launch, shell, logcat, `run-as` and instrumentation are
available to Codex. For Kotlin/Compose breakpoints, continue to use **host Android
Studio**, which shares the same ADB server and checkout: select the debug variant,
attach to `space.aarondewindt.vela.companion`, and set a breakpoint. A VS Code
Android source debugger is not bundled. An `adb forward tcp:...` command creates
the forwarded port on **Ubuntu**, so a container debugger would need an additional
explicit private transport to that port. Never expose JDWP on the LAN.

No relay or no phone: builds still work; device commands fail with a connection
error or show an empty list. Logs for the container TCP relay are in
`~/.cache/vela-adb/relay.log`; restart it with
`python3 .devcontainer/scripts/container-adb-relay.py --start`. Check host relay
output, `ss`, host/container UIDs and socket permissions before changing network
configuration. If an ADB protocol-version mismatch is reported, stop container
device commands, close Studio, align Platform-Tools, then restart the host server
and relay. Do not repeatedly let incompatible clients restart each other's server.

The app's HTTPS pairing and health permissions are separate from ADB. Existing
[phone networking](../android/README.md#container--ubuntu--phone-networking) and
[physical health validation](ANDROID_HEALTH_VALIDATION.md) still apply.

## Implementation verification (2026-10-24)

- Final Dockerfile built successfully; a second normal build reused all install
  layers, including the SDK. Non-root checks passed for Java 17.0.18, sdkmanager
  19.0, SDK 36 revision 2, Build Tools 35.0.0, ADB 37.0.1, Node 24, project Yarn
  4.17.0 and PostgreSQL CLI 18.
- In the built image as `node`, `./android/scripts/verify.sh --offline
  --rerun-tasks` passed: all 81 Gradle tasks executed, 29 JVM tests passed, debug
  and instrumentation APKs compiled, and lint passed. Dependency downloads were
  reused from an existing cache; no phone or host socket was mounted. The existing
  host-only `local.properties` was left untouched.
- Disposable named-volume checks proved persistence across container recreation,
  non-root writes, ownership repair, and 0700 Android user-directory permissions.
- Both Compose configurations validated. Container relay startup and repeated
  startup passed; `ss` confirmed only `127.0.0.1:5037` listening. A disconnected
  real ADB client refused to start a local daemon.
- Focused Jest: 15 tests passed. Python relay tests: seven passed, including the
  real ADB client through both transports against a protocol fixture (not a
  physical phone). Run them with:

  ```bash
  yarn jest --runInBand android/scripts/host-scripts.test.cjs
  VELA_TEST_ADB="$ANDROID_HOME/platform-tools/adb" \
    python3 -m unittest discover -s .devcontainer/scripts -v
  ```

Full VS Code recreation with the DinD feature/inner services, Ubuntu USB
permissions, actual host ADB/Studio coexistence, matching physical-device lists,
phone installation/logcat/instrumentation and breakpoint attachment remain
workstation checks. Issue #104 stays open until those acceptance checks are
confirmed. Issue #103 was not changed.
