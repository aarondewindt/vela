#!/usr/bin/env python3
"""Project or sync Directus daily blocks into the Home Assistant Daily Flow calendar."""
from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import json
import os
import urllib.parse
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from directus_state import DEFAULT_BASE_URL, DEFAULT_TOKEN_PATH, Directus, get_plan, log_run, now, read_token
from ha_calendar import calendar_events, create_event, delete_event, update_event

DEFAULT_TIMEZONE = "Europe/Amsterdam"
DEFAULT_ENTITY_ID = "calendar.daily_flow"
PROJECTABLE_STATUSES = {"planned", "active", "moved"}
MARKER_PREFIX = "daily-flow-block:"


def qs(params: dict[str, Any]) -> str:
    return urllib.parse.urlencode(params)


def parse_dt(value: str, tz: ZoneInfo) -> dt.datetime:
    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=tz)
    return parsed.astimezone(tz)


def block_marker(block_id: int) -> str:
    return f"{MARKER_PREFIX}{block_id}"


def event_text(event: dict[str, Any]) -> str:
    return "\n".join(str(event.get(key) or "") for key in ("summary", "title", "description", "message", "location"))


def marker_from_event(event: dict[str, Any]) -> str | None:
    text = event_text(event)
    for part in text.replace("\n", " ").split():
        marker = part.strip()
        if marker.startswith(MARKER_PREFIX):
            return marker
    return None


def projected_events(entity_id: str, start: str, end: str) -> dict[str, dict[str, Any]]:
    events = calendar_events(entity_id, start, end).get("events", [])
    marked: dict[str, dict[str, Any]] = {}
    for event in events:
        marker = marker_from_event(event)
        if marker:
            marked[marker] = event
    return marked


def daily_blocks(client: Directus, plan_id: int) -> list[dict[str, Any]]:
    return client.get(
        "/items/daily_blocks?"
        + qs(
            {
                "filter[daily_plan][_eq]": plan_id,
                "limit": -1,
                "sort": "start_at",
                "fields": "id,title,block_type,start_at,end_at,status,first_step,notes,external_calendar_id,ha_event_id",
            }
        )
    ).get("data", [])


def description_for(block: dict[str, Any]) -> str:
    parts = [block_marker(block["id"])]
    if block.get("first_step"):
        parts.append(f"First step: {block['first_step']}")
    if block.get("notes"):
        parts.append(str(block["notes"]))
    return "\n".join(parts)


def desired_event(block: dict[str, Any], tz: ZoneInfo) -> dict[str, Any]:
    return {
        "summary": f"Daily Flow: {block['title']}",
        "start": parse_dt(block["start_at"], tz).isoformat(),
        "end": parse_dt(block["end_at"], tz).isoformat(),
        "description": description_for(block),
        "location": block.get("location") or None,
    }


def event_datetime(event: dict[str, Any], key: str, tz: ZoneInfo) -> str | None:
    value = event.get(key)
    if not isinstance(value, dict):
        return None
    raw = value.get("dateTime") or value.get("date")
    if not raw:
        return None
    return parse_dt(raw, tz).isoformat()


def event_matches(event: dict[str, Any], desired: dict[str, Any], tz: ZoneInfo) -> bool:
    return (
        event.get("summary") == desired["summary"]
        and (event.get("description") or "") == desired["description"]
        and event_datetime(event, "start", tz) == desired["start"]
        and event_datetime(event, "end", tz) == desired["end"]
        and (event.get("location") or None) == desired["location"]
    )


def event_uid(event: dict[str, Any]) -> str | None:
    uid = event.get("uid")
    return str(uid) if uid else None


async def project(args: argparse.Namespace) -> dict[str, Any]:
    tz = ZoneInfo(args.timezone)
    client = Directus(args.base_url, read_token(Path(args.token_path)))
    plan = get_plan(client, args.date)
    if not plan:
        raise SystemExit(f"No daily plan for {args.date}")
    day_start = dt.datetime.combine(dt.date.fromisoformat(args.date), dt.time.min, tzinfo=tz).isoformat()
    day_end = (
        dt.datetime.combine(dt.date.fromisoformat(args.date), dt.time.min, tzinfo=tz)
        + dt.timedelta(days=1)
    ).isoformat()
    existing_events = projected_events(args.entity_id, day_start, day_end)
    desired_markers: set[str] = set()
    counts = {
        "created": 0,
        "updated": 0,
        "deleted": 0,
        "would_create": 0,
        "would_update": 0,
        "would_delete": 0,
        "skipped_unchanged": 0,
        "skipped_existing": 0,
        "skipped_status": 0,
        "skipped_missing_uid": 0,
    }
    created_block_ids: list[int] = []
    updated_block_ids: list[int] = []
    deleted_markers: list[str] = []
    for block in daily_blocks(client, plan["id"]):
        marker = block_marker(block["id"])
        if block.get("status") not in PROJECTABLE_STATUSES:
            counts["skipped_status"] += 1
            continue
        desired_markers.add(marker)
        desired = desired_event(block, tz)
        if marker in existing_events:
            existing = existing_events[marker]
            if not args.dry_run:
                client.patch(
                    f"/items/daily_blocks/{block['id']}",
                    {"external_calendar_id": args.entity_id, "ha_event_id": marker, "updated_at": now()},
                )
            if not args.sync:
                counts["skipped_existing"] += 1
                continue
            if event_matches(existing, desired, tz):
                counts["skipped_unchanged"] += 1
                continue
            uid = event_uid(existing)
            if not uid:
                counts["skipped_missing_uid"] += 1
                continue
            if args.dry_run:
                counts["would_update"] += 1
            else:
                await update_event(
                    args.entity_id,
                    uid,
                    desired["summary"],
                    desired["start"],
                    desired["end"],
                    desired["description"],
                    recurrence_id=existing.get("recurrence_id"),
                    location=desired["location"],
                )
                counts["updated"] += 1
            updated_block_ids.append(block["id"])
            continue
        if args.dry_run:
            counts["would_create"] += 1
        else:
            await create_event(
                args.entity_id,
                desired["summary"],
                desired["start"],
                desired["end"],
                desired["description"],
            )
            client.patch(
                f"/items/daily_blocks/{block['id']}",
                {"external_calendar_id": args.entity_id, "ha_event_id": marker, "updated_at": now()},
            )
            counts["created"] += 1
        created_block_ids.append(block["id"])
    if args.sync:
        for marker, event in sorted(existing_events.items()):
            if marker in desired_markers:
                continue
            uid = event_uid(event)
            if not uid:
                counts["skipped_missing_uid"] += 1
                continue
            if args.dry_run:
                counts["would_delete"] += 1
            else:
                await delete_event(args.entity_id, uid, event.get("recurrence_id"))
                counts["deleted"] += 1
            deleted_markers.append(marker)
    run = log_run(
        client,
        "sync_daily_plan_to_ha" if args.sync else "project_daily_plan_to_ha",
        "succeeded",
        daily_plan_id=plan["id"],
        input_payload={"date": args.date, "entity_id": args.entity_id, "dry_run": args.dry_run, "sync": args.sync},
        output_payload={
            "counts": counts,
            "created_block_ids": created_block_ids,
            "updated_block_ids": updated_block_ids,
            "deleted_markers": deleted_markers,
        },
    )
    return {"date": args.date, "daily_plan_id": plan["id"], "counts": counts, "automation_run_id": run["id"]}


def main() -> None:
    parser = argparse.ArgumentParser(description="Project a Directus daily plan into Home Assistant")
    parser.add_argument("--base-url", default=os.environ.get("DAILY_FLOW_DIRECTUS_URL", DEFAULT_BASE_URL))
    parser.add_argument("--token-path", default=os.environ.get("DAILY_FLOW_DIRECTUS_TOKEN_PATH", str(DEFAULT_TOKEN_PATH)))
    parser.add_argument("--timezone", default=DEFAULT_TIMEZONE)
    parser.add_argument("--date", required=True)
    parser.add_argument("--entity-id", default=DEFAULT_ENTITY_ID)
    parser.add_argument("--sync", action="store_true", help="Update changed HA events and delete stale Daily Flow marker events")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    print(json.dumps(asyncio.run(project(args)), indent=2))


if __name__ == "__main__":
    main()
