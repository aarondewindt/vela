#!/usr/bin/env python3
"""Parse natural-language Daily Flow feedback with Ollama structured output."""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from directus_state import DEFAULT_BASE_URL, DEFAULT_TIMEZONE, Directus, build_client, get_plan, log_run

BRIDGE = HERE / "daily_flow_discord_bridge.py"
DEFAULT_OLLAMA_URL = "http://localhost:11434"
DEFAULT_MODEL = "qwen2.5-coder:14b"
SUPPORTED_ACTIONS = {"done", "cancel", "skip", "delay", "reschedule", "replace", "break", "add-task"}
BLOCK_ACTIONS = {"done", "cancel", "skip", "delay", "reschedule", "replace"}
TIME_ACTIONS = {"delay", "reschedule", "replace", "break", "add-task"}
HHMM_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


FEEDBACK_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["action", "confidence"],
    "properties": {
        "action": {
            "type": "string",
            "enum": sorted(SUPPORTED_ACTIONS),
            "description": "The deterministic feedback action to apply.",
        },
        "block_id": {
            "type": ["integer", "null"],
            "description": "Known daily block id when the user names a specific block.",
        },
        "title_contains": {
            "type": ["string", "null"],
            "description": "Short substring of the existing block title to target.",
        },
        "title": {
            "type": ["string", "null"],
            "description": "Title for a new or replacement block.",
        },
        "block_type": {
            "type": ["string", "null"],
            "description": "Optional block type, e.g. admin, focus, rest, chore.",
        },
        "start": {
            "type": ["string", "null"],
            "pattern": "^([01]\\d|2[0-3]):[0-5]\\d$",
            "description": "Start time in 24-hour HH:MM.",
        },
        "end": {
            "type": ["string", "null"],
            "pattern": "^([01]\\d|2[0-3]):[0-5]\\d$",
            "description": "End time in 24-hour HH:MM.",
        },
        "first_step": {
            "type": ["string", "null"],
            "description": "Optional concrete first step for a new/replacement task.",
        },
        "notes": {
            "type": ["string", "null"],
            "description": "Short note explaining the interpretation.",
        },
        "confidence": {
            "type": "number",
            "minimum": 0,
            "maximum": 1,
            "description": "Confidence that the parsed command is correct.",
        },
    },
}


def qs(params: dict[str, Any]) -> str:
    return urllib.parse.urlencode(params)


def today(tz_name: str) -> str:
    return dt.datetime.now(ZoneInfo(tz_name)).date().isoformat()


def parse_stamp(value: str, tz: ZoneInfo) -> dt.datetime:
    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=tz)
    return parsed.astimezone(tz)


def hhmm_to_minutes(value: str) -> int:
    hour, minute = [int(part) for part in value.split(":", 1)]
    return hour * 60 + minute


def compact_plan(client: Directus, day: str, tz_name: str) -> dict[str, Any]:
    plan = get_plan(client, day)
    if not plan:
        raise SystemExit(f"No daily plan for {day}")

    rows = client.get(
        "/items/daily_blocks?"
        + qs(
            {
                "filter[daily_plan][_eq]": plan["id"],
                "filter[status][_in]": "planned,active,moved",
                "limit": -1,
                "fields": "id,title,block_type,status,start_at,end_at,source,first_step",
                "sort": "start_at",
            }
        )
    ).get("data", [])
    tz = ZoneInfo(tz_name)
    blocks = []
    for row in rows:
        blocks.append(
            {
                "id": row.get("id"),
                "title": row.get("title"),
                "block_type": row.get("block_type"),
                "status": row.get("status"),
                "start": parse_stamp(row["start_at"], tz).strftime("%H:%M") if row.get("start_at") else None,
                "end": parse_stamp(row["end_at"], tz).strftime("%H:%M") if row.get("end_at") else None,
                "source": row.get("source"),
                "first_step": row.get("first_step"),
            }
        )
    return {
        "date": day,
        "timezone": tz_name,
        "daily_plan_id": plan["id"],
        "title": plan.get("title"),
        "blocks": blocks,
    }


def ollama_chat(ollama_url: str, model: str, messages: list[dict[str, str]], timeout: int) -> dict[str, Any]:
    payload = {
        "model": model,
        "messages": messages,
        "format": FEEDBACK_SCHEMA,
        "stream": False,
        "options": {"temperature": 0},
    }
    req = urllib.request.Request(
        f"{ollama_url.rstrip('/')}/api/chat",
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(f"Ollama HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise SystemExit(f"Ollama request failed: {exc}") from exc

    data = json.loads(raw)
    content = (data.get("message") or {}).get("content")
    if not content:
        raise SystemExit(f"Ollama returned no message content: {raw}")
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Ollama returned non-JSON content: {content}") from exc
    return {"parsed": parsed, "raw": data}


def build_messages(plan: dict[str, Any], user_message: str) -> list[dict[str, str]]:
    system = (
        "You parse Daily Flow schedule feedback into JSON only. "
        "Use only the provided action enum. Target existing blocks by block_id when obvious, "
        "otherwise use title_contains as a short exact-ish substring from the plan. "
        "For vague relative timing, infer from visible blocks: after dinner usually means 20:00. "
        "For delay/reschedule/replace/break/add-task, provide start and end in HH:MM. "
        "When moving an existing block and the user only gives a new start, preserve the block duration. "
        "Keep titles concise and preserve the user's intent."
    )
    return [
        {"role": "system", "content": system},
        {
            "role": "user",
            "content": json.dumps(
                {
                    "today_plan": plan,
                    "feedback_message": user_message,
                },
                ensure_ascii=False,
            ),
        },
    ]


def block_matches(plan: dict[str, Any], block_id: int | None, title_contains: str | None) -> list[dict[str, Any]]:
    blocks = plan["blocks"]
    if block_id is not None:
        return [block for block in blocks if block.get("id") == block_id]
    if title_contains:
        needle = title_contains.casefold()
        return [block for block in blocks if needle in str(block.get("title") or "").casefold()]
    return []


def validate(parsed: dict[str, Any], plan: dict[str, Any], min_confidence: float) -> dict[str, Any]:
    errors: list[str] = []
    action = parsed.get("action")
    if action not in SUPPORTED_ACTIONS:
        errors.append(f"Unsupported action: {action!r}")

    confidence = parsed.get("confidence")
    if not isinstance(confidence, int | float):
        errors.append("confidence must be a number")
    elif not 0 <= float(confidence) <= 1:
        errors.append("confidence must be between 0 and 1")
    elif float(confidence) < min_confidence:
        errors.append(f"confidence {confidence:.2f} below threshold {min_confidence:.2f}")

    for field in ("start", "end"):
        value = parsed.get(field)
        if value is not None and (not isinstance(value, str) or not HHMM_RE.match(value)):
            errors.append(f"{field} must be HH:MM")

    if action in TIME_ACTIONS:
        if not parsed.get("start") or not parsed.get("end"):
            errors.append(f"{action} requires start and end")
        elif hhmm_to_minutes(parsed["end"]) <= hhmm_to_minutes(parsed["start"]):
            errors.append("end must be after start")

    if action in BLOCK_ACTIONS:
        block_id = parsed.get("block_id")
        if block_id is not None and not isinstance(block_id, int):
            errors.append("block_id must be an integer when present")
        matches = block_matches(plan, block_id, parsed.get("title_contains"))
        if not matches:
            errors.append("No matching block found for block_id/title_contains")
        elif len(matches) > 1:
            errors.append("Multiple matching blocks: " + ", ".join(f"{b['id']}:{b['title']}" for b in matches))
        else:
            parsed["block_id"] = matches[0]["id"]
            parsed["title_contains"] = matches[0]["title"]

    if action in {"replace", "break", "add-task"} and not parsed.get("title"):
        errors.append(f"{action} requires title")

    cleaned = {key: value for key, value in parsed.items() if value not in (None, "")}
    return {"ok": not errors, "errors": errors, "feedback": cleaned}


def state_options(args: argparse.Namespace) -> list[str]:
    result: list[str] = []
    if args.base_url:
        result += ["--base-url", args.base_url]
    if args.token_path:
        result += ["--token-path", args.token_path]
    return result


def bridge_args(args: argparse.Namespace, feedback: dict[str, Any]) -> list[str]:
    result = ["feedback", *state_options(args), "--date", args.date, "--action", feedback["action"], "--message", args.message]
    for key, flag in {
        "block_id": "--block-id",
        "title_contains": "--title-contains",
        "title": "--title",
        "block_type": "--block-type",
        "start": "--start",
        "end": "--end",
        "first_step": "--first-step",
        "notes": "--notes",
    }.items():
        if key in feedback:
            result += [flag, str(feedback[key])]
    if args.prepare_only:
        result.append("--prepare-only")
    return result


def run_bridge(args: argparse.Namespace, feedback: dict[str, Any]) -> dict[str, Any]:
    out = subprocess.check_output([sys.executable, str(BRIDGE), *bridge_args(args, feedback)], text=True)
    return json.loads(out)


def main() -> None:
    parser = argparse.ArgumentParser(description="Parse natural-language Daily Flow feedback and apply it deterministically")
    parser.add_argument("message", help="Natural-language feedback, e.g. 'delay declare expenses after dinner'")
    parser.add_argument("--date")
    parser.add_argument("--timezone", default=DEFAULT_TIMEZONE)
    parser.add_argument("--base-url", default=os.environ.get("DAILY_FLOW_DIRECTUS_URL", DEFAULT_BASE_URL))
    parser.add_argument("--token-path", default=os.environ.get("DAILY_FLOW_DIRECTUS_TOKEN_PATH"))
    parser.add_argument("--ollama-url", default=os.environ.get("DAILY_FLOW_OLLAMA_URL") or os.environ.get("OLLAMA_URL", DEFAULT_OLLAMA_URL))
    parser.add_argument("--model", default=os.environ.get("DAILY_FLOW_PARSE_MODEL", DEFAULT_MODEL))
    parser.add_argument("--ollama-timeout", type=int, default=90)
    parser.add_argument("--min-confidence", type=float, default=0.65)
    parser.add_argument("--dry-run", action="store_true", help="Parse and validate without applying feedback")
    parser.add_argument("--prepare-only", action="store_true", help="Apply state/sync but return prepared Discord action instead of sending")
    args = parser.parse_args()
    args.date = args.date or today(args.timezone)

    client = build_client(args)
    plan = compact_plan(client, args.date, args.timezone)
    messages = build_messages(plan, args.message)
    llm = ollama_chat(args.ollama_url, args.model, messages, args.ollama_timeout)
    validation = validate(llm["parsed"], plan, args.min_confidence)
    result: dict[str, Any] = {
        "date": args.date,
        "model": args.model,
        "message": args.message,
        "validation": validation,
    }

    if not args.dry_run:
        log_run(
            client,
            "parse_feedback",
            "succeeded" if validation["ok"] else "failed",
            daily_plan_id=plan["daily_plan_id"],
            input_payload={"message": args.message, "model": args.model, "dry_run": args.dry_run},
            output_payload={"parsed": llm["parsed"], "validation": validation},
            error=None if validation["ok"] else "; ".join(validation["errors"]),
        )

    if not validation["ok"]:
        print(json.dumps(result, indent=2))
        raise SystemExit(2)

    if args.dry_run:
        print(json.dumps(result, indent=2))
        return

    result["bridge"] = run_bridge(args, validation["feedback"])
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
