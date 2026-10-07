#!/usr/bin/env python3
"""Daily Flow state helpers backed by Directus/Postgres."""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

DEFAULT_BASE_URL = "http://daily-flow-directus:8055"
DEFAULT_TOKEN_PATH = (
    Path.home()
    / ".openclaw"
    / "workspace"
    / "integrations"
    / "stacks"
    / "openclaw"
    / "secrets"
    / "daily-flow"
    / "directus_token"
)
DEFAULT_TIMEZONE = "Europe/Amsterdam"


class DirectusError(RuntimeError):
    pass


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def day_title(day: str) -> str:
    d = dt.date.fromisoformat(day)
    return d.strftime("%a %-d %B %Y")


def read_token(path: Path) -> str:
    try:
        return path.read_text().strip()
    except FileNotFoundError as exc:
        raise DirectusError(f"Directus token file not found: {path}") from exc


class Directus:
    def __init__(self, base_url: str, token: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token

    def request(self, method: str, path: str, payload: Any | None = None) -> Any:
        body = None
        headers = {"Authorization": f"Bearer {self.token}"}
        if payload is not None:
            body = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(f"{self.base_url}{path}", data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=20) as res:
                raw = res.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            raw = exc.read().decode("utf-8", errors="replace")
            raise DirectusError(f"{method} {path} -> HTTP {exc.code}: {raw}") from exc
        except urllib.error.URLError as exc:
            raise DirectusError(f"{method} {path} failed: {exc}") from exc
        return json.loads(raw) if raw else {}

    def get(self, path: str) -> Any:
        return self.request("GET", path)

    def post(self, path: str, payload: Any) -> Any:
        return self.request("POST", path, payload)

    def patch(self, path: str, payload: Any) -> Any:
        return self.request("PATCH", path, payload)

    def delete(self, path: str) -> Any:
        return self.request("DELETE", path)


def query_string(params: dict[str, str | int]) -> str:
    return urllib.parse.urlencode(params)


def get_plan(client: Directus, day: str) -> dict[str, Any] | None:
    qs = query_string(
        {
            "filter[plan_date][_eq]": day,
            "limit": 1,
        }
    )
    data = client.get(f"/items/daily_plans?{qs}").get("data", [])
    return data[0] if data else None


def get_plan_children(client: Directus, plan_id: int) -> dict[str, list[dict[str, Any]]]:
    children: dict[str, list[dict[str, Any]]] = {}
    for name, sort in {
        "daily_blocks": "start_at",
        "task_occurrences": "due_at",
        "daily_threads": "id",
        "checkins": "created_at",
        "automation_runs": "-id",
    }.items():
        qs = query_string({"filter[daily_plan][_eq]": plan_id, "sort": sort})
        children[name] = client.get(f"/items/{name}?{qs}").get("data", [])
    return children


def init_plan(client: Directus, day: str, timezone: str) -> dict[str, Any]:
    existing = get_plan(client, day)
    stamp = now()
    if existing:
        return client.patch(
            f"/items/daily_plans/{existing['id']}",
            {"updated_at": stamp},
        )["data"]
    return client.post(
        "/items/daily_plans",
        {
            "plan_date": day,
            "timezone": timezone,
            "status": "draft",
            "title": day_title(day),
            "created_at": stamp,
            "updated_at": stamp,
        },
    )["data"]


def add_block(
    client: Directus,
    day: str,
    title: str,
    start_at: str,
    end_at: str,
    block_type: str,
    status: str,
    first_step: str | None,
    source: str,
    notes: str | None,
) -> dict[str, Any]:
    plan = get_plan(client, day) or init_plan(client, day, DEFAULT_TIMEZONE)
    stamp = now()
    return client.post(
        "/items/daily_blocks",
        {
            "daily_plan": plan["id"],
            "title": title,
            "block_type": block_type,
            "start_at": start_at,
            "end_at": end_at,
            "status": status,
            "first_step": first_step,
            "source": source,
            "notes": notes,
            "created_at": stamp,
            "updated_at": stamp,
        },
    )["data"]


def log_run(
    client: Directus,
    run_type: str,
    status: str,
    daily_plan_id: int | None = None,
    input_payload: dict[str, Any] | None = None,
    output_payload: dict[str, Any] | None = None,
    error: str | None = None,
) -> dict[str, Any]:
    stamp = now()
    return client.post(
        "/items/automation_runs",
        {
            "daily_plan": daily_plan_id,
            "run_type": run_type,
            "status": status,
            "started_at": stamp,
            "finished_at": stamp,
            "input": input_payload or {},
            "output": output_payload or {},
            "error": error,
        },
    )["data"]


def build_client(args: argparse.Namespace) -> Directus:
    base_url = args.base_url or os.environ.get("DAILY_FLOW_DIRECTUS_URL", DEFAULT_BASE_URL)
    token_path = Path(args.token_path or os.environ.get("DAILY_FLOW_DIRECTUS_TOKEN_PATH", DEFAULT_TOKEN_PATH))
    return Directus(base_url, read_token(token_path))


def main() -> None:
    parser = argparse.ArgumentParser(description="Daily Flow Directus/Postgres state helper")
    parser.add_argument("--base-url")
    parser.add_argument("--token-path")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("health")
    sub.add_parser("collections")

    p_init = sub.add_parser("init-plan")
    p_init.add_argument("--date", required=True)
    p_init.add_argument("--timezone", default=DEFAULT_TIMEZONE)

    p_show = sub.add_parser("show-plan")
    p_show.add_argument("--date", required=True)

    p_block = sub.add_parser("add-block")
    p_block.add_argument("--date", required=True)
    p_block.add_argument("--title", required=True)
    p_block.add_argument("--start-at", required=True)
    p_block.add_argument("--end-at", required=True)
    p_block.add_argument("--block-type", default="focus")
    p_block.add_argument("--status", default="planned")
    p_block.add_argument("--first-step")
    p_block.add_argument("--source", default="assistant")
    p_block.add_argument("--notes")

    p_log = sub.add_parser("log-run")
    p_log.add_argument("--run-type", required=True)
    p_log.add_argument("--status", required=True)
    p_log.add_argument("--daily-plan-id", type=int)
    p_log.add_argument("--input-json", default="{}")
    p_log.add_argument("--output-json", default="{}")
    p_log.add_argument("--error")

    args = parser.parse_args()
    client = build_client(args)

    try:
        if args.cmd == "health":
            info = client.get("/server/info")
            user = client.get("/users/me")
            print(json.dumps({"server": info.get("data"), "user": user.get("data")}, indent=2))
        elif args.cmd == "collections":
            data = client.get("/collections").get("data", [])
            print(json.dumps([item["collection"] for item in data if not item["collection"].startswith("directus_")], indent=2))
        elif args.cmd == "init-plan":
            print(json.dumps(init_plan(client, args.date, args.timezone), indent=2))
        elif args.cmd == "show-plan":
            plan = get_plan(client, args.date)
            if not plan:
                raise SystemExit(f"No daily plan for {args.date}")
            plan.update(get_plan_children(client, plan["id"]))
            print(json.dumps(plan, indent=2))
        elif args.cmd == "add-block":
            print(
                json.dumps(
                    add_block(
                        client,
                        args.date,
                        args.title,
                        args.start_at,
                        args.end_at,
                        args.block_type,
                        args.status,
                        args.first_step,
                        args.source,
                        args.notes,
                    ),
                    indent=2,
                )
            )
        elif args.cmd == "log-run":
            print(
                json.dumps(
                    log_run(
                        client,
                        args.run_type,
                        args.status,
                        args.daily_plan_id,
                        json.loads(args.input_json),
                        json.loads(args.output_json),
                        args.error,
                    ),
                    indent=2,
                )
            )
    except DirectusError as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
