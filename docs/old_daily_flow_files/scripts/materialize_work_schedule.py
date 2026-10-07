#!/usr/bin/env python3
"""Materialize work, lunch, and commute blocks for one Daily Flow day."""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import urllib.parse
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from directus_state import DEFAULT_BASE_URL, DEFAULT_TOKEN_PATH, Directus, init_plan, log_run, now, read_token

DEFAULT_TIMEZONE = "Europe/Amsterdam"
DEFAULT_HOME_NAME = "Home"
DEFAULT_COMMUTE_MINUTES = 30


def qs(params: dict[str, Any]) -> str:
    return urllib.parse.urlencode(params)


def parse_time(value: str | None, fallback: str) -> dt.time:
    raw = value or fallback
    parts = [int(part) for part in raw.split(":")[:2]]
    return dt.time(parts[0], parts[1])


def combine(day: str, value: str | None, fallback: str, tz: ZoneInfo) -> dt.datetime:
    return dt.datetime.combine(dt.date.fromisoformat(day), parse_time(value, fallback), tzinfo=tz)


def fetch_all(client: Directus, collection: str, params: dict[str, Any]) -> list[dict[str, Any]]:
    return client.get(f"/items/{collection}?{qs(params)}").get("data", [])


def find_location(client: Directus, name: str) -> dict[str, Any] | None:
    rows = fetch_all(client, "locations", {"filter[name][_eq]": name, "limit": 1})
    return rows[0] if rows else None


def active_patterns(client: Directus, day: str) -> list[dict[str, Any]]:
    target = dt.date.fromisoformat(day)
    weekday = target.isoweekday()
    rows = fetch_all(
        client,
        "work_patterns",
        {
            "limit": -1,
            "filter[status][_eq]": "active",
            "fields": "id,name,status,timezone,days_of_week,work_start,work_end,lunch_start,lunch_end,lunch_flexible,location_mode,location.id,location.name,location.default_transport_mode,priority,effective_from,effective_until,notes",
            "sort": "priority",
        },
    )
    matches = []
    for row in rows:
        days = row.get("days_of_week") or []
        if isinstance(days, str):
            try:
                days = json.loads(days)
            except json.JSONDecodeError:
                days = []
        if days and weekday not in [int(item) for item in days]:
            continue
        if row.get("effective_from") and target < dt.date.fromisoformat(row["effective_from"][:10]):
            continue
        if row.get("effective_until") and target > dt.date.fromisoformat(row["effective_until"][:10]):
            continue
        matches.append(row)
    return matches


def day_override(client: Directus, day: str) -> dict[str, Any] | None:
    rows = fetch_all(
        client,
        "day_overrides",
        {
            "filter[date][_eq]": day,
            "limit": 1,
            "fields": "id,date,title,override_type,work_start,work_end,lunch_start,lunch_end,location.id,location.name,location.default_transport_mode,busy,source,notes",
        },
    )
    return rows[0] if rows else None


def existing_keyed_blocks(client: Directus, plan_id: int) -> set[str]:
    rows = fetch_all(
        client,
        "daily_blocks",
        {
            "filter[daily_plan][_eq]": plan_id,
            "filter[source][_eq]": "work_schedule",
            "limit": -1,
            "fields": "notes",
        },
    )
    keys = set()
    for row in rows:
        notes = row.get("notes") or ""
        for part in str(notes).split():
            if part.startswith("work-schedule:"):
                keys.add(part)
    return keys


def create_block(
    client: Directus,
    plan_id: int,
    *,
    key: str,
    title: str,
    block_type: str,
    start: dt.datetime,
    end: dt.datetime,
    location_id: int | None = None,
    origin_id: int | None = None,
    destination_id: int | None = None,
    transport_mode: str | None = None,
    notes: str | None = None,
) -> dict[str, Any]:
    stamp = now()
    payload: dict[str, Any] = {
        "daily_plan": plan_id,
        "title": title,
        "block_type": block_type,
        "start_at": start.isoformat(),
        "end_at": end.isoformat(),
        "status": "planned",
        "source": "work_schedule",
        "notes": f"{key} {notes or ''}".strip(),
        "created_at": stamp,
        "updated_at": stamp,
    }
    if location_id:
        payload["location"] = location_id
    if origin_id:
        payload["origin_location"] = origin_id
    if destination_id:
        payload["destination_location"] = destination_id
    if transport_mode:
        payload["transport_mode"] = transport_mode
    return client.post("/items/daily_blocks", payload)["data"]


def materialize(args: argparse.Namespace) -> dict[str, Any]:
    tz = ZoneInfo(args.timezone)
    client = Directus(args.base_url, read_token(Path(args.token_path)))
    plan = init_plan(client, args.date, args.timezone)
    pattern = (active_patterns(client, args.date) or [None])[0]
    override = day_override(client, args.date)
    if not pattern:
        run = log_run(
            client,
            "materialize_work_schedule",
            "succeeded",
            daily_plan_id=plan["id"],
            input_payload={"date": args.date},
            output_payload={"skipped_reason": "no_active_pattern", "blocks_created": 0},
        )
        return {"date": args.date, "daily_plan_id": plan["id"], "skipped_reason": "no_active_pattern", "blocks_created": 0, "automation_run_id": run["id"]}

    override_type = override.get("override_type") if override else None
    if override_type in {"holiday", "pto", "sick", "no_work"}:
        run = log_run(
            client,
            "materialize_work_schedule",
            "succeeded",
            daily_plan_id=plan["id"],
            input_payload={"date": args.date, "pattern_id": pattern["id"], "override_id": override.get("id")},
            output_payload={"skipped_reason": override_type, "blocks_created": 0},
        )
        return {"date": args.date, "daily_plan_id": plan["id"], "skipped_reason": override_type, "blocks_created": 0, "automation_run_id": run["id"]}

    location = override.get("location") if override and isinstance(override.get("location"), dict) else pattern.get("location")
    location_mode = pattern.get("location_mode")
    if override_type == "wfh":
        location_mode = "home"
        location = find_location(client, DEFAULT_HOME_NAME) or location
    elif override_type in {"office", "offsite", "custom_hours"} and override and isinstance(override.get("location"), dict):
        location_mode = "office" if override_type == "office" else "offsite"

    location_id = location.get("id") if isinstance(location, dict) else None
    location_name = location.get("name") if isinstance(location, dict) else "Work"
    transport_mode = (location or {}).get("default_transport_mode") if isinstance(location, dict) else None
    home = find_location(client, DEFAULT_HOME_NAME)
    home_id = home.get("id") if home else None

    work_start = combine(args.date, (override or {}).get("work_start") or pattern.get("work_start"), "09:00", tz)
    work_end = combine(args.date, (override or {}).get("work_end") or pattern.get("work_end"), "17:00", tz)
    lunch_start = combine(args.date, (override or {}).get("lunch_start") or pattern.get("lunch_start"), "12:00", tz)
    lunch_end = combine(args.date, (override or {}).get("lunch_end") or pattern.get("lunch_end"), "13:00", tz)

    keys = existing_keyed_blocks(client, plan["id"])
    created = []

    def maybe_create(key_suffix: str, **kwargs: Any) -> None:
        key = f"work-schedule:{args.date}:{key_suffix}"
        if key in keys:
            return
        created.append(create_block(client, plan["id"], key=key, **kwargs))

    if location_mode != "home" and home_id and location_id:
        commute = dt.timedelta(minutes=args.commute_minutes)
        maybe_create(
            "commute-out",
            title=f"Commute to {location_name}",
            block_type="commute",
            start=work_start - commute,
            end=work_start,
            origin_id=home_id,
            destination_id=location_id,
            transport_mode=transport_mode,
        )

    if lunch_start > work_start:
        maybe_create(
            "work-am",
            title=f"Work at {location_name}",
            block_type="work",
            start=work_start,
            end=lunch_start,
            location_id=location_id,
        )
    maybe_create(
        "lunch",
        title="Lunch / flexible personal slot",
        block_type="lunch",
        start=lunch_start,
        end=lunch_end,
        location_id=location_id,
        notes="Lunch can shift when needed for non-work meetings or tasks.",
    )
    if work_end > lunch_end:
        maybe_create(
            "work-pm",
            title=f"Work at {location_name}",
            block_type="work",
            start=lunch_end,
            end=work_end,
            location_id=location_id,
        )

    if location_mode != "home" and home_id and location_id:
        commute = dt.timedelta(minutes=args.commute_minutes)
        maybe_create(
            "commute-home",
            title="Commute home",
            block_type="commute",
            start=work_end,
            end=work_end + commute,
            origin_id=location_id,
            destination_id=home_id,
            transport_mode=transport_mode,
        )

    if created:
        client.patch(
            f"/items/daily_plans/{plan['id']}",
            {
                "status": "active",
                "summary": f"Active plan with {len(created)} work schedule blocks materialized.",
                "updated_at": now(),
            },
        )

    run = log_run(
        client,
        "materialize_work_schedule",
        "succeeded",
        daily_plan_id=plan["id"],
        input_payload={"date": args.date, "pattern_id": pattern["id"], "override_id": override.get("id") if override else None},
        output_payload={"blocks_created": len(created), "block_ids": [block["id"] for block in created]},
    )
    return {
        "date": args.date,
        "daily_plan_id": plan["id"],
        "pattern_id": pattern["id"],
        "override_id": override.get("id") if override else None,
        "blocks_created": len(created),
        "block_ids": [block["id"] for block in created],
        "automation_run_id": run["id"],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Materialize work schedule blocks")
    parser.add_argument("--base-url", default=os.environ.get("DAILY_FLOW_DIRECTUS_URL", DEFAULT_BASE_URL))
    parser.add_argument("--token-path", default=os.environ.get("DAILY_FLOW_DIRECTUS_TOKEN_PATH", str(DEFAULT_TOKEN_PATH)))
    parser.add_argument("--timezone", default=DEFAULT_TIMEZONE)
    parser.add_argument("--date", required=True)
    parser.add_argument("--commute-minutes", type=int, default=DEFAULT_COMMUTE_MINUTES)
    args = parser.parse_args()
    print(json.dumps(materialize(args), indent=2))


if __name__ == "__main__":
    main()
