#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/host-common.sh"

if [[ "${1:-}" == '--help' || "${1:-}" == '-h' ]]; then
    printf 'Usage: %s [Gradle options or additional tasks]\nBuilds the debug APK using JDK 17. Example: %s --offline :app:testDebugUnitTest\n' "$0" "$0"
    exit 0
fi

use_java17
use_default_sdk
cd -- "$ANDROID_PROJECT_DIR"
./gradlew :app:assembleDebug "$@"
printf '\nDebug APK: %s/app/build/outputs/apk/debug/app-debug.apk\n' "$ANDROID_PROJECT_DIR"
