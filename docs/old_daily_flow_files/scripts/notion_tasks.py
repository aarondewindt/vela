#!/usr/bin/env python3
"""Notion task IO wrapper for Daily Flow V2.

Initial skeleton. Keep all Notion task reads/writes here so daily-flow prompts do
not hand-roll API payloads.
"""
from __future__ import annotations

import argparse
import json


def main() -> None:
    parser = argparse.ArgumentParser(description="Daily Flow Notion task helper")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("candidates")
    done = sub.add_parser("mark-done")
    done.add_argument("notion_task_id")
    args = parser.parse_args()
    if args.cmd == "candidates":
        raise SystemExit("TODO: implement candidate query against Tasks data_source_id")
    if args.cmd == "mark-done":
        print(json.dumps({"todo": "mark-done", "notion_task_id": args.notion_task_id}, indent=2))


if __name__ == "__main__":
    main()
