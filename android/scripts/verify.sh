#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/host-common.sh"

# Device-independent; extra Gradle options such as --offline are forwarded.
use_java17
use_default_sdk
cd -- "$ANDROID_PROJECT_DIR"
exec ./gradlew --no-daemon :app:assembleDebug :app:testDebugUnitTest :app:lintDebug :app:assembleDebugAndroidTest "$@"
