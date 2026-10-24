#!/usr/bin/env bash
set -euo pipefail
# initializeCommand runs on Ubuntu, before Docker resolves the bind mount.
exec python3 "$(dirname -- "${BASH_SOURCE[0]}")/host-adb-relay.py" --prepare-only
