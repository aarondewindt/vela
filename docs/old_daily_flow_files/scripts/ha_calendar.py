#!/usr/bin/env python3
"""Home Assistant calendar IO wrapper for Daily Flow V2.

Uses HA_URL and HA_TOKEN from the environment. The first implementation should
prefer deterministic JSON in/out and avoid assistant-authored ad hoc curl.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import urllib.parse
import urllib.request
from typing import Any


def ha_request(method: str, path: str, payload: dict | None = None) -> dict:
    base = os.environ["HA_URL"].rstrip("/")
    token = os.environ["HA_TOKEN"]
    data = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(
        base + path,
        data=data,
        method=method,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read().decode()
    return json.loads(raw) if raw else {}


def ha_ws_url() -> str:
    parsed = urllib.parse.urlsplit(os.environ["HA_URL"].rstrip("/"))
    scheme = {"http": "ws", "https": "wss"}.get(parsed.scheme, parsed.scheme)
    path = parsed.path.rstrip("/")
    if path.endswith("/api"):
        path = path[: -len("/api")]
    return urllib.parse.urlunsplit((scheme, parsed.netloc, f"{path}/api/websocket", "", ""))


def import_websockets() -> Any:
    try:
        import websockets
    except ModuleNotFoundError as exc:
        raise SystemExit("Missing dependency: websockets") from exc
    return websockets


class HomeAssistantWebSocket:
    def __init__(self) -> None:
        self._next_id = 1
        self._ws: Any | None = None

    async def __aenter__(self) -> "HomeAssistantWebSocket":
        websockets = import_websockets()
        self._ws = await websockets.connect(ha_ws_url(), open_timeout=15, max_size=None)
        await self._authenticate()
        return self

    async def __aexit__(self, *_: object) -> None:
        if self._ws is not None:
            await self._ws.close()

    async def _receive(self) -> dict[str, Any]:
        assert self._ws is not None
        raw = await asyncio.wait_for(self._ws.recv(), timeout=15)
        data = json.loads(raw)
        if not isinstance(data, dict):
            raise SystemExit(f"Unexpected WebSocket message: {data!r}")
        return data

    async def _send(self, payload: dict[str, Any]) -> None:
        assert self._ws is not None
        await self._ws.send(json.dumps(payload))

    async def _authenticate(self) -> None:
        hello = await self._receive()
        if hello.get("type") != "auth_required":
            raise SystemExit(f"Expected auth_required, got: {hello}")
        await self._send({"type": "auth", "access_token": os.environ["HA_TOKEN"]})
        response = await self._receive()
        if response.get("type") != "auth_ok":
            raise SystemExit(f"Home Assistant auth failed: {response}")

    async def command(self, message_type: str, **payload: Any) -> Any:
        message_id = self._next_id
        self._next_id += 1
        await self._send({"id": message_id, "type": message_type, **payload})
        while True:
            response = await self._receive()
            if response.get("id") != message_id:
                continue
            if response.get("type") != "result":
                raise SystemExit(f"Unexpected response for {message_type}: {response}")
            if not response.get("success", False):
                raise SystemExit("Home Assistant command failed: " + json.dumps(response.get("error", response), sort_keys=True))
            return response.get("result")


def list_calendar_entities() -> list[dict]:
    states = ha_request("GET", "/api/states")
    return [s for s in states if s.get("entity_id", "").startswith("calendar.")]


def calendar_events(entity_id: str, start: str, end: str) -> dict[str, Any]:
    query = urllib.parse.urlencode({"start": start, "end": end})
    return {"entity_id": entity_id, "events": ha_request("GET", f"/api/calendars/{entity_id}?{query}")}


async def create_event(entity_id: str, summary: str, start: str, end: str, description: str) -> dict[str, Any]:
    async with HomeAssistantWebSocket() as client:
        result = await client.command(
            "call_service",
            domain="calendar",
            service="create_event",
            target={"entity_id": entity_id},
            service_data={
                "summary": summary,
                "start_date_time": start,
                "end_date_time": end,
                "description": description,
            },
        )
    return {"ok": True, "result": result}


async def update_event(
    entity_id: str,
    uid: str,
    summary: str,
    start: str,
    end: str,
    description: str,
    recurrence_id: str | None = None,
    location: str | None = None,
) -> dict[str, Any]:
    event = {
        "summary": summary,
        "dtstart": start,
        "dtend": end,
        "description": description,
    }
    if location is not None:
        event["location"] = location
    payload = {"entity_id": entity_id, "uid": uid, "event": event}
    if recurrence_id:
        payload["recurrence_id"] = recurrence_id
    async with HomeAssistantWebSocket() as client:
        result = await client.command("calendar/event/update", **payload)
    return {"ok": True, "result": result}


async def delete_event(entity_id: str, uid: str, recurrence_id: str | None = None) -> dict[str, Any]:
    payload = {"entity_id": entity_id, "uid": uid}
    if recurrence_id:
        payload["recurrence_id"] = recurrence_id
    async with HomeAssistantWebSocket() as client:
        result = await client.command("calendar/event/delete", **payload)
    return {"ok": True, "result": result}


async def get_events(entity_id: str, start: str, end: str) -> dict[str, Any]:
    async with HomeAssistantWebSocket() as client:
        result = await client.command(
            "call_service",
            domain="calendar",
            service="get_events",
            target={"entity_id": entity_id},
            service_data={"start_date_time": start, "end_date_time": end},
            return_response=True,
        )
    return {"entity_id": entity_id, "events": (result or {}).get("response", {}).get(entity_id, {}).get("events", [])}


def main() -> None:
    parser = argparse.ArgumentParser(description="Daily Flow HA calendar helper")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list-calendars")
    p_create = sub.add_parser("create-event")
    p_create.add_argument("--entity-id", required=True)
    p_create.add_argument("--summary", required=True)
    p_create.add_argument("--start", required=True)
    p_create.add_argument("--end", required=True)
    p_create.add_argument("--description", default="")
    p_events = sub.add_parser("get-events")
    p_events.add_argument("--entity-id", required=True)
    p_events.add_argument("--start", required=True)
    p_events.add_argument("--end", required=True)
    p_update = sub.add_parser("update-event")
    p_update.add_argument("--entity-id", required=True)
    p_update.add_argument("--uid", required=True)
    p_update.add_argument("--summary", required=True)
    p_update.add_argument("--start", required=True)
    p_update.add_argument("--end", required=True)
    p_update.add_argument("--description", default="")
    p_update.add_argument("--recurrence-id")
    p_delete = sub.add_parser("delete-event")
    p_delete.add_argument("--entity-id", required=True)
    p_delete.add_argument("--uid", required=True)
    p_delete.add_argument("--recurrence-id")
    args = parser.parse_args()
    if args.cmd == "list-calendars":
        print(json.dumps(list_calendar_entities(), indent=2))
    elif args.cmd == "create-event":
        print(json.dumps(asyncio.run(create_event(args.entity_id, args.summary, args.start, args.end, args.description)), indent=2))
    elif args.cmd == "get-events":
        print(json.dumps(calendar_events(args.entity_id, args.start, args.end), indent=2))
    elif args.cmd == "update-event":
        print(
            json.dumps(
                asyncio.run(
                    update_event(
                        args.entity_id,
                        args.uid,
                        args.summary,
                        args.start,
                        args.end,
                        args.description,
                        args.recurrence_id,
                    )
                ),
                indent=2,
            )
        )
    elif args.cmd == "delete-event":
        print(json.dumps(asyncio.run(delete_event(args.entity_id, args.uid, args.recurrence_id)), indent=2))


if __name__ == "__main__":
    main()
