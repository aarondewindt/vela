#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/host-common.sh"

build=true
serial="${ANDROID_SERIAL:-}"
while [[ $# -gt 0 ]]; do
    case "$1" in
        --no-build) build=false; shift ;;
        --serial)
            [[ $# -ge 2 && -n "$2" && "$2" != --* ]] || fail '--serial needs a device serial.'
            serial="$2"
            shift 2
            ;;
        --help|-h)
            printf 'Usage: %s [--no-build] [--serial SERIAL]\nBuilds, installs and launches Vela Companion. Defaults to the single USB device.\nUse ANDROID_SERIAL or --serial to select another device.\n' "$0"
            exit 0
            ;;
        *) fail "Unknown argument: $1 (see --help)." ;;
    esac
done

find_adb
device_args=(-d)
if [[ -n "$serial" ]]; then
    device_args=(-s "$serial")
fi
if ! "$ADB" "${device_args[@]}" get-state; then
    fail 'Phone unavailable. Connect/unlock it, enable USB debugging and authorize this host. Check adb devices -l; use --serial if multiple devices are attached.'
fi

if [[ "$build" == true ]]; then
    "$ANDROID_PROJECT_DIR/scripts/build.sh"
fi
apk="$ANDROID_PROJECT_DIR/app/build/outputs/apk/debug/app-debug.apk"
[[ -f "$apk" ]] || fail 'Debug APK not found. Run build.sh first or omit --no-build.'

"$ADB" "${device_args[@]}" install -r "$apk"
"$ADB" "${device_args[@]}" shell am start -W -n space.aarondewindt.vela.companion/.MainActivity
