#!/usr/bin/env bash
set -euo pipefail
# Named volumes are initially populated from the image. Repair ownership after
# Dev Containers remaps node's UID to the Ubuntu user's UID, including old caches.
for directory in "$GRADLE_USER_HOME" "$HOME/.android" "$ANDROID_HOME"; do
    if [[ ! -O "$directory" || ! -w "$directory" ]]; then
        sudo chown -R "$(id -u):$(id -g)" "$directory"
    fi
done
chmod 700 "$HOME/.android"
