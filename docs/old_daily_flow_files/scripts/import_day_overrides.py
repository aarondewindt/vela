#!/usr/bin/env python3
"""Import Daily Flow override calendar events into day_overrides."""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import urllib.parse
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from directus_state import DEFAULT_BASE_URL, DEFAULT_TOKEN_PATH, Directus, log_run, now, read_token

DEFAULT_TIMEZONE = "Europe/Amsterdam"
DEFAULT_CALENDAR_ID = "calendar.daily_flow_overrides"
TYPE_ALIASES = [
    ("wfh", re.compile(r"\b(wfh|work\s*from\s*home|home\s*office)\b", re.I)),
    ("holiday", re.compile(r"\b(holiday|public\s*holiday)\b", re.I)),
    ("pto", re.compile(r"\b(pto|vacation|leave|day\s*off)\b", re.I)),
    ("sick", re.compile(r"\b(sick|ill)\b", re.I)),
    ("offsite", re.compile(r"\b(offsite|external|client)\b", re.I)),
    ("office", re.compile(r"\b(office|work\s*at\s*office|delft\s*circuits)\b", re.I)),
    ("no_work", re.compile(r"\b(no\s*work|free\s*day)\b", re.I)),
    ("custom_hours", re.compile(r"\b(custom|hours?|shift)\b", re.I)),
]
TIME_RANGE_RE = re.compile(r"(?P<start>[0-2]?\d[:.][0-5]\d)\s*[-–]\s*(?P<end>[0-2]?\d[:.][0-5]\d)")
LUNCH_RE = re.compile(r"lunch\s*(?P<start>[0-2]?\d[:.][0-5]\d)\s*[-–]\s*(?P<end>[0-2]?\d[:.][0-5]\d)", re.I)


def qs(params: dict[str, Any]) -> str:
    return urllib.parse.urlencode(params)


def parse_dt(value: str, tz: ZoneInfo) -> dt.datetime:
    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=tz)
    return parsed.astimezone(tz)


def normalize_time(value: str | None) -> str | None:
    if not value:
        return None
    hour, minute = [int(part) for part in value.replace(".", ":").split(":", 1)]
    return f"{hour:02d}:{minute:02d}:00"


def fetch_all(client: Directus, collection: str, params: dict[str, Any]) -> list[dict[str, Any]]:
    return client.get(f"/items/{collection}?{qs(params)}").get("data", [])


def infer_type(title: str) -> str:
    for override_type, pattern in TYPE_ALIASES:
        if pattern.search(title):
            return override_type
    return "custom_hours"


def infer_times(title: str, override_type: str, start: dt.datetime, end: dt.datetime) -> dict[str, str | None]:
    result: dict[str, str | None] = {
        "work_start": None,
        "work_end": None,
        "lunch_start": None,
        "lunch_end": None,
    }
    if override_type == "custom_hours":
        match = TIME_RANGE_RE.search(title)
        if match:
            result["work_start"] = normalize_time(match.group("start"))
            result["work_end"] = normalize_time(match.group("end"))
        elif start.date() == end.date() and start.time() != dt.time.min:
            result["work_start"] = start.strftime("%H:%M:%S")
            result["work_end"] = end.strftime("%H:%M:%S")
    lunch = LUNCH_RE.search(title)
    if lunch:
        result["lunch_start"] = normalize_time(lunch.group("start"))
        result["lunch_end"] = normalize_time(lunch.group("end"))
    return result


def find_location(client: Directus, title: str, override_type: str) -> int | None:
    if override_type == "wfh":
        name = "Home"
    elif "delft circuits" in title.lower() or override_type == "office":
        name = "Delft Circuits"
    else:
        return None
    rows = fetch_all(client, "locations", {"filter[name][_eq]": name, "limit": 1, "fields": "id"})
    return rows[0]["id"] if rows else None


def existing_override(client: Directus, event_key: str) -> dict[str, Any] | None:
    rows = fetch_all(
        client,
        "day_overrides",
        {"filter[source_event_key][_eq]": event_key, "limit": 1, "fields": "id"},
    )
    return rows[0] if rows else None


def import_overrides(args: argparse.Namespace) -> dict[str, Any]:
    tz = ZoneInfo(args.timezone)
    client = Directus(args.base_url, read_token(Path(args.token_path)))
    start_date = dt.date.fromisoformat(args.start_date)
    end_date = dt.date.fromisoformat(args.end_date) if args.end_date else start_date + dt.timedelta(days=args.days)
    start = dt.datetime.combine(start_date, dt.time.min, tzinfo=tz).isoformat()
    end = dt.datetime.combine(end_date, dt.time.min, tzinfo=tz).isoformat()
    events = fetch_all(
        client,
        "calendar_events",
        {
            "filter[calendar_id][_eq]": args.calendar_id,
            "filter[start_at][_lte]": end,
            "filter[end_at][_gte]": start,
            "limit": -1,
            "fields": "id,title,event_key,start_at,end_at,raw_json",
            "sort": "start_at",
        },
    )
    counts = {"created": 0, "updated": 0, "skipped": 0}
    override_ids: list[int] = []
    for event in events:
        title = event.get("title") or "(untitled override)"
        event_key = event.get("event_key")
        if not event_key:
            counts["skipped"] += 1
            continue
        start_at = parse_dt(event["start_at"], tz)
        end_at = parse_dt(event["end_at"], tz)
        override_type = infer_type(title)
        times = infer_times(title, override_type, start_at, end_at)
        location_id = find_location(client, title, override_type)
        payload: dict[str, Any] = {
            "date": start_at.date().isoformat(),
            "title": title,
            "override_type": override_type,
            "busy": override_type in {"holiday", "pto", "sick", "no_work"},
            "source": "calendar",
            "source_event": event["id"],
            "source_event_key": event_key,
            "notes": "Imported from calendar.daily_flow_overrides",
            "updated_at": now(),
            **times,
        }
        if location_id:
            payload["location"] = location_id
        existing = existing_override(client, event_key)
        if existing:
            row = client.patch(f"/items/day_overrides/{existing['id']}", payload)["data"]
            counts["updated"] += 1
        else:
            payload["created_at"] = now()
            row = client.post("/items/day_overrides", payload)["data"]
            counts["created"] += 1
        override_ids.append(row["id"])
    run = log_run(
        client,
        "import_day_overrides",
        "succeeded",
        input_payload={"start": start, "end": end, "calendar_id": args.calendar_id},
        output_payload={"counts": counts, "override_ids": override_ids},
    )
    return {
        "start": start,
        "end": end,
        "calendar_id": args.calendar_id,
        "counts": counts,
        "override_ids": override_ids,
        "automation_run_id": run["id"],
    }


def main() -> None:
    today = dt.datetime.now(ZoneInfo(DEFAULT_TIMEZONE)).date().isoformat()
    parser = argparse.ArgumentParser(description="Import Daily Flow day overrides from calendar_events")
    parser.add_argument("--base-url", default=os.environ.get("DAILY_FLOW_DIRECTUS_URL", DEFAULT_BASE_URL))
    parser.add_argument("--token-path", default=os.environ.get("DAILY_FLOW_DIRECTUS_TOKEN_PATH", str(DEFAULT_TOKEN_PATH)))
    parser.add_argument("--timezone", default=DEFAULT_TIMEZONE)
    parser.add_argument("--calendar-id", default=DEFAULT_CALENDAR_ID)
    parser.add_argument("--start-date", default=today)
    parser.add_argument("--end-date")
    parser.add_argument("--days", type=int, default=14)
    args = parser.parse_args()
    print(json.dumps(import_overrides(args), indent=2))


if __name__ == "__main__":
    main()
