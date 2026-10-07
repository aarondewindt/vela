#!/usr/bin/env python3
"""Daily Flow V2 local SQLite state helpers.

This script is intentionally small and deterministic. It owns local state only;
HA, Notion, and Discord IO live in separate scripts.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sqlite3
from pathlib import Path
from typing import Any

DEFAULT_DB = Path.home() / ".openclaw" / "workspace" / "state" / "daily-flow-v2" / "daily-flow-v2.sqlite"
SCHEMA_VERSION = 1

SCHEMA = [
    """
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS daily_flow_days (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL UNIQUE,
      timezone TEXT NOT NULL DEFAULT 'Europe/Amsterdam',
      status TEXT NOT NULL DEFAULT 'draft',
      ha_calendar_entity_id TEXT,
      discord_forum_channel_id TEXT,
      discord_post_id TEXT,
      discord_thread_id TEXT,
      title TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS daily_flow_blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day_id INTEGER NOT NULL REFERENCES daily_flow_days(id) ON DELETE CASCADE,
      block_key TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      start_ts TEXT NOT NULL,
      end_ts TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'planned',
      source TEXT NOT NULL DEFAULT 'assistant',
      ha_event_uid TEXT,
      notion_task_id TEXT,
      discord_message_id TEXT,
      last_seen_hash TEXT,
      payload_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(day_id, block_key)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS daily_flow_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day_id INTEGER NOT NULL REFERENCES daily_flow_days(id) ON DELETE CASCADE,
      notion_task_id TEXT NOT NULL,
      role TEXT NOT NULL,
      priority_rank INTEGER,
      planned_status TEXT NOT NULL DEFAULT 'candidate',
      completion_status TEXT NOT NULL DEFAULT 'not_started',
      selected_reason TEXT,
      first_step TEXT,
      rollover_policy TEXT,
      payload_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(day_id, notion_task_id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS daily_flow_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day_id INTEGER REFERENCES daily_flow_days(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL,
      source TEXT NOT NULL,
      payload_json TEXT,
      created_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS daily_flow_sync (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      external_type TEXT NOT NULL,
      external_id TEXT NOT NULL,
      local_type TEXT NOT NULL,
      local_id INTEGER NOT NULL,
      last_seen_hash TEXT,
      last_synced_at TEXT NOT NULL,
      UNIQUE(external_type, external_id)
    )
    """,
]


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(path)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    return con


def migrate(con: sqlite3.Connection) -> None:
    with con:
        for stmt in SCHEMA:
            con.execute(stmt)
        con.execute(
            "INSERT OR REPLACE INTO meta(key, value, updated_at) VALUES (?, ?, ?)",
            ("schema_version", str(SCHEMA_VERSION), now()),
        )


def set_config(con: sqlite3.Connection, key: str, value: str) -> None:
    with con:
        con.execute(
            "INSERT OR REPLACE INTO config(key, value, updated_at) VALUES (?, ?, ?)",
            (key, value, now()),
        )


def get_config(con: sqlite3.Connection) -> dict[str, str]:
    return {row["key"]: row["value"] for row in con.execute("SELECT key, value FROM config ORDER BY key")}


def day_title(day: str) -> str:
    d = dt.date.fromisoformat(day)
    return d.strftime("%a %-d %B %Y")


def init_day(con: sqlite3.Connection, day: str, timezone: str) -> sqlite3.Row:
    created = now()
    title = day_title(day)
    cfg = get_config(con)
    with con:
        con.execute(
            """
            INSERT INTO daily_flow_days(date, timezone, title, ha_calendar_entity_id, discord_forum_channel_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(date) DO UPDATE SET updated_at=excluded.updated_at
            """,
            (
                day,
                timezone,
                title,
                cfg.get("ha_calendar_entity_id"),
                cfg.get("discord_forum_channel_id"),
                created,
                created,
            ),
        )
        con.execute(
            "INSERT INTO daily_flow_events(day_id, event_type, source, payload_json, created_at) VALUES ((SELECT id FROM daily_flow_days WHERE date=?), ?, ?, ?, ?)",
            (day, "init_day", "state.py", json.dumps({"date": day, "title": title}), created),
        )
    return con.execute("SELECT * FROM daily_flow_days WHERE date=?", (day,)).fetchone()


def show_day(con: sqlite3.Connection, day: str) -> dict[str, Any]:
    row = con.execute("SELECT * FROM daily_flow_days WHERE date=?", (day,)).fetchone()
    if not row:
        raise SystemExit(f"No day record for {day}")
    blocks = [dict(r) for r in con.execute("SELECT * FROM daily_flow_blocks WHERE day_id=? ORDER BY start_ts", (row["id"],))]
    tasks = [dict(r) for r in con.execute("SELECT * FROM daily_flow_tasks WHERE day_id=? ORDER BY priority_rank", (row["id"],))]
    return {"day": dict(row), "blocks": blocks, "tasks": tasks}


def update_day(
    con: sqlite3.Connection,
    day: str,
    status: str | None = None,
    discord_post_id: str | None = None,
    discord_thread_id: str | None = None,
) -> sqlite3.Row:
    row = con.execute("SELECT * FROM daily_flow_days WHERE date=?", (day,)).fetchone()
    if not row:
        raise SystemExit(f"No day record for {day}")

    updates: dict[str, str] = {}
    if status is not None:
        updates["status"] = status
    if discord_post_id is not None:
        updates["discord_post_id"] = discord_post_id
    if discord_thread_id is not None:
        updates["discord_thread_id"] = discord_thread_id
    if not updates:
        return row

    updates["updated_at"] = now()
    assignments = ", ".join(f"{key}=?" for key in updates)
    values = list(updates.values()) + [day]
    with con:
        con.execute(f"UPDATE daily_flow_days SET {assignments} WHERE date=?", values)
        con.execute(
            "INSERT INTO daily_flow_events(day_id, event_type, source, payload_json, created_at) VALUES (?, ?, ?, ?, ?)",
            (row["id"], "update_day", "state.py", json.dumps(updates, sort_keys=True), now()),
        )
    return con.execute("SELECT * FROM daily_flow_days WHERE date=?", (day,)).fetchone()


def add_block(
    con: sqlite3.Connection,
    day: str,
    block_key: str,
    kind: str,
    title: str,
    start_ts: str,
    end_ts: str,
    source: str,
    payload_json: str | None,
) -> sqlite3.Row:
    day_row = con.execute("SELECT * FROM daily_flow_days WHERE date=?", (day,)).fetchone()
    if not day_row:
        raise SystemExit(f"No day record for {day}")

    stamp = now()
    with con:
        con.execute(
            """
            INSERT INTO daily_flow_blocks(day_id, block_key, kind, title, start_ts, end_ts, source, payload_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(day_id, block_key) DO UPDATE SET
              kind=excluded.kind,
              title=excluded.title,
              start_ts=excluded.start_ts,
              end_ts=excluded.end_ts,
              source=excluded.source,
              payload_json=excluded.payload_json,
              updated_at=excluded.updated_at
            """,
            (day_row["id"], block_key, kind, title, start_ts, end_ts, source, payload_json, stamp, stamp),
        )
        con.execute(
            "INSERT INTO daily_flow_events(day_id, event_type, source, payload_json, created_at) VALUES (?, ?, ?, ?, ?)",
            (
                day_row["id"],
                "upsert_block",
                "state.py",
                json.dumps({"block_key": block_key, "title": title, "start_ts": start_ts, "end_ts": end_ts}, sort_keys=True),
                stamp,
            ),
        )
    return con.execute(
        "SELECT * FROM daily_flow_blocks WHERE day_id=? AND block_key=?",
        (day_row["id"], block_key),
    ).fetchone()


def update_block_ha_event(con: sqlite3.Connection, day: str, block_key: str, ha_event_uid: str) -> sqlite3.Row:
    day_row = con.execute("SELECT * FROM daily_flow_days WHERE date=?", (day,)).fetchone()
    if not day_row:
        raise SystemExit(f"No day record for {day}")
    block_row = con.execute(
        "SELECT * FROM daily_flow_blocks WHERE day_id=? AND block_key=?",
        (day_row["id"], block_key),
    ).fetchone()
    if not block_row:
        raise SystemExit(f"No block {block_key!r} for {day}")

    stamp = now()
    with con:
        con.execute(
            "UPDATE daily_flow_blocks SET ha_event_uid=?, updated_at=? WHERE id=?",
            (ha_event_uid, stamp, block_row["id"]),
        )
        con.execute(
            """
            INSERT OR REPLACE INTO daily_flow_sync(external_type, external_id, local_type, local_id, last_synced_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            ("ha_calendar_event", ha_event_uid, "daily_flow_block", block_row["id"], stamp),
        )
        con.execute(
            "INSERT INTO daily_flow_events(day_id, event_type, source, payload_json, created_at) VALUES (?, ?, ?, ?, ?)",
            (
                day_row["id"],
                "block_ha_event",
                "state.py",
                json.dumps({"block_key": block_key, "ha_event_uid": ha_event_uid}, sort_keys=True),
                stamp,
            ),
        )
    return con.execute("SELECT * FROM daily_flow_blocks WHERE id=?", (block_row["id"],)).fetchone()


def main() -> None:
    parser = argparse.ArgumentParser(description="Daily Flow V2 SQLite state helper")
    parser.add_argument("--db", default=str(DEFAULT_DB))
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("migrate")
    p_cfg = sub.add_parser("set-config")
    p_cfg.add_argument("key")
    p_cfg.add_argument("value")
    sub.add_parser("config")
    p_day = sub.add_parser("init-day")
    p_day.add_argument("--date", required=True)
    p_day.add_argument("--timezone", default="Europe/Amsterdam")
    p_show = sub.add_parser("show-day")
    p_show.add_argument("--date", required=True)
    p_update_day = sub.add_parser("update-day")
    p_update_day.add_argument("--date", required=True)
    p_update_day.add_argument("--status")
    p_update_day.add_argument("--discord-post-id")
    p_update_day.add_argument("--discord-thread-id")
    p_block = sub.add_parser("add-block")
    p_block.add_argument("--date", required=True)
    p_block.add_argument("--block-key", required=True)
    p_block.add_argument("--kind", required=True)
    p_block.add_argument("--title", required=True)
    p_block.add_argument("--start", required=True)
    p_block.add_argument("--end", required=True)
    p_block.add_argument("--source", default="assistant")
    p_block.add_argument("--payload-json")
    p_block_ha = sub.add_parser("update-block-ha-event")
    p_block_ha.add_argument("--date", required=True)
    p_block_ha.add_argument("--block-key", required=True)
    p_block_ha.add_argument("--ha-event-uid", required=True)
    args = parser.parse_args()

    con = connect(Path(args.db))
    migrate(con)
    if args.cmd == "migrate":
        print(json.dumps({"ok": True, "db": str(Path(args.db)), "schema_version": SCHEMA_VERSION}, indent=2))
    elif args.cmd == "set-config":
        set_config(con, args.key, args.value)
        print(json.dumps({"ok": True, "key": args.key}, indent=2))
    elif args.cmd == "config":
        print(json.dumps(get_config(con), indent=2, sort_keys=True))
    elif args.cmd == "init-day":
        print(json.dumps(dict(init_day(con, args.date, args.timezone)), indent=2))
    elif args.cmd == "show-day":
        print(json.dumps(show_day(con, args.date), indent=2))
    elif args.cmd == "update-day":
        print(
            json.dumps(
                dict(update_day(con, args.date, args.status, args.discord_post_id, args.discord_thread_id)),
                indent=2,
            )
        )
    elif args.cmd == "add-block":
        print(
            json.dumps(
                dict(add_block(con, args.date, args.block_key, args.kind, args.title, args.start, args.end, args.source, args.payload_json)),
                indent=2,
            )
        )
    elif args.cmd == "update-block-ha-event":
        print(json.dumps(dict(update_block_ha_event(con, args.date, args.block_key, args.ha_event_uid)), indent=2))


if __name__ == "__main__":
    main()
