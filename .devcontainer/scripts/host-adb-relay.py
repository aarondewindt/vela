#!/usr/bin/env python3
"""Ubuntu-only, user-owned Unix socket relay to the existing loopback ADB server."""

import argparse
import fcntl
import os
from pathlib import Path
import select
import shutil
import socket
import socketserver
import stat
import subprocess


def prepare_directory():
    directory = Path.home() / ".local/share/vela-adb"
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    info = directory.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid():
        raise RuntimeError(f"Refusing directory not owned by this user: {directory}")
    directory.chmod(0o700)
    return directory


def check_listeners():
    result = subprocess.run(
        ["ss", "-H", "-ltn", "sport = :5037"],
        check=True, capture_output=True, text=True,
    )
    for line in result.stdout.splitlines():
        address = line.split()[3]
        if address not in ("127.0.0.1:5037", "[::1]:5037", "::1:5037"):
            raise RuntimeError(
                f"ADB is listening on {address}. Stop that server on Ubuntu and "
                "restart without -a or a wildcard binding before using this relay."
            )


class Relay(socketserver.BaseRequestHandler):
    def connect_upstream(self):
        return socket.create_connection(("127.0.0.1", 5037), timeout=5)

    def handle(self):
        try:
            with self.connect_upstream() as upstream:
                upstream.settimeout(None)
                peers = {self.request: upstream, upstream: self.request}
                while peers:
                    ready, _, _ = select.select(list(peers), [], [])
                    for source in ready:
                        data = source.recv(65536)
                        if data:
                            peers[source].sendall(data)
                        else:
                            peers[source].shutdown(socket.SHUT_WR)
                            del peers[source]
        except OSError as error:
            print(f"ADB relay connection failed: {error}", flush=True)


class Server(socketserver.ThreadingUnixStreamServer):
    daemon_threads = True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepare-only", action="store_true")
    parser.add_argument("--adb", help="Host SDK platform-tools/adb path")
    args = parser.parse_args()
    os.umask(0o077)
    directory = prepare_directory()
    if args.prepare_only:
        return

    # Lock before replacing a stale socket; never unlink a live relay's socket.
    with (directory / "relay.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        adb = args.adb or str(Path.home() / "Android/Sdk/platform-tools/adb")
        if args.adb and not Path(adb).is_file():
            raise RuntimeError(f"ADB executable does not exist: {adb}")
        if not Path(adb).is_file():
            adb = shutil.which("adb")
        if not adb:
            raise RuntimeError("Install host SDK Platform-Tools or supply --adb /path/to/adb")
        check_listeners()
        environment = os.environ.copy()
        for name in ("ADB_SERVER_SOCKET", "ANDROID_ADB_SERVER_ADDRESS", "ANDROID_ADB_SERVER_PORT"):
            environment.pop(name, None)
        subprocess.run([adb, "-L", "tcp:127.0.0.1:5037", "start-server"],
                       env=environment, check=True)
        check_listeners()
        subprocess.run([adb, "version"], env=environment, check=True)
        endpoint = directory / "adb.sock"
        if endpoint.is_symlink() or (endpoint.exists() and not endpoint.is_socket()):
            raise RuntimeError(f"Refusing non-socket endpoint: {endpoint}")
        endpoint.unlink(missing_ok=True)
        try:
            with Server(str(endpoint), Relay) as server:
                endpoint.chmod(0o600)
                print(f"Relaying {endpoint} → Ubuntu 127.0.0.1:5037. Ctrl-C stops the relay.", flush=True)
                server.serve_forever()
        finally:
            endpoint.unlink(missing_ok=True)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error)) from error
