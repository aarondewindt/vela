#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/host-common.sh"

case "${1:-}" in
    --help|-h)
        printf 'Usage: %s\nLists connected Android devices and emulators with ADB details.\n' "$0"
        exit 0
        ;;
esac
[[ $# -eq 0 ]] || fail 'Unexpected argument (see --help).'

find_adb
"$ADB" devices -l
