#!/usr/bin/env python3
"""Import Notion Themes/Tasks into the Directus-backed Daily Flow schema."""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from directus_state import DEFAULT_BASE_URL, DEFAULT_TOKEN_PATH, Directus, read_token

NOTION_VERSION = "2025-09-03"
NOTION_KEY_PATH = Path.home() / ".config" / "notion" / "api_key"
TASKS_DATA_SOURCE_ID = "301cd2b6-4b6a-8046-a6f2-000b3229fd2a"
THEMES_DATA_SOURCE_ID = "301cd2b6-4b6a-8009-bac6-000b31f9d443"

STATUS = {
    "Backlog": "backlog",
    "Not started": "not_started",
    "In progress": "in_progress",
    "Paused": "paused",
    "Done": "done",
    "Archived": "archived",
}
PRIORITY = {"P1": "p1", "P2": "p2", "P3": "p3"}
EFFORT = {"XS": "xs", "S": "s", "M": "m", "L": "l"}
TASK_TYPE = {
    "Deep Work": "deep_work",
    "Admin": "admin",
    "Habit": "habit",
    "Event": "event",
    "Planning": "planning",
    "Project-Container": "container",
    "Container": "container",
}
RECURRENCE = {
    "Daily": "daily",
    "Weekly": "weekly",
    "Biweekly": "biweekly",
    "Monthly": "monthly",
    "Quarterly": "quarterly",
    "Half-yearly": "half_yearly",
    "Yearly": "yearly",
}


def notion_request(key: str, method: str, path: str, payload: Any | None = None) -> dict[str, Any]:
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(
        f"https://api.notion.com/v1{path}",
        data=body,
        method=method,
        headers={
            "Authorization": f"Bearer {key}",
            "Notion-Version": NOTION_VERSION,
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Notion {method} {path} -> HTTP {exc.code}: {raw}") from exc


def query_data_source(key: str, data_source_id: str) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    payload: dict[str, Any] = {"page_size": 100}
    while True:
        data = notion_request(key, "POST", f"/data_sources/{data_source_id}/query", payload)
        results.extend(data.get("results", []))
        if not data.get("has_more"):
            return results
        payload["start_cursor"] = data["next_cursor"]


def prop(page: dict[str, Any], name: str) -> dict[str, Any]:
    return page.get("properties", {}).get(name, {})


def text_value(value: dict[str, Any]) -> str:
    typ = value.get("type")
    if typ not in {"title", "rich_text"}:
        return ""
    return "".join(part.get("plain_text", "") for part in value.get(typ, []))


def select_value(value: dict[str, Any]) -> str | None:
    typ = value.get("type")
    if typ in {"select", "status"} and value.get(typ):
        return value[typ].get("name")
    return None


def date_start(value: dict[str, Any]) -> str | None:
    if value.get("type") == "date" and value.get("date"):
        return value["date"].get("start")
    return None


def checkbox(value: dict[str, Any]) -> bool:
    return bool(value.get("checkbox")) if value.get("type") == "checkbox" else False


def relation_ids(value: dict[str, Any]) -> list[str]:
    if value.get("type") != "relation":
        return []
    return [item["id"] for item in value.get("relation", []) if item.get("id")]


def directus_filter(field: str, value: str) -> str:
    return urllib.parse.urlencode({f"filter[{field}][_eq]": value, "limit": 1})


def find_item(client: Directus, collection: str, field: str, value: str) -> dict[str, Any] | None:
    data = client.get(f"/items/{collection}?{directus_filter(field, value)}").get("data", [])
    return data[0] if data else None


def upsert_item(client: Directus, collection: str, identity_field: str, identity_value: str, payload: dict[str, Any]) -> dict[str, Any]:
    existing = find_item(client, collection, identity_field, identity_value)
    if existing:
        return client.patch(f"/items/{collection}/{existing['id']}", payload)["data"]
    return client.post(f"/items/{collection}", payload)["data"]


def main() -> None:
    parser = argparse.ArgumentParser(description="Import Notion tasks into Directus")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--token-path", default=str(DEFAULT_TOKEN_PATH))
    parser.add_argument("--notion-key-path", default=str(NOTION_KEY_PATH))
    parser.add_argument("--include-archived", action="store_true")
    args = parser.parse_args()

    notion_key = Path(args.notion_key_path).read_text().strip()
    client = Directus(args.base_url, read_token(Path(args.token_path)))

    notion_themes = query_data_source(notion_key, THEMES_DATA_SOURCE_ID)
    notion_tasks = query_data_source(notion_key, TASKS_DATA_SOURCE_ID)

    theme_map: dict[str, int] = {}
    for page in notion_themes:
        title = text_value(prop(page, "Name")) or "Untitled theme"
        payload = {
            "title": title,
            "status": STATUS.get(select_value(prop(page, "Status")) or "", "active"),
            "priority": PRIORITY.get(select_value(prop(page, "Priority")) or "", "p2"),
            "notes": text_value(prop(page, "Outcome (90d)")),
            "source": "notion",
            "source_ref": page["id"],
            "created_at": page.get("created_time"),
            "updated_at": page.get("last_edited_time"),
        }
        existing_by_ref = find_item(client, "themes", "source_ref", page["id"])
        if existing_by_ref:
            item = client.patch(f"/items/themes/{existing_by_ref['id']}", payload)["data"]
        else:
            existing_by_title = find_item(client, "themes", "title", title)
            if existing_by_title:
                item = client.patch(f"/items/themes/{existing_by_title['id']}", payload)["data"]
            else:
                item = client.post("/items/themes", payload)["data"]
        theme_map[page["id"]] = item["id"]

    task_map: dict[str, int] = {}
    parent_relations: dict[int, str] = {}
    imported = 0
    skipped = 0

    for page in notion_tasks:
        name = text_value(prop(page, "Name")) or "Untitled task"
        notion_status = select_value(prop(page, "Status"))
        status = STATUS.get(notion_status or "", "not_started")
        if status == "archived" and not args.include_archived:
            skipped += 1
            continue

        recurrence_name = select_value(prop(page, "Recurrence"))
        recurrence = RECURRENCE.get(recurrence_name or "")
        theme_ids = [theme_map[item] for item in relation_ids(prop(page, "Themes")) if item in theme_map]
        parent_ids = relation_ids(prop(page, "Parent tasks"))

        payload: dict[str, Any] = {
            "title": name,
            "status": status,
            "priority": PRIORITY.get(select_value(prop(page, "Priority")) or ""),
            "task_type": TASK_TYPE.get(select_value(prop(page, "Type")) or ""),
            "effort": EFFORT.get(select_value(prop(page, "Effort")) or ""),
            "next_due": date_start(prop(page, "(Next) Due")),
            "first_step": text_value(prop(page, "AI Next Step")),
            "definition_of_done": text_value(prop(page, "Definition of Done")),
            "source": "notion",
            "source_ref": page["id"],
            "theme": theme_ids[0] if theme_ids else None,
            "this_week": checkbox(prop(page, "This week")),
            "auto_roll": checkbox(prop(page, "Auto-roll")),
            "is_recurring": bool(recurrence),
            "recurrence_frequency": recurrence,
            "recurrence_interval": 1 if recurrence else None,
            "recurrence_anchor": date_start(prop(page, "Recurrence anchor")),
            "recurrence_timezone": "Europe/Amsterdam" if recurrence else None,
            "recurrence_next_due": date_start(prop(page, "(Next) Due")) if recurrence else None,
            "recurrence_skip_policy": "roll_forward" if checkbox(prop(page, "Auto-roll")) else "ask",
            "created_at": page.get("created_time"),
            "updated_at": page.get("last_edited_time"),
        }
        payload = {key: value for key, value in payload.items() if value not in {"", None}}
        item = upsert_item(client, "tasks", "source_ref", page["id"], payload)
        task_map[page["id"]] = item["id"]
        if parent_ids:
            parent_relations[item["id"]] = parent_ids[0]
        imported += 1

    parent_updates = 0
    for directus_task_id, notion_parent_id in parent_relations.items():
        if notion_parent_id in task_map:
            client.patch(f"/items/tasks/{directus_task_id}", {"parent_task": task_map[notion_parent_id]})
            parent_updates += 1

    print(
        json.dumps(
            {
                "themes_imported_or_updated": len(theme_map),
                "tasks_imported_or_updated": imported,
                "tasks_skipped": skipped,
                "parent_links_updated": parent_updates,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
