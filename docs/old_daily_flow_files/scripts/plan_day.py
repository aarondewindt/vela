#!/usr/bin/env python3
"""Create a draft Daily Flow day plan from due task occurrences."""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import urllib.parse
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from directus_state import DEFAULT_BASE_URL, DEFAULT_TOKEN_PATH, Directus, day_title, init_plan, now, read_token

DEFAULT_TIMEZONE = "Europe/Amsterdam"
SKIP_TASK_STATUSES = {"done", "archived", "paused"}
SKIP_OCCURRENCE_STATUSES = {"done", "skipped", "cancelled"}
PRIORITY_RANK = {"p1": 1, "p2": 2, "p3": 3, None: 9}
EFFORT_MINUTES = {"xs": 15, "s": 25, "m": 45, "l": 90}
WEEKDAY_PROFILE = {"p1": 1, "p2": 2, "xs": 2, "max_blocks": 3, "start": "18:30", "end": "22:30"}
WEEKEND_PROFILE = {"p1": 2, "p2": 3, "xs": 3, "max_blocks": 5, "start": "10:00", "end": "18:00"}
BLOCKING_BLOCK_STATUSES = {"planned", "active"}
REPLACEABLE_PLANNER_STATUSES = {"planned", "moved", "skipped", "cancelled"}
PROTECTED_PLANNER_STATUSES = {"active", "done"}


def qs(params: dict[str, Any]) -> str:
    return urllib.parse.urlencode(params)


def parse_dt(value: str, tz: ZoneInfo) -> dt.datetime:
    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=tz)
    return parsed.astimezone(tz)


def combine(day: str, hhmm: str, tz: ZoneInfo) -> dt.datetime:
    hour, minute = [int(part) for part in hhmm.split(":", 1)]
    return dt.datetime.combine(dt.date.fromisoformat(day), dt.time(hour, minute), tzinfo=tz)


def profile_for_day(day: str) -> dict[str, Any]:
    weekday = dt.date.fromisoformat(day).weekday()
    return WEEKEND_PROFILE if weekday >= 5 else WEEKDAY_PROFILE


def fetch_all(client: Directus, collection: str, params: dict[str, Any]) -> list[dict[str, Any]]:
    return client.get(f"/items/{collection}?{qs(params)}").get("data", [])


def active_dependency_blockers(client: Directus) -> set[int]:
    rows = fetch_all(
        client,
        "task_dependencies",
        {
            "limit": -1,
            "filter[status][_eq]": "active",
            "fields": "blocked_task,depends_on_task.id,depends_on_task.status",
        },
    )
    blocked: set[int] = set()
    for row in rows:
        dependency = row.get("depends_on_task")
        if isinstance(dependency, dict) and dependency.get("status") not in {"done", "archived"}:
            blocked.add(row["blocked_task"])
    return blocked


def busy_intervals(client: Directus, day: str, tz: ZoneInfo) -> list[tuple[dt.datetime, dt.datetime, str]]:
    start = dt.datetime.combine(dt.date.fromisoformat(day), dt.time.min, tzinfo=tz)
    end = dt.datetime.combine(dt.date.fromisoformat(day), dt.time.max, tzinfo=tz)
    rows = fetch_all(
        client,
        "calendar_events",
        {
            "limit": -1,
            "filter[start_at][_lte]": end.isoformat(),
            "filter[end_at][_gte]": start.isoformat(),
            "filter[busy][_eq]": "true",
            "fields": "title,start_at,end_at",
            "sort": "start_at",
        },
    )
    intervals = []
    for row in rows:
        intervals.append((parse_dt(row["start_at"], tz), parse_dt(row["end_at"], tz), row.get("title") or "Busy"))
    return intervals


def daily_block_intervals(
    client: Directus,
    plan_id: int,
    tz: ZoneInfo,
    exclude_sources: set[str] | None = None,
) -> list[tuple[dt.datetime, dt.datetime, str]]:
    rows = fetch_all(
        client,
        "daily_blocks",
        {
            "limit": -1,
            "filter[daily_plan][_eq]": plan_id,
            "filter[status][_in]": ",".join(sorted(BLOCKING_BLOCK_STATUSES)),
            "fields": "title,start_at,end_at,source",
            "sort": "start_at",
        },
    )
    intervals = []
    for row in rows:
        if exclude_sources and row.get("source") in exclude_sources:
            continue
        intervals.append((parse_dt(row["start_at"], tz), parse_dt(row["end_at"], tz), row.get("title") or "Daily block"))
    return intervals


def reset_planner_blocks(client: Directus, plan_id: int, protect_done: bool = True) -> dict[str, Any]:
    rows = fetch_all(
        client,
        "daily_blocks",
        {
            "limit": -1,
            "filter[daily_plan][_eq]": plan_id,
            "filter[source][_eq]": "planner",
            "fields": "id,status,task_occurrence,external_calendar_id,ha_event_id",
        },
    )
    deleted: list[int] = []
    cancelled: list[int] = []
    protected: list[int] = []
    unlinked_occurrences: list[int] = []
    for row in rows:
        status = row.get("status")
        if protect_done and status in PROTECTED_PLANNER_STATUSES:
            protected.append(row["id"])
            continue
        occurrence_id = row.get("task_occurrence")
        if occurrence_id:
            client.patch(
                f"/items/task_occurrences/{occurrence_id}",
                {"daily_plan": None, "daily_block": None, "updated_at": now()},
            )
            unlinked_occurrences.append(occurrence_id)
        if row.get("external_calendar_id") or row.get("ha_event_id"):
            client.patch(
                f"/items/daily_blocks/{row['id']}",
                {
                    "status": "cancelled",
                    "task_occurrence": None,
                    "notes": "Cancelled by planner replan; old projected calendar event may remain until calendar cleanup is implemented.",
                    "updated_at": now(),
                },
            )
            cancelled.append(row["id"])
        else:
            client.delete(f"/items/daily_blocks/{row['id']}")
            deleted.append(row["id"])
    return {
        "planner_blocks_seen": len(rows),
        "deleted_block_ids": deleted,
        "cancelled_block_ids": cancelled,
        "protected_block_ids": protected,
        "unlinked_occurrence_ids": unlinked_occurrences,
    }


def candidate_occurrences(client: Directus, day: str, tz: ZoneInfo, include_overdue: bool) -> list[dict[str, Any]]:
    end = dt.datetime.combine(dt.date.fromisoformat(day), dt.time.max, tzinfo=tz)
    start = dt.datetime.combine(dt.date.fromisoformat(day), dt.time.min, tzinfo=tz)
    rows = fetch_all(
        client,
        "task_occurrences",
        {
            "limit": -1,
            "fields": "id,title,due_at,status,daily_plan,daily_block,task.id,task.title,task.status,task.priority,task.effort,task.first_step,task.task_type",
            "sort": "due_at",
        },
    )
    blocked = active_dependency_blockers(client)
    candidates = []
    for row in rows:
        if row.get("status") in SKIP_OCCURRENCE_STATUSES:
            continue
        if row.get("daily_block"):
            continue
        task = row.get("task") if isinstance(row.get("task"), dict) else None
        if not task:
            continue
        if task.get("status") in SKIP_TASK_STATUSES:
            continue
        if task.get("id") in blocked:
            continue
        due_at = parse_dt(row["due_at"], tz)
        if due_at > end:
            continue
        if due_at < start and not include_overdue:
            continue
        row["_due_at"] = due_at
        row["_task"] = task
        candidates.append(row)
    candidates.sort(key=lambda item: (item["_due_at"], PRIORITY_RANK.get(item["_task"].get("priority"), 9), item["id"]))
    return candidates


def select_candidates(candidates: list[dict[str, Any]], profile: dict[str, Any]) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    selected_ids: set[int] = set()

    def take(predicate, limit: int) -> None:
        nonlocal selected
        for item in candidates:
            if len(selected) >= profile["max_blocks"] or len([x for x in selected if predicate(x)]) >= limit:
                return
            if item["id"] in selected_ids or not predicate(item):
                continue
            selected.append(item)
            selected_ids.add(item["id"])

    take(lambda item: item["_task"].get("priority") == "p1", profile["p1"])
    take(lambda item: item["_task"].get("priority") == "p2", profile["p2"])
    take(lambda item: item["_task"].get("effort") == "xs", profile["xs"])
    selected.sort(key=lambda item: (PRIORITY_RANK.get(item["_task"].get("priority"), 9), item["_due_at"], item["id"]))
    return selected


def block_type(task: dict[str, Any]) -> str:
    task_type = task.get("task_type")
    if task_type == "admin":
        return "admin"
    if task_type == "habit":
        return "health"
    if task_type == "event":
        return "event"
    return "focus"


def find_slot(
    cursor: dt.datetime,
    duration: dt.timedelta,
    busy: list[tuple[dt.datetime, dt.datetime, str]],
    day_end: dt.datetime,
) -> tuple[dt.datetime, dt.datetime] | None:
    candidate = cursor
    while candidate + duration <= day_end:
        shifted = False
        for busy_start, busy_end, _title in busy:
            if candidate < busy_end and candidate + duration > busy_start:
                candidate = busy_end
                shifted = True
                break
        if not shifted:
            return candidate, candidate + duration
    return None


def find_free_slots(
    window_start: dt.datetime,
    window_end: dt.datetime,
    busy: list[tuple[dt.datetime, dt.datetime, str]],
) -> list[tuple[dt.datetime, dt.datetime]]:
    slots = [(window_start, window_end)]
    for busy_start, busy_end, _title in sorted(busy, key=lambda item: item[0]):
        next_slots = []
        for start, end in slots:
            if busy_end <= start or busy_start >= end:
                next_slots.append((start, end))
                continue
            if busy_start > start:
                next_slots.append((start, min(busy_start, end)))
            if busy_end < end:
                next_slots.append((max(busy_end, start), end))
        slots = next_slots
    return [(start, end) for start, end in slots if end > start]


def find_slot_in_windows(
    windows: list[tuple[dt.datetime, dt.datetime]],
    duration: dt.timedelta,
    cursor: dt.datetime,
) -> tuple[dt.datetime, dt.datetime] | None:
    for window_start, window_end in windows:
        candidate = max(window_start, cursor)
        if candidate + duration <= window_end:
            return candidate, candidate + duration
    return None


def plan(args: argparse.Namespace) -> dict[str, Any]:
    tz = ZoneInfo(args.timezone)
    client = Directus(args.base_url, read_token(Path(args.token_path)))
    plan_row = init_plan(client, args.date, args.timezone)
    profile = profile_for_day(args.date)
    start_time = args.start_time or profile["start"]
    end_time = args.end_time or profile["end"]
    reset_result = None
    if args.replan:
        reset_result = reset_planner_blocks(client, plan_row["id"], protect_done=not args.include_done)

    existing_planner_blocks = fetch_all(
        client,
        "daily_blocks",
        {
            "filter[daily_plan][_eq]": plan_row["id"],
            "filter[source][_eq]": "planner",
            "filter[status][_nin]": "cancelled,skipped",
            "limit": -1,
            "fields": "id",
        },
    )
    if existing_planner_blocks and not args.append:
        run = client.post(
            "/items/automation_runs",
            {
                "daily_plan": plan_row["id"],
                "run_type": "plan_day",
                "status": "succeeded",
                "started_at": now(),
                "finished_at": now(),
                "input": {
                    "date": args.date,
                    "include_overdue": args.include_overdue,
                    "start_time": start_time,
                    "end_time": end_time,
                    "gap_minutes": args.gap_minutes,
                    "append": args.append,
                },
                "output": {
                    "skipped_reason": "existing_planner_blocks",
                    "existing_planner_blocks": len(existing_planner_blocks),
                    "blocks_created": 0,
                },
            },
        )["data"]
        return {
            "date": args.date,
            "daily_plan_id": plan_row["id"],
            "skipped_reason": "existing_planner_blocks",
            "existing_planner_blocks": len(existing_planner_blocks),
            "blocks_created": 0,
            "automation_run_id": run["id"],
        }

    candidates = candidate_occurrences(client, args.date, tz, args.include_overdue)
    selected = select_candidates(candidates, profile)

    day_start = combine(args.date, start_time, tz)
    day_end = combine(args.date, end_time, tz)
    busy = busy_intervals(client, args.date, tz) + daily_block_intervals(client, plan_row["id"], tz, exclude_sources={"planner"})
    free_windows = find_free_slots(day_start, day_end, busy)
    cursor = day_start
    created_blocks = []
    for occurrence in selected:
        task = occurrence["_task"]
        minutes = EFFORT_MINUTES.get(task.get("effort"), 25)
        slot = find_slot_in_windows(free_windows, dt.timedelta(minutes=minutes), cursor)
        if not slot:
            continue
        start, end = slot
        stamp = now()
        title = occurrence.get("title") or task.get("title")
        block = client.post(
            "/items/daily_blocks",
            {
                "daily_plan": plan_row["id"],
                "task": task["id"],
                "task_occurrence": occurrence["id"],
                "title": title,
                "block_type": block_type(task),
                "start_at": start.isoformat(),
                "end_at": end.isoformat(),
                "status": "planned",
                "first_step": task.get("first_step"),
                "source": "planner",
                "notes": f"Draft block created from task_occurrence #{occurrence['id']}",
                "created_at": stamp,
                "updated_at": stamp,
            },
        )["data"]
        client.patch(
            f"/items/task_occurrences/{occurrence['id']}",
            {"daily_plan": plan_row["id"], "daily_block": block["id"], "updated_at": stamp},
        )
        created_blocks.append(block)
        cursor = end + dt.timedelta(minutes=args.gap_minutes)

    run = client.post(
        "/items/automation_runs",
        {
            "daily_plan": plan_row["id"],
            "run_type": "plan_day",
            "status": "succeeded",
            "started_at": now(),
            "finished_at": now(),
        "input": {
                "date": args.date,
                "include_overdue": args.include_overdue,
                "start_time": start_time,
                "end_time": end_time,
                "gap_minutes": args.gap_minutes,
                "profile": profile,
                "append": args.append,
                "replan": args.replan,
                "include_done": args.include_done,
            },
            "output": {
                "candidates": len(candidates),
                "selected": len(selected),
                "busy_intervals": len(busy),
                "free_windows": [[start.isoformat(), end.isoformat()] for start, end in free_windows],
                "reset": reset_result,
                "blocks_created": len(created_blocks),
                "block_ids": [item["id"] for item in created_blocks],
            },
        },
    )["data"]

    if created_blocks:
        client.patch(
            f"/items/daily_plans/{plan_row['id']}",
            {
                "status": "active",
                "title": plan_row.get("title") or day_title(args.date),
                "summary": f"Draft plan with {len(created_blocks)} generated blocks.",
                "updated_at": now(),
            },
        )

    return {
        "date": args.date,
        "daily_plan_id": plan_row["id"],
        "candidates": len(candidates),
        "selected": len(selected),
        "busy_intervals": len(busy),
        "free_windows": [[start.isoformat(), end.isoformat()] for start, end in free_windows],
        "reset": reset_result,
        "blocks_created": len(created_blocks),
        "block_ids": [item["id"] for item in created_blocks],
        "automation_run_id": run["id"],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Create a draft Daily Flow day plan")
    parser.add_argument("--base-url", default=os.environ.get("DAILY_FLOW_DIRECTUS_URL", DEFAULT_BASE_URL))
    parser.add_argument("--token-path", default=os.environ.get("DAILY_FLOW_DIRECTUS_TOKEN_PATH", str(DEFAULT_TOKEN_PATH)))
    parser.add_argument("--timezone", default=DEFAULT_TIMEZONE)
    parser.add_argument("--date", required=True)
    parser.add_argument("--include-overdue", action="store_true")
    parser.add_argument("--start-time", help="HH:MM; default depends on weekday/weekend profile")
    parser.add_argument("--end-time", help="HH:MM; default depends on weekday/weekend profile")
    parser.add_argument("--gap-minutes", type=int, default=15)
    parser.add_argument("--append", action="store_true", help="Append blocks even if the daily plan already has blocks")
    parser.add_argument("--replan", action="store_true", help="Reset replaceable planner blocks before planning")
    parser.add_argument("--include-done", action="store_true", help="Allow replan to replace active/done planner blocks")
    args = parser.parse_args()
    print(json.dumps(plan(args), indent=2))


if __name__ == "__main__":
    main()
