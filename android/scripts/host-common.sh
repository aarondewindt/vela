#!/usr/bin/env bash
# Shared by the host entry points; source this file rather than executing it.

ANDROID_PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"

fail() {
    printf 'Error: %s\n' "$*" >&2
    exit 1
}

use_java17() {
    local candidate version
    local version_pattern='version "17([."]|$)'
    local candidates=()
    if [[ -n "${VELA_ANDROID_JAVA_HOME:-}" ]]; then
        candidates=("$VELA_ANDROID_JAVA_HOME")
    else
        candidates=("${JAVA_HOME:-}" /usr/lib/jvm/java-17-openjdk-* /usr/lib/jvm/*17*)
    fi

    for candidate in "${candidates[@]}"; do
        [[ -x "$candidate/bin/java" && -x "$candidate/bin/javac" ]] || continue
        version=$("$candidate/bin/java" -version 2>&1) || continue
        if [[ "$version" =~ $version_pattern ]]; then
            export JAVA_HOME="$candidate"
            export PATH="$JAVA_HOME/bin:$PATH"
            printf 'Using JDK 17: %s\n' "$JAVA_HOME"
            return
        fi
    done
    fail 'JDK 17 not found. Install openjdk-17-jdk, or set VELA_ANDROID_JAVA_HOME to a JDK 17 directory.'
}

use_default_sdk() {
    if [[ -z "${ANDROID_HOME:-}" ]]; then
        if [[ -n "${ANDROID_SDK_ROOT:-}" ]]; then
            export ANDROID_HOME="$ANDROID_SDK_ROOT"
        elif [[ -d "$HOME/Android/Sdk" ]]; then
            export ANDROID_HOME="$HOME/Android/Sdk"
        fi
    fi
}

find_adb() {
    local candidate
    use_default_sdk
    for candidate in "${ANDROID_HOME:-}/platform-tools/adb" "$(command -v adb || true)"; do
        if [[ -x "$candidate" ]]; then
            ADB="$candidate"
            return
        fi
    done
    fail 'ADB not found. Install Android SDK Platform-Tools and set ANDROID_HOME to the SDK directory (normally ~/Android/Sdk).'
}
