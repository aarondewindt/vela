"""Run with python3 -m unittest discover -s .devcontainer/scripts -v."""

import importlib.util
import os
from pathlib import Path
import socket
import socketserver
import stat
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "relay", Path(__file__).with_name("host-adb-relay.py")
)
relay = importlib.util.module_from_spec(spec)
spec.loader.exec_module(relay)
container_spec = importlib.util.spec_from_file_location(
    "container_relay", Path(__file__).with_name("container-adb-relay.py")
)
container_relay = importlib.util.module_from_spec(container_spec)
container_spec.loader.exec_module(container_relay)


class RelayTests(unittest.TestCase):
    def test_prepare_is_private_and_idempotent_with_spaces(self):
        with tempfile.TemporaryDirectory(prefix="vela host ") as home:
            with patch.object(Path, "home", return_value=Path(home)):
                directory = relay.prepare_directory()
                directory.chmod(0o777)
                self.assertEqual(relay.prepare_directory(), directory)
                self.assertEqual(stat.S_IMODE(directory.stat().st_mode), 0o700)
                self.assertEqual(directory.stat().st_uid, os.getuid())

    def test_prepare_rejects_symlink(self):
        with tempfile.TemporaryDirectory() as home:
            directory = Path(home) / ".local/share/vela-adb"
            directory.parent.mkdir(parents=True)
            directory.symlink_to(home)
            with patch.object(Path, "home", return_value=Path(home)):
                with self.assertRaises(RuntimeError):
                    relay.prepare_directory()

    def test_listener_check_rejects_network_exposure(self):
        for address in ("0.0.0.0:5037", "*:5037", "[::]:5037", "192.168.1.1:5037"):
            with self.subTest(address=address), patch.object(relay.subprocess, "run") as run:
                run.return_value.stdout = f"LISTEN 0 128 {address} 0.0.0.0:*\n"
                with self.assertRaises(RuntimeError):
                    relay.check_listeners()

    def test_listener_check_allows_only_loopback_or_stopped_server(self):
        for output in ("", "LISTEN 0 128 127.0.0.1:5037 0.0.0.0:*\n",
                       "LISTEN 0 128 [::1]:5037 [::]:*\n"):
            with patch.object(relay.subprocess, "run") as run:
                run.return_value.stdout = output
                relay.check_listeners()

    def test_bidirectional_relay_and_half_close(self):
        client, downstream = socket.socketpair()
        upstream, backend = socket.socketpair()
        worker = threading.Thread(target=relay.Relay, args=(downstream, None, None), daemon=True)
        try:
            client.settimeout(5)
            backend.settimeout(5)
            with patch.object(relay.socket, "create_connection", return_value=upstream):
                worker.start()
                client.sendall(b"host:devices-l")
                self.assertEqual(backend.recv(1024), b"host:devices-l")
                client.shutdown(socket.SHUT_WR)
                self.assertEqual(backend.recv(1024), b"")
                backend.sendall(b"OKAY0000")
                backend.shutdown(socket.SHUT_WR)
                self.assertEqual(client.recv(1024), b"OKAY0000")
                self.assertEqual(client.recv(1024), b"")
                worker.join(5)
                self.assertFalse(worker.is_alive())
        finally:
            for connection in (client, downstream, upstream, backend):
                connection.close()

    @unittest.skipUnless(os.environ.get("VELA_TEST_ADB"), "Set VELA_TEST_ADB to test the real ADB client")
    def test_disconnected_adb_never_starts_a_daemon(self):
        with socket.socket() as endpoint:
            endpoint.bind(("127.0.0.1", 0))  # Reserved, but deliberately not listening.
            result = subprocess.run(
                [os.environ["VELA_TEST_ADB"], "devices", "-l"],
                env={**os.environ, "ADB_SERVER_SOCKET": f"tcp:127.0.0.1:{endpoint.getsockname()[1]}"},
                capture_output=True, text=True, timeout=10,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("cannot start server on remote host", result.stderr)

    @unittest.skipUnless(os.environ.get("VELA_TEST_ADB"), "Set VELA_TEST_ADB to test the real ADB client")
    def test_real_adb_over_both_relays(self):
        services = []

        class FakeAdb(socketserver.BaseRequestHandler):
            def handle(self):
                # Minimal smart-socket protocol, not a device or an ADB daemon.
                length = int(self.request.recv(4), 16)
                service = self.request.recv(length).decode()
                services.append(service)
                if service == "host:version":
                    payload = b"0029"  # ADB server protocol 41
                elif service == "host:devices-l":
                    payload = b"fixture-only\tdevice model:Relay_fixture transport_id:1\n"
                else:
                    self.request.sendall(b"FAIL000bunsupported")
                    return
                self.request.sendall(b"OKAY" + f"{len(payload):04x}".encode() + payload)

        with tempfile.TemporaryDirectory(prefix="vela relay ") as directory:
            endpoint = str(Path(directory) / "adb.sock")
            with socketserver.ThreadingTCPServer(("127.0.0.1", 0), FakeAdb) as backend:
                class HostRelay(relay.Relay):
                    def connect_upstream(self):
                        return socket.create_connection(backend.server_address, timeout=5)

                class ContainerRelay(container_relay.Relay):
                    def connect_upstream(self):
                        connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                        connection.connect(endpoint)
                        return connection

                with relay.Server(endpoint, HostRelay) as host:
                    Path(endpoint).chmod(0o600)
                    with container_relay.Server(("127.0.0.1", 0), ContainerRelay) as container:
                        servers = [backend, host, container]
                        threads = [threading.Thread(target=s.serve_forever, daemon=True) for s in servers]
                        for thread in threads:
                            thread.start()
                        try:
                            result = subprocess.run(
                                [os.environ["VELA_TEST_ADB"], "devices", "-l"],
                                env={**os.environ, "ADB_SERVER_SOCKET": f"tcp:127.0.0.1:{container.server_address[1]}"},
                                capture_output=True, text=True, timeout=10,
                            )
                            self.assertEqual(result.returncode, 0, result.stderr)
                            self.assertIn("fixture-only", result.stdout)
                            self.assertEqual(services, ["host:version", "host:devices-l"])
                        finally:
                            for server in servers:
                                server.shutdown()
                            for thread in threads:
                                thread.join(5)


if __name__ == "__main__":
    unittest.main()
