#!/usr/bin/env python3
"""Daily Flow V2 orchestrator skeleton.

This script coordinates deterministic helpers. Keep cron jobs thin: they should
call this script with a date and mode, not contain Daily Flow behavior.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
STATE = HERE / "directus_state.py"
PROJECT_HA = HERE / "project_daily_plan_to_ha.py"
SYNC_HA_CALENDARS = HERE / "sync_ha_calendars.py"
IMPORT_OVERRIDES = HERE / "import_day_overrides.py"
MATERIALIZE_WORK = HERE / "materialize_work_schedule.py"
PLAN_DAY = HERE / "plan_day.py"
DISCORD_DAILY = HERE / "discord_daily.py"
DISCORD_BRIDGE = HERE / "daily_flow_discord_bridge.py"


def run_json(args: list[str]) -> dict:
    out = subprocess.check_output([sys.executable, *args], text=True)
    return json.loads(out)


def add_state_options(script: Path, args: argparse.Namespace) -> list[str]:
    result = [str(script)]
    if args.base_url:
        result += ["--base-url", args.base_url]
    if args.token_path:
        result += ["--token-path", args.token_path]
    return result


def run_step(name: str, args: list[str]) -> dict:
    return {"name": name, "result": run_json(args)}


def run_morning(args: argparse.Namespace) -> dict:
    steps = []
    steps.append(run_step("init_plan", add_state_options(STATE, args) + ["init-plan", "--date", args.date]))
    steps.append(
        run_step(
            "sync_ha_calendars",
            add_state_options(SYNC_HA_CALENDARS, args) + ["--start-date", args.date, "--days", str(args.days)],
        )
    )
    steps.append(
        run_step(
            "import_day_overrides",
            add_state_options(IMPORT_OVERRIDES, args) + ["--start-date", args.date, "--days", str(args.days)],
        )
    )
    steps.append(
        run_step(
            "materialize_work_schedule",
            add_state_options(MATERIALIZE_WORK, args) + ["--date", args.date],
        )
    )

    plan_args = add_state_options(PLAN_DAY, args) + ["--date", args.date]
    if not args.no_include_overdue:
        plan_args.append("--include-overdue")
    if args.replan:
        plan_args.append("--replan")
    if args.append:
        plan_args.append("--append")
    steps.append(run_step("plan_day", plan_args))

    sync_args = add_state_options(PROJECT_HA, args) + ["--date", args.date, "--entity-id", args.entity_id, "--sync"]
    steps.append(run_step("sync_ha", sync_args))

    discord_args = add_state_options(DISCORD_DAILY, args) + [
        "render",
        "--date",
        args.date,
        "--guild-id",
        args.guild_id,
        "--channel-id",
        args.channel_id,
    ]
    steps.append(run_step("render_discord", discord_args))
    posted = None
    if args.post_discord:
        bridge_args = [str(DISCORD_BRIDGE), "post-daily", "--date", args.date, "--guild-id", args.guild_id, "--channel-id", args.channel_id]
        if args.base_url:
            bridge_args += ["--base-url", args.base_url]
        if args.token_path:
            bridge_args += ["--token-path", args.token_path]
        if args.config_path:
            bridge_args += ["--config-path", args.config_path]
        posted = run_step("post_discord", bridge_args)

    result = {
        "date": args.date,
        "steps": steps,
        "discord_note": "Use --post-discord to have the Discord bridge create/edit the daily post after rendering.",
    }
    if posted:
        result["post_discord"] = posted
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Daily Flow V2 orchestrator")
    parser.add_argument("--base-url")
    parser.add_argument("--token-path")
    sub = parser.add_subparsers(dest="cmd", required=True)
    p_init = sub.add_parser("init-day")
    p_init.add_argument("--date", required=True)
    p_sync = sub.add_parser("sync-ha")
    p_sync.add_argument("--date", required=True)
    p_sync.add_argument("--entity-id", default="calendar.daily_flow")
    p_sync.add_argument("--dry-run", action="store_true")
    p_morning = sub.add_parser("run-morning")
    p_morning.add_argument("--date", required=True)
    p_morning.add_argument("--days", type=int, default=14)
    p_morning.add_argument("--entity-id", default="calendar.daily_flow")
    p_morning.add_argument("--guild-id", default="1480157929603858482")
    p_morning.add_argument("--channel-id", default="1514696582086525019")
    p_morning.add_argument("--config-path")
    p_morning.add_argument("--post-discord", action="store_true")
    p_morning.add_argument("--no-include-overdue", action="store_true")
    p_morning.add_argument("--replan", action="store_true")
    p_morning.add_argument("--append", action="store_true")
    sub.add_parser("discover")
    args = parser.parse_args()
    state_args = add_state_options(STATE, args)
    if args.cmd == "init-day":
        result = run_json(state_args + ["init-plan", "--date", args.date])
        print(json.dumps(result, indent=2))
    elif args.cmd == "sync-ha":
        sync_args = add_state_options(PROJECT_HA, args) + ["--date", args.date, "--entity-id", args.entity_id, "--sync"]
        if args.dry_run:
            sync_args.append("--dry-run")
        result = run_json(sync_args)
        print(json.dumps(result, indent=2))
    elif args.cmd == "run-morning":
        print(json.dumps(run_morning(args), indent=2))
    elif args.cmd == "discover":
        result = run_json(state_args + ["health"])
        print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
