#!/usr/bin/env python3
"""Apply explicit user feedback to a Daily Flow plan."""
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

from directus_state import DEFAULT_BASE_URL, DEFAULT_TOKEN_PATH, DEFAULT_TIMEZONE, Directus, get_plan, log_run, now, read_token

SCHEDULED_STATUSES = {"planned", "active", "moved"}
FIXED_SOURCES = {"work_schedule"}


def qs(params: dict[str, Any]) -> str:
    return urllib.parse.urlencode(params)


def parse_dt(value: str, tz: ZoneInfo) -> dt.datetime:
    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=tz)
    return parsed.astimezone(tz)


def combine(day: str, hhmm: str, tz: ZoneInfo) -> str:
    hour, minute = [int(part) for part in hhmm.split(":", 1)]
    return dt.datetime.combine(dt.date.fromisoformat(day), dt.time(hour, minute), tzinfo=tz).isoformat()


def fetch_all(client: Directus, collection: str, params: dict[str, Any]) -> list[dict[str, Any]]:
    return client.get(f"/items/{collection}?{qs(params)}").get("data", [])


def resolve_conflicts(
    client: Directus,
    plan_id: int,
    anchor_block_id: int,
    tz: ZoneInfo,
    gap_minutes: int,
) -> dict[str, Any]:
    rows = fetch_all(
        client,
        "daily_blocks",
        {
            "filter[daily_plan][_eq]": plan_id,
            "filter[status][_in]": ",".join(sorted(SCHEDULED_STATUSES)),
            "limit": -1,
            "fields": "id,title,start_at,end_at,status,source",
            "sort": "start_at",
        },
    )
    blocks = []
    for row in rows:
        start = parse_dt(row["start_at"], tz)
        end = parse_dt(row["end_at"], tz)
        blocks.append({**row, "_start": start, "_end": end, "_duration": end - start})

    anchor = next((block for block in blocks if block["id"] == anchor_block_id), None)
    if not anchor:
        return {"adjusted_blocks": [], "adjusted_block_ids": [], "overflow_block_ids": [], "skipped_reason": "anchor_missing"}

    gap = dt.timedelta(minutes=gap_minutes)
    cursor = anchor["_end"] + gap
    adjusted: list[dict[str, Any]] = []
    overflow: list[int] = []
    day_end = dt.datetime.combine(anchor["_start"].date(), dt.time(23, 59), tzinfo=tz)

    for block in sorted(blocks, key=lambda item: (item["_start"], item["id"])):
        if block["id"] == anchor_block_id or block["_start"] < anchor["_start"]:
            continue
        if block.get("source") in FIXED_SOURCES:
            if block["_end"] > cursor:
                cursor = block["_end"] + gap
            continue

        new_start = max(block["_start"], cursor)
        new_end = new_start + block["_duration"]
        if new_start == block["_start"] and new_end == block["_end"]:
            cursor = block["_end"] + gap
            continue

        payload = {
            "start_at": new_start.isoformat(),
            "end_at": new_end.isoformat(),
            "status": block.get("status") or "planned",
            "updated_at": now(),
        }
        client.patch(f"/items/daily_blocks/{block['id']}", payload)
        adjusted.append(
            {
                "block_id": block["id"],
                "title": block.get("title"),
                "start_at": payload["start_at"],
                "end_at": payload["end_at"],
            }
        )
        if new_end > day_end:
            overflow.append(block["id"])
        cursor = new_end + gap

    return {
        "adjusted_blocks": adjusted,
        "adjusted_block_ids": [item["block_id"] for item in adjusted],
        "overflow_block_ids": overflow,
    }


def find_block(client: Directus, plan_id: int, block_id: int | None, title_contains: str | None) -> dict[str, Any]:
    if block_id:
        return client.get(f"/items/daily_blocks/{block_id}")["data"]
    if not title_contains:
        raise SystemExit("Provide --block-id or --title-contains")
    rows = fetch_all(
        client,
        "daily_blocks",
        {
            "filter[daily_plan][_eq]": plan_id,
            "filter[title][_icontains]": title_contains,
            "limit": 2,
            "fields": "id,title,status,task,task_occurrence,start_at,end_at",
        },
    )
    if not rows:
        raise SystemExit(f"No block title matching {title_contains!r}")
    if len(rows) > 1:
        raise SystemExit("Multiple matching blocks: " + ", ".join(f"{row['id']}:{row['title']}" for row in rows))
    return rows[0]


def record_checkin(
    client: Directus,
    plan_id: int,
    message: str,
    action: str,
    block_id: int | None = None,
) -> dict[str, Any]:
    return client.post(
        "/items/checkins",
        {
            "daily_plan": plan_id,
            "daily_block": block_id,
            "direction": "user",
            "message": message,
            "action": action,
            "created_at": now(),
        },
    )["data"]


def apply(args: argparse.Namespace) -> dict[str, Any]:
    tz = ZoneInfo(args.timezone)
    client = Directus(args.base_url, read_token(Path(args.token_path)))
    plan = get_plan(client, args.date)
    if not plan:
        raise SystemExit(f"No daily plan for {args.date}")
    stamp = now()
    output: dict[str, Any] = {}
    block_id_for_checkin: int | None = None
    resolve_anchor_id: int | None = None

    if args.action in {"done", "cancel", "skip", "delay", "reschedule", "replace"}:
        block = find_block(client, plan["id"], args.block_id, args.title_contains)
        block_id_for_checkin = block["id"]
        if args.action == "done":
            client.patch(f"/items/daily_blocks/{block['id']}", {"status": "done", "updated_at": stamp})
            occurrence_id = block.get("task_occurrence")
            if occurrence_id:
                client.patch(
                    f"/items/task_occurrences/{occurrence_id}",
                    {"status": "done", "completed_at": stamp, "updated_at": stamp},
                )
            output = {"block_id": block["id"], "status": "done", "task_occurrence": occurrence_id}
        elif args.action in {"cancel", "skip"}:
            status = "cancelled" if args.action == "cancel" else "skipped"
            client.patch(f"/items/daily_blocks/{block['id']}", {"status": status, "updated_at": stamp})
            occurrence_id = block.get("task_occurrence")
            if occurrence_id:
                client.patch(
                    f"/items/task_occurrences/{occurrence_id}",
                    {"daily_plan": None, "daily_block": None, "updated_at": stamp},
                )
            output = {"block_id": block["id"], "status": status, "unlinked_task_occurrence": occurrence_id}
        elif args.action in {"delay", "reschedule"}:
            if not args.start or not args.end:
                raise SystemExit("--start and --end are required for delay/reschedule")
            start = combine(args.date, args.start, tz)
            end = combine(args.date, args.end, tz)
            client.patch(
                f"/items/daily_blocks/{block['id']}",
                {"start_at": start, "end_at": end, "status": "moved", "updated_at": stamp},
            )
            resolve_anchor_id = block["id"]
            output = {"block_id": block["id"], "start_at": start, "end_at": end, "status": "moved"}
        elif args.action == "replace":
            if not args.title or not args.start or not args.end:
                raise SystemExit("--title, --start and --end are required for replace")
            occurrence_id = block.get("task_occurrence")
            if occurrence_id:
                client.patch(
                    f"/items/task_occurrences/{occurrence_id}",
                    {"daily_plan": None, "daily_block": None, "updated_at": stamp},
                )
            client.patch(f"/items/daily_blocks/{block['id']}", {"status": "cancelled", "updated_at": stamp})
            start = combine(args.date, args.start, tz)
            end = combine(args.date, args.end, tz)
            replacement = client.post(
                "/items/daily_blocks",
                {
                    "daily_plan": plan["id"],
                    "title": args.title,
                    "block_type": args.block_type or "admin",
                    "start_at": start,
                    "end_at": end,
                    "status": "planned",
                    "first_step": args.first_step,
                    "source": "user_feedback",
                    "notes": args.notes or f"Replacement for daily_block #{block['id']}",
                    "created_at": stamp,
                    "updated_at": stamp,
                },
            )["data"]
            block_id_for_checkin = replacement["id"]
            resolve_anchor_id = replacement["id"]
            output = {
                "cancelled_block_id": block["id"],
                "replacement_block_id": replacement["id"],
                "unlinked_task_occurrence": occurrence_id,
                "title": args.title,
                "start_at": start,
                "end_at": end,
            }

    elif args.action in {"break", "add-task"}:
        if not args.title or not args.start or not args.end:
            raise SystemExit("--title, --start and --end are required")
        start = combine(args.date, args.start, tz)
        end = combine(args.date, args.end, tz)
        block_type = "rest" if args.action == "break" else (args.block_type or "admin")
        block = client.post(
            "/items/daily_blocks",
            {
                "daily_plan": plan["id"],
                "title": args.title,
                "block_type": block_type,
                "start_at": start,
                "end_at": end,
                "status": "planned",
                "first_step": args.first_step,
                "source": "user_feedback",
                "notes": args.notes,
                "created_at": stamp,
                "updated_at": stamp,
            },
        )["data"]
        block_id_for_checkin = block["id"]
        resolve_anchor_id = block["id"]
        output = {"block_id": block["id"], "title": args.title, "start_at": start, "end_at": end, "block_type": block_type}
    else:
        raise SystemExit(f"Unsupported action: {args.action}")

    checkin = record_checkin(
        client,
        plan["id"],
        args.message or f"{args.action}: {output}",
        args.action,
        block_id_for_checkin,
    )
    if resolve_anchor_id and not args.no_resolve_conflicts:
        output["conflict_resolution"] = resolve_conflicts(
            client,
            plan["id"],
            resolve_anchor_id,
            tz,
            args.conflict_gap_minutes,
        )
    run = log_run(
        client,
        "apply_feedback",
        "succeeded",
        daily_plan_id=plan["id"],
        input_payload=vars(args),
        output_payload={"checkin_id": checkin["id"], **output},
    )
    return {"date": args.date, "daily_plan_id": plan["id"], "checkin_id": checkin["id"], "output": output, "automation_run_id": run["id"]}


def main() -> None:
    parser = argparse.ArgumentParser(description="Apply explicit Daily Flow feedback")
    parser.add_argument("--base-url", default=os.environ.get("DAILY_FLOW_DIRECTUS_URL", DEFAULT_BASE_URL))
    parser.add_argument("--token-path", default=os.environ.get("DAILY_FLOW_DIRECTUS_TOKEN_PATH", str(DEFAULT_TOKEN_PATH)))
    parser.add_argument("--timezone", default=DEFAULT_TIMEZONE)
    parser.add_argument("--date", required=True)
    parser.add_argument("--action", required=True, choices=["done", "cancel", "skip", "delay", "reschedule", "replace", "break", "add-task"])
    parser.add_argument("--message")
    parser.add_argument("--block-id", type=int)
    parser.add_argument("--title-contains")
    parser.add_argument("--title")
    parser.add_argument("--block-type")
    parser.add_argument("--start", help="HH:MM")
    parser.add_argument("--end", help="HH:MM")
    parser.add_argument("--first-step")
    parser.add_argument("--notes")
    parser.add_argument("--conflict-gap-minutes", type=int, default=0)
    parser.add_argument("--no-resolve-conflicts", action="store_true")
    args = parser.parse_args()
    print(json.dumps(apply(args), indent=2))


if __name__ == "__main__":
    main()
