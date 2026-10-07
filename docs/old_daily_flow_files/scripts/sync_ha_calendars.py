#!/usr/bin/env python3
"""Sync Home Assistant calendars into Directus calendar_events."""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import urllib.parse
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from directus_state import DEFAULT_BASE_URL, DEFAULT_TOKEN_PATH, Directus, log_run, now, read_token
from ha_calendar import calendar_events

DEFAULT_TIMEZONE = "Europe/Amsterdam"
DEFAULT_CALENDARS = {
    "calendar.aaron_dewindt_gmail_com": {"busy": True, "label": "personal", "source": "home_assistant"},
    "calendar.sosalsa_public_agenda": {"busy": True, "label": "sosalsa", "source": "home_assistant"},
    "calendar.somusica_2": {"busy": True, "label": "somusica", "source": "home_assistant"},
    "calendar.holidays_in_netherlands": {"busy": False, "label": "holidays", "source": "home_assistant"},
    "calendar.daily_flow_overrides": {"busy": False, "label": "daily-flow-overrides", "source": "daily_flow_overrides"},
}
OPTIONAL_CALENDARS = {
    "calendar.spike": {"busy": False, "label": "test", "source": "home_assistant"},
}


def qs(params: dict[str, Any]) -> str:
    return urllib.parse.urlencode(params)


def parse_event_datetime(value: Any, tz: ZoneInfo) -> dt.datetime | None:
    raw = value
    if isinstance(value, dict):
        raw = value.get("dateTime") or value.get("date")
    if not raw:
        return None
    if isinstance(raw, str) and len(raw) == 10:
        return dt.datetime.combine(dt.date.fromisoformat(raw), dt.time.min, tzinfo=tz)
    parsed = dt.datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=tz)
    return parsed.astimezone(tz)


def event_identity(entity_id: str, event: dict[str, Any], start_at: str, end_at: str, title: str) -> tuple[str, str]:
    external_id = (
        event.get("uid")
        or event.get("id")
        or event.get("recurrence_id")
        or event.get("ical_uid")
        or event.get("event_id")
    )
    if external_id:
        key = f"ha:{entity_id}:{external_id}"
        return str(external_id), key[:255]
    fingerprint = hashlib.sha1(f"{entity_id}|{title}|{start_at}|{end_at}".encode("utf-8")).hexdigest()
    return fingerprint, f"ha:{entity_id}:{fingerprint}"


def existing_event(client: Directus, event_key: str) -> dict[str, Any] | None:
    rows = client.get(
        "/items/calendar_events?"
        + qs(
            {
                "filter[event_key][_eq]": event_key,
                "limit": 1,
                "fields": "id",
            }
        )
    ).get("data", [])
    return rows[0] if rows else None


def upsert_event(
    client: Directus,
    entity_id: str,
    event: dict[str, Any],
    default_busy: bool,
    source: str,
    tz: ZoneInfo,
) -> str:
    title = event.get("summary") or event.get("title") or "(untitled)"
    start = parse_event_datetime(event.get("start"), tz)
    end = parse_event_datetime(event.get("end"), tz)
    if not start or not end:
        return "skipped"
    status = "cancelled" if event.get("status") == "cancelled" else ("busy" if default_busy else "free")
    busy = default_busy and status != "cancelled"
    start_at = start.isoformat()
    end_at = end.isoformat()
    external_id, event_key = event_identity(entity_id, event, start_at, end_at, title)
    stamp = now()
    payload = {
        "title": title,
        "source": source,
        "calendar_id": entity_id,
        "event_key": event_key,
        "external_event_id": external_id,
        "start_at": start_at,
        "end_at": end_at,
        "status": status,
        "busy": busy,
        "raw_json": event,
        "updated_at": stamp,
    }
    row = existing_event(client, event_key)
    if row:
        client.patch(f"/items/calendar_events/{row['id']}", payload)
        return "updated"
    payload["created_at"] = stamp
    client.post("/items/calendar_events", payload)
    return "created"


def selected_calendars(args: argparse.Namespace) -> dict[str, dict[str, Any]]:
    calendars = dict(DEFAULT_CALENDARS)
    if args.include_spike:
        calendars.update(OPTIONAL_CALENDARS)
    for entity_id in args.calendar:
        calendars.setdefault(entity_id, {"busy": True, "label": "custom", "source": "home_assistant"})
    for entity_id in args.non_blocking_calendar:
        calendars[entity_id] = {"busy": False, "label": "custom", "source": "home_assistant"}
    return calendars


def sync(args: argparse.Namespace) -> dict[str, Any]:
    tz = ZoneInfo(args.timezone)
    start_date = dt.date.fromisoformat(args.start_date)
    end_date = dt.date.fromisoformat(args.end_date) if args.end_date else start_date + dt.timedelta(days=args.days)
    start = dt.datetime.combine(start_date, dt.time.min, tzinfo=tz).isoformat()
    end = dt.datetime.combine(end_date, dt.time.min, tzinfo=tz).isoformat()
    client = Directus(args.base_url, read_token(Path(args.token_path)))
    calendars = selected_calendars(args)
    counts = {"created": 0, "updated": 0, "skipped": 0}
    by_calendar: dict[str, dict[str, int]] = {}
    for entity_id, config in calendars.items():
        events = calendar_events(entity_id, start, end).get("events", [])
        by_calendar[entity_id] = {"fetched": len(events), "created": 0, "updated": 0, "skipped": 0}
        for event in events:
            result = upsert_event(client, entity_id, event, bool(config["busy"]), str(config["source"]), tz)
            counts[result] += 1
            by_calendar[entity_id][result] += 1
    run = log_run(
        client,
        "sync_ha_calendars",
        "succeeded",
        input_payload={"start": start, "end": end, "calendars": calendars},
        output_payload={"counts": counts, "by_calendar": by_calendar},
    )
    return {
        "start": start,
        "end": end,
        "counts": counts,
        "by_calendar": by_calendar,
        "automation_run_id": run["id"],
    }


def main() -> None:
    today = dt.datetime.now(ZoneInfo(DEFAULT_TIMEZONE)).date().isoformat()
    parser = argparse.ArgumentParser(description="Sync Home Assistant calendars into Directus")
    parser.add_argument("--base-url", default=os.environ.get("DAILY_FLOW_DIRECTUS_URL", DEFAULT_BASE_URL))
    parser.add_argument("--token-path", default=os.environ.get("DAILY_FLOW_DIRECTUS_TOKEN_PATH", str(DEFAULT_TOKEN_PATH)))
    parser.add_argument("--timezone", default=DEFAULT_TIMEZONE)
    parser.add_argument("--start-date", default=today)
    parser.add_argument("--end-date", help="Exclusive end date, YYYY-MM-DD")
    parser.add_argument("--days", type=int, default=14, help="Range length when --end-date is omitted")
    parser.add_argument("--calendar", action="append", default=[], help="Additional blocking HA calendar entity_id")
    parser.add_argument(
        "--non-blocking-calendar",
        action="append",
        default=[],
        help="Additional non-blocking HA calendar entity_id",
    )
    parser.add_argument("--include-spike", action="store_true", help="Include the local HA test calendar as non-blocking")
    args = parser.parse_args()
    print(json.dumps(sync(args), indent=2))


if __name__ == "__main__":
    main()
