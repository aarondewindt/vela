#!/usr/bin/env python3
"""Discord forum-post discipline helper for Daily Flow V2.

This script keeps the deterministic state/idempotency parts local. The actual
Discord create/edit call is still done by the OpenClaw message tool, then its
returned IDs are recorded here.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import urllib.parse
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import directus_state

DEFAULT_GUILD_ID = "1480157929603858482"
DEFAULT_FORUM_CHANNEL_ID = "1514696582086525019"
DEFAULT_PLATFORM = "discord"

def title_for(day: str) -> str:
    d = dt.date.fromisoformat(day)
    return d.strftime("%a %-d %B %Y")


def parse_stamp(value: str | None) -> dt.datetime | None:
    if not value:
        return None
    clean = value.replace("Z", "+00:00")
    try:
        return dt.datetime.fromisoformat(clean)
    except ValueError:
        return None


def display_time(value: str | None) -> str:
    stamp = parse_stamp(value)
    if not stamp:
        return "??:??"
    return stamp.strftime("%H:%M")


def query_string(params: dict[str, str | int]) -> str:
    return urllib.parse.urlencode(params)


def get_daily_thread(
    client: directus_state.Directus,
    plan_id: int,
    platform: str,
    channel_id: str,
) -> dict[str, Any] | None:
    qs = query_string(
        {
            "filter[daily_plan][_eq]": plan_id,
            "filter[platform][_eq]": platform,
            "filter[channel_id][_eq]": channel_id,
            "limit": 2,
        }
    )
    rows = client.get(f"/items/daily_threads?{qs}").get("data", [])
    if len(rows) > 1:
        raise directus_state.DirectusError(
            f"Duplicate daily_threads rows for plan {plan_id} channel {channel_id}: "
            + ", ".join(str(row.get("id")) for row in rows)
        )
    return rows[0] if rows else None


def load_plan(client: directus_state.Directus, day: str) -> dict[str, Any]:
    plan = directus_state.get_plan(client, day)
    if not plan:
        plan = directus_state.init_plan(client, day, directus_state.DEFAULT_TIMEZONE)
    plan.update(directus_state.get_plan_children(client, plan["id"]))
    return plan


def render_post(plan: dict[str, Any]) -> str:
    blocks = sorted(plan.get("daily_blocks", []), key=lambda block: block.get("start_at") or "")
    lines = [
        "**Today at a glance**",
        f"- Status: {plan.get('status', 'draft')}",
        f"- Planned blocks: {len(blocks)}",
    ]

    if not blocks:
        lines.extend(["", "**Plan**"])
        lines.append("- No blocks planned yet.")
    else:
        workday_blocks = [
            block
            for block in blocks
            if block.get("source") == "work_schedule" or block.get("block_type") in {"commute", "work", "lunch"}
        ]
        focus_blocks = [block for block in blocks if block not in workday_blocks]

        def append_section(title: str, section_blocks: list[dict[str, Any]]) -> None:
            if not section_blocks:
                return
            lines.extend(["", f"**{title}**"])
            for block in section_blocks:
                start = display_time(block.get("start_at"))
                end = display_time(block.get("end_at"))
                status = block.get("status") or "planned"
                lines.append(f"**{start}-{end}** {block.get('title', 'Untitled')} - {status}")
                first_step = block.get("first_step")
                if first_step:
                    lines.append(f"↳ {first_step}")

        append_section("Workday", workday_blocks)
        append_section("Evening focus", focus_blocks)

    lines.extend(["", "_Generated from Directus Daily Flow state._"])
    return "\n".join(lines)


def make_payload(
    client: directus_state.Directus,
    day: str,
    guild_id: str,
    channel_id: str,
    platform: str,
) -> dict[str, Any]:
    plan = load_plan(client, day)
    title = plan.get("title") or title_for(day)
    existing = get_daily_thread(client, plan["id"], platform, channel_id)
    return {
        "date": day,
        "daily_plan_id": plan["id"],
        "title": title,
        "guild_id": guild_id,
        "channel_id": channel_id,
        "existing_thread": existing,
        "message": render_post(plan),
    }


def record_thread(
    client: directus_state.Directus,
    day: str,
    guild_id: str,
    channel_id: str,
    post_id: str,
    thread_id: str,
    title: str | None,
    platform: str,
) -> dict[str, Any]:
    plan = load_plan(client, day)
    existing = get_daily_thread(client, plan["id"], platform, channel_id)
    payload = {
        "daily_plan": plan["id"],
        "platform": platform,
        "guild_id": guild_id,
        "channel_id": channel_id,
        "post_id": post_id,
        "thread_id": thread_id,
        "title": title or plan.get("title") or title_for(day),
    }
    if existing:
        row = client.patch(f"/items/daily_threads/{existing['id']}", payload)["data"]
        action = "updated"
    else:
        row = client.post("/items/daily_threads", payload)["data"]
        action = "created"
    directus_state.log_run(
        client,
        "discord_daily_post",
        "succeeded",
        daily_plan_id=plan["id"],
        input_payload={"date": day, "channel_id": channel_id, "platform": platform},
        output_payload={"action": action, "daily_thread_id": row.get("id"), "post_id": post_id, "thread_id": thread_id},
    )
    return row


def build_client(args: argparse.Namespace) -> directus_state.Directus:
    base_url = args.base_url or os.environ.get("DAILY_FLOW_DIRECTUS_URL", directus_state.DEFAULT_BASE_URL)
    token_path = Path(
        args.token_path
        or os.environ.get("DAILY_FLOW_DIRECTUS_TOKEN_PATH", directus_state.DEFAULT_TOKEN_PATH)
    )
    return directus_state.Directus(base_url, directus_state.read_token(token_path))


def main() -> None:
    parser = argparse.ArgumentParser(description="Daily Flow Discord helper")
    parser.add_argument("--base-url")
    parser.add_argument("--token-path")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_title = sub.add_parser("title")
    p_title.add_argument("--date", required=True)

    p_render = sub.add_parser("render")
    p_render.add_argument("--date", required=True)
    p_render.add_argument("--guild-id", default=DEFAULT_GUILD_ID)
    p_render.add_argument("--channel-id", default=DEFAULT_FORUM_CHANNEL_ID)
    p_render.add_argument("--platform", default=DEFAULT_PLATFORM)

    p_record = sub.add_parser("record")
    p_record.add_argument("--date", required=True)
    p_record.add_argument("--guild-id", default=DEFAULT_GUILD_ID)
    p_record.add_argument("--channel-id", default=DEFAULT_FORUM_CHANNEL_ID)
    p_record.add_argument("--platform", default=DEFAULT_PLATFORM)
    p_record.add_argument("--post-id", required=True)
    p_record.add_argument("--thread-id", required=True)
    p_record.add_argument("--title")

    args = parser.parse_args()
    try:
        if args.cmd == "title":
            print(json.dumps({"date": args.date, "title": title_for(args.date)}, indent=2))
        elif args.cmd == "render":
            client = build_client(args)
            print(
                json.dumps(
                    make_payload(client, args.date, args.guild_id, args.channel_id, args.platform),
                    indent=2,
                )
            )
        elif args.cmd == "record":
            client = build_client(args)
            print(
                json.dumps(
                    record_thread(
                        client,
                        args.date,
                        args.guild_id,
                        args.channel_id,
                        args.post_id,
                        args.thread_id,
                        args.title,
                        args.platform,
                    ),
                    indent=2,
                )
            )
    except directus_state.DirectusError as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
