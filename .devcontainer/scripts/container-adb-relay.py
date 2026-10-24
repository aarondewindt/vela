#!/usr/bin/env python3
"""Adapt Gradle/ddmlib's loopback TCP connection to the host Unix socket."""

import fcntl
import importlib.util
from pathlib import Path
import select
import socket
import socketserver
import subprocess
import sys

spec = importlib.util.spec_from_file_location(
    "host_relay", Path(__file__).with_name("host-adb-relay.py")
)
host_relay = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host_relay)


class Relay(host_relay.Relay):
    def connect_upstream(self):
        upstream = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            upstream.settimeout(5)
            upstream.connect("/run/vela-adb/adb.sock")
            return upstream
        except OSError:
            upstream.close()
            raise


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    directory = Path.home() / ".cache/vela-adb"
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    if sys.argv[1:] == ["--start"]:
        # Wait for explicit readiness, then let VS Code's lifecycle command exit.
        with (directory / "relay.log").open("a") as log:
            child = subprocess.Popen(
                [sys.executable, __file__, "--serve"], stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE, stderr=log, start_new_session=True,
            )
            ready, _, _ = select.select([child.stdout], [], [], 5)
            if not ready or child.stdout.readline() != b"ready\n":
                child.terminate()
                raise RuntimeError(f"Container ADB relay failed; see {directory / 'relay.log'}")
            child.stdout.close()
        return
    if sys.argv[1:] != ["--serve"]:
        raise RuntimeError("Usage: container-adb-relay.py --start")
    with (directory / "relay.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("ready", flush=True)  # Previous postStart still owns the relay.
            return
        with Server(("127.0.0.1", 5037), Relay) as server:
            print("ready", flush=True)
            with (directory / "relay.log").open("a", buffering=1) as log:
                sys.stdout = log
                sys.stderr = log
                server.serve_forever()


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError) as error:
        raise SystemExit(str(error)) from error
