#!/usr/bin/env python3
"""Generate concrete Daily Flow task occurrences from task definitions."""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import urllib.parse
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from directus_state import DEFAULT_BASE_URL, DEFAULT_TOKEN_PATH, Directus, now, read_token

DEFAULT_TIMEZONE = "Europe/Amsterdam"
DONE_STATUSES = {"done", "archived"}


def parse_dt(value: str) -> dt.datetime:
    raw = value.replace("Z", "+00:00")
    parsed = dt.datetime.fromisoformat(raw)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=ZoneInfo(DEFAULT_TIMEZONE))
    return parsed


def parse_day(value: str, tz: ZoneInfo) -> dt.datetime:
    return dt.datetime.combine(dt.date.fromisoformat(value), dt.time.min, tzinfo=tz)


def add_months(value: dt.datetime, months: int) -> dt.datetime:
    month = value.month - 1 + months
    year = value.year + month // 12
    month = month % 12 + 1
    days_in_month = [
        31,
        29 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0) else 28,
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ][month - 1]
    day = min(value.day, days_in_month)
    return value.replace(year=year, month=month, day=day)


def advance(value: dt.datetime, frequency: str, interval: int) -> dt.datetime:
    if frequency == "daily":
        return value + dt.timedelta(days=interval)
    if frequency == "weekly":
        return value + dt.timedelta(days=7 * interval)
    if frequency == "biweekly":
        return value + dt.timedelta(days=14 * interval)
    if frequency == "monthly":
        return add_months(value, interval)
    if frequency == "quarterly":
        return add_months(value, 3 * interval)
    if frequency == "half_yearly":
        return add_months(value, 6 * interval)
    if frequency == "yearly":
        return add_months(value, 12 * interval)
    raise ValueError(f"Unsupported recurrence frequency: {frequency}")


def qs(params: dict[str, Any]) -> str:
    return urllib.parse.urlencode(params)


def fetch_all(client: Directus, collection: str) -> list[dict[str, Any]]:
    data = client.get(f"/items/{collection}?{qs({'limit': -1})}").get("data", [])
    return data


def occurrence_exists(client: Directus, key: str) -> bool:
    data = client.get(f"/items/task_occurrences?{qs({'filter[occurrence_key][_eq]': key, 'limit': 1})}").get("data", [])
    return bool(data)


def create_occurrence(client: Directus, task: dict[str, Any], due_at: dt.datetime, source: str) -> dict[str, Any] | None:
    key = f"task:{task['id']}:due:{due_at.isoformat()}"
    if occurrence_exists(client, key):
        return None
    stamp = now()
    return client.post(
        "/items/task_occurrences",
        {
            "occurrence_key": key,
            "task": task["id"],
            "title": task.get("title"),
            "due_at": due_at.isoformat(),
            "status": "planned",
            "source": source,
            "notes": f"Generated from task #{task['id']}",
            "created_at": stamp,
            "updated_at": stamp,
        },
    )["data"]


def due_seed(task: dict[str, Any]) -> str | None:
    return task.get("recurrence_next_due") or task.get("next_due") or task.get("recurrence_anchor")


def generate(args: argparse.Namespace) -> dict[str, Any]:
    tz = ZoneInfo(args.timezone)
    start = parse_day(args.from_date, tz) if args.from_date else dt.datetime.now(tz).replace(hour=0, minute=0, second=0, microsecond=0)
    horizon = start + dt.timedelta(days=args.days)
    client = Directus(args.base_url, read_token(Path(args.token_path)))
    tasks = fetch_all(client, "tasks")

    created: list[dict[str, Any]] = []
    skipped = 0
    considered = 0

    for task in tasks:
        if task.get("status") in DONE_STATUSES:
            skipped += 1
            continue
        considered += 1
        if task.get("is_recurring"):
            seed = due_seed(task)
            frequency = task.get("recurrence_frequency")
            if not seed or not frequency:
                skipped += 1
                continue
            due = parse_dt(seed).astimezone(tz)
            interval = int(task.get("recurrence_interval") or 1)
            generated_for_task = 0
            if due < start and args.include_overdue:
                item = create_occurrence(client, task, due, "recurrence")
                if item:
                    created.append(item)
            while due < start and generated_for_task < args.max_per_task:
                due = advance(due, frequency, interval)
                generated_for_task += 1
            while due <= horizon and generated_for_task < args.max_per_task:
                item = create_occurrence(client, task, due, "recurrence")
                if item:
                    created.append(item)
                due = advance(due, frequency, interval)
                generated_for_task += 1
            continue

        if task.get("next_due"):
            due = parse_dt(task["next_due"]).astimezone(tz)
            if due <= horizon and (due >= start or args.include_overdue):
                item = create_occurrence(client, task, due, "manual")
                if item:
                    created.append(item)

    run = client.post(
        "/items/automation_runs",
        {
            "run_type": "generate_occurrences",
            "status": "succeeded",
            "started_at": now(),
            "finished_at": now(),
            "input": {
                "from_date": start.date().isoformat(),
                "days": args.days,
                "include_overdue": args.include_overdue,
                "max_per_task": args.max_per_task,
            },
            "output": {
                "tasks_considered": considered,
                "tasks_skipped": skipped,
                "occurrences_created": len(created),
            },
        },
    )["data"]

    return {
        "from_date": start.date().isoformat(),
        "through": horizon.date().isoformat(),
        "tasks_considered": considered,
        "tasks_skipped": skipped,
        "occurrences_created": len(created),
        "automation_run_id": run["id"],
        "created_occurrence_ids": [item["id"] for item in created],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate Directus task occurrences")
    parser.add_argument("--base-url", default=os.environ.get("DAILY_FLOW_DIRECTUS_URL", DEFAULT_BASE_URL))
    parser.add_argument("--token-path", default=os.environ.get("DAILY_FLOW_DIRECTUS_TOKEN_PATH", str(DEFAULT_TOKEN_PATH)))
    parser.add_argument("--timezone", default=DEFAULT_TIMEZONE)
    parser.add_argument("--from-date", help="YYYY-MM-DD; defaults to today in Europe/Amsterdam")
    parser.add_argument("--days", type=int, default=14)
    parser.add_argument("--include-overdue", action="store_true")
    parser.add_argument("--max-per-task", type=int, default=60)
    args = parser.parse_args()
    print(json.dumps(generate(args), indent=2))


if __name__ == "__main__":
    main()
