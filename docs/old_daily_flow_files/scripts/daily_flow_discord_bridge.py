#!/usr/bin/env python3
"""Bridge Daily Flow state/rendering to Discord REST actions.

Daily Flow scripts own Directus and Home Assistant state. This bridge owns the
Discord side effect: create/edit the daily forum post after state changes.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import directus_state
import discord_daily

APPLY_FEEDBACK = HERE / "apply_feedback.py"
SYNC_HA = HERE / "project_daily_plan_to_ha.py"
DEFAULT_CONFIG_PATH = (
    Path.home()
    / ".openclaw"
    / "workspace"
    / "integrations"
    / "stacks"
    / "openclaw"
    / "config"
    / "openclaw.json"
)
DISCORD_API = "https://discord.com/api/v10"
USER_AGENT = "OpenClaw Daily Flow V2"


def run_json(args: list[str]) -> dict[str, Any]:
    out = subprocess.check_output([sys.executable, *args], text=True)
    return json.loads(out)


def token_from_config(config_path: Path) -> str:
    if os.environ.get("DISCORD_BOT_TOKEN"):
        return os.environ["DISCORD_BOT_TOKEN"]
    try:
        config = json.loads(config_path.read_text())
        token = config["channels"]["discord"]["token"]
    except (FileNotFoundError, KeyError, json.JSONDecodeError) as exc:
        raise SystemExit(f"Discord token not found in DISCORD_BOT_TOKEN or {config_path}") from exc
    if not token:
        raise SystemExit(f"Discord token is empty in {config_path}")
    return str(token)


def discord_request(method: str, path: str, token: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{DISCORD_API}{path}",
        data=data,
        method=method,
        headers={
            "Authorization": f"Bot {token}",
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(f"Discord {method} {path} failed HTTP {exc.code}: {detail}") from exc
    return json.loads(raw) if raw else {}


def build_client(args: argparse.Namespace) -> directus_state.Directus:
    return discord_daily.build_client(args)


def render(args: argparse.Namespace) -> dict[str, Any]:
    client = build_client(args)
    return discord_daily.make_payload(client, args.date, args.guild_id, args.channel_id, args.platform)


def message_action(payload: dict[str, Any]) -> dict[str, Any]:
    existing = payload.get("existing_thread")
    if existing:
        return {
            "action": "edit",
            "channel": "discord",
            "channelId": str(existing["thread_id"]),
            "messageId": str(existing["post_id"]),
            "message": payload["message"],
        }
    return {
        "action": "send",
        "channel": "discord",
        "to": f"channel:{payload['channel_id']}",
        "threadName": payload["title"],
        "message": payload["message"],
    }


def assert_discord_size(message: str) -> None:
    if len(message) > 2000:
        raise SystemExit(f"Rendered Discord message is {len(message)} chars; refusing to exceed Discord's 2000 char limit")


def post_daily(args: argparse.Namespace) -> dict[str, Any]:
    payload = render(args)
    assert_discord_size(payload["message"])
    action = message_action(payload)
    if args.prepare_only:
        return {"date": args.date, "mode": "prepare", "payload": payload, "message_action": action}

    token = token_from_config(Path(args.config_path))
    client = build_client(args)
    existing = payload.get("existing_thread")
    if existing:
        channel_id = str(existing["thread_id"])
        message_id = str(existing["post_id"])
        edited = discord_request(
            "PATCH",
            f"/channels/{channel_id}/messages/{message_id}",
            token,
            {"content": payload["message"]},
        )
        url = f"https://discord.com/channels/{payload['guild_id']}/{channel_id}/{message_id}"
        directus_state.log_run(
            client,
            "discord_daily_edit",
            "succeeded",
            daily_plan_id=payload["daily_plan_id"],
            input_payload={"date": args.date, "thread_id": channel_id, "post_id": message_id},
            output_payload={"action": "edited", "url": url, "edited_id": edited.get("id")},
        )
        return {
            "date": args.date,
            "action": "edited",
            "title": payload["title"],
            "thread_id": channel_id,
            "post_id": message_id,
            "url": url,
            "edited_id": edited.get("id"),
        }

    created = discord_request(
        "POST",
        f"/channels/{payload['channel_id']}/threads",
        token,
        {"name": payload["title"], "message": {"content": payload["message"]}},
    )
    thread_id = str(created.get("id"))
    post_id = str((created.get("message") or {}).get("id") or thread_id)
    discord_daily.record_thread(
        client,
        args.date,
        args.guild_id,
        args.channel_id,
        post_id,
        thread_id,
        payload["title"],
        args.platform,
    )
    return {
        "date": args.date,
        "action": "created",
        "title": payload["title"],
        "thread_id": thread_id,
        "post_id": post_id,
        "url": f"https://discord.com/channels/{payload['guild_id']}/{thread_id}/{post_id}",
    }


def add_common_state_options(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--base-url")
    parser.add_argument("--token-path")
    parser.add_argument("--config-path", default=os.environ.get("OPENCLAW_CONFIG_PATH", str(DEFAULT_CONFIG_PATH)))


def add_discord_options(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--guild-id", default=discord_daily.DEFAULT_GUILD_ID)
    parser.add_argument("--channel-id", default=discord_daily.DEFAULT_FORUM_CHANNEL_ID)
    parser.add_argument("--platform", default=discord_daily.DEFAULT_PLATFORM)
    parser.add_argument("--prepare-only", action="store_true")


def state_options(args: argparse.Namespace) -> list[str]:
    result: list[str] = []
    if args.base_url:
        result += ["--base-url", args.base_url]
    if args.token_path:
        result += ["--token-path", args.token_path]
    return result


def feedback_args(args: argparse.Namespace) -> list[str]:
    result = state_options(args) + ["--date", args.date, "--action", args.action]
    for attr, flag in {
        "message": "--message",
        "block_id": "--block-id",
        "title_contains": "--title-contains",
        "title": "--title",
        "block_type": "--block-type",
        "start": "--start",
        "end": "--end",
        "first_step": "--first-step",
        "notes": "--notes",
        "conflict_gap_minutes": "--conflict-gap-minutes",
    }.items():
        value = getattr(args, attr)
        if value is not None:
            result += [flag, str(value)]
    if args.no_resolve_conflicts:
        result.append("--no-resolve-conflicts")
    return result


def feedback(args: argparse.Namespace) -> dict[str, Any]:
    applied = run_json([str(APPLY_FEEDBACK), *feedback_args(args)])
    synced = run_json([str(SYNC_HA), *state_options(args), "--date", args.date, "--sync"])
    posted = post_daily(args)
    return {"date": args.date, "applied": applied, "synced": synced, "discord": posted}


def main() -> None:
    parser = argparse.ArgumentParser(description="Daily Flow Discord bridge")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_post = sub.add_parser("post-daily", help="Create or edit the Discord daily post from Directus state")
    add_common_state_options(p_post)
    add_discord_options(p_post)
    p_post.add_argument("--date", required=True)

    p_feedback = sub.add_parser("feedback", help="Apply explicit feedback, sync HA, then edit Discord")
    add_common_state_options(p_feedback)
    add_discord_options(p_feedback)
    p_feedback.add_argument("--date", required=True)
    p_feedback.add_argument("--action", required=True, choices=["done", "cancel", "skip", "delay", "reschedule", "replace", "break", "add-task"])
    p_feedback.add_argument("--message")
    p_feedback.add_argument("--block-id", type=int)
    p_feedback.add_argument("--title-contains")
    p_feedback.add_argument("--title")
    p_feedback.add_argument("--block-type")
    p_feedback.add_argument("--start")
    p_feedback.add_argument("--end")
    p_feedback.add_argument("--first-step")
    p_feedback.add_argument("--notes")
    p_feedback.add_argument("--conflict-gap-minutes", type=int, default=0)
    p_feedback.add_argument("--no-resolve-conflicts", action="store_true")

    args = parser.parse_args()
    if args.cmd == "post-daily":
        print(json.dumps(post_daily(args), indent=2))
    elif args.cmd == "feedback":
        print(json.dumps(feedback(args), indent=2))


if __name__ == "__main__":
    main()
