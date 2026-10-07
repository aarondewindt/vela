#!/usr/bin/env python3
"""Add work schedule, location, and override schema to Daily Flow Directus."""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import directus_state


CHOICES = {
    "location_type": [
        ("Home", "home"),
        ("Work", "work"),
        ("University", "university"),
        ("Social", "social"),
        ("Transport hub", "transport_hub"),
        ("Other", "other"),
    ],
    "transport_mode": [
        ("Bike", "bike"),
        ("Transit", "transit"),
        ("Car", "car"),
        ("Walk", "walk"),
        ("Train", "train"),
        ("Other", "other"),
    ],
    "work_pattern_status": [
        ("Active", "active"),
        ("Paused", "paused"),
        ("Archived", "archived"),
    ],
    "location_mode": [
        ("Office", "office"),
        ("Home", "home"),
        ("Hybrid", "hybrid"),
        ("Offsite", "offsite"),
    ],
    "day_override_type": [
        ("Work from home", "wfh"),
        ("Office", "office"),
        ("Holiday", "holiday"),
        ("PTO", "pto"),
        ("Sick", "sick"),
        ("Offsite", "offsite"),
        ("Custom hours", "custom_hours"),
        ("No work", "no_work"),
    ],
    "override_source": [
        ("Manual", "manual"),
        ("Calendar", "calendar"),
        ("Assistant", "assistant"),
        ("Import", "import"),
    ],
}


def choice_options(name: str) -> dict[str, Any]:
    return {"choices": [{"text": text, "value": value} for text, value in CHOICES[name]]}


def build_client(args: argparse.Namespace) -> directus_state.Directus:
    base_url = args.base_url or os.environ.get("DAILY_FLOW_DIRECTUS_URL", directus_state.DEFAULT_BASE_URL)
    token_path = Path(args.token_path or os.environ.get("DAILY_FLOW_DIRECTUS_TOKEN_PATH", directus_state.DEFAULT_TOKEN_PATH))
    return directus_state.Directus(base_url, directus_state.read_token(token_path))


def existing_collections(client: directus_state.Directus) -> set[str]:
    rows = client.get("/collections").get("data", [])
    return {row["collection"] for row in rows}


def existing_fields(client: directus_state.Directus, collection: str) -> dict[str, dict[str, Any]]:
    try:
        rows = client.get(f"/fields/{collection}").get("data", [])
    except directus_state.DirectusError:
        return {}
    return {row["field"]: row for row in rows}


def create_collection(client: directus_state.Directus, collection: str, icon: str, note: str) -> bool:
    if collection in existing_collections(client):
        return False
    client.post(
        "/collections",
        {
            "collection": collection,
            "meta": {
                "collection": collection,
                "icon": icon,
                "note": note,
                "display_template": "{{name}}",
            },
            "schema": {},
        },
    )
    return True


def field_payload(
    field: str,
    field_type: str,
    *,
    interface: str | None = None,
    options: dict[str, Any] | None = None,
    default: Any | None = None,
    required: bool = False,
    nullable: bool = True,
    unique: bool = False,
    special: list[str] | None = None,
    note: str | None = None,
    width: str = "full",
) -> dict[str, Any]:
    schema: dict[str, Any] = {"is_nullable": nullable, "is_unique": unique}
    if default is not None:
        schema["default_value"] = default
    return {
        "field": field,
        "type": field_type,
        "meta": {
            "interface": interface,
            "options": options,
            "required": required,
            "special": special,
            "note": note,
            "width": width,
        },
        "schema": schema,
    }


def create_field(client: directus_state.Directus, collection: str, payload: dict[str, Any]) -> bool:
    if payload["field"] in existing_fields(client, collection):
        return False
    client.post(f"/fields/{collection}", payload)
    return True


def patch_field_meta(
    client: directus_state.Directus,
    collection: str,
    field: str,
    *,
    options: dict[str, Any] | None = None,
    interface: str | None = None,
    note: str | None = None,
) -> bool:
    fields = existing_fields(client, collection)
    if field not in fields:
        return False
    meta = dict(fields[field].get("meta") or {})
    changed = False
    if options is not None and meta.get("options") != options:
        meta["options"] = options
        changed = True
    if interface is not None and meta.get("interface") != interface:
        meta["interface"] = interface
        changed = True
    if note is not None and meta.get("note") != note:
        meta["note"] = note
        changed = True
    if changed:
        client.patch(f"/fields/{collection}/{field}", {"meta": meta})
    return changed


def create_relation(
    client: directus_state.Directus,
    collection: str,
    field: str,
    related_collection: str,
) -> bool:
    relations = client.get("/relations").get("data", [])
    for relation in relations:
        if relation.get("collection") == collection and relation.get("field") == field:
            return False
    client.post(
        "/relations",
        {
            "collection": collection,
            "field": field,
            "related_collection": related_collection,
            "schema": {
                "table": collection,
                "column": field,
                "foreign_key_table": related_collection,
                "foreign_key_column": "id",
            },
            "meta": {
                "many_collection": collection,
                "many_field": field,
                "one_collection": related_collection,
            },
        },
    )
    return True


def ensure_schema(client: directus_state.Directus) -> dict[str, Any]:
    created_collections: list[str] = []
    created_fields: list[str] = []
    updated_fields: list[str] = []
    created_relations: list[str] = []

    for collection, icon, note in [
        ("locations", "place", "Reusable places for work, home, events, and travel planning."),
        ("work_patterns", "work", "Default recurring work availability rules."),
        ("day_overrides", "event_busy", "Per-date exceptions to work and availability patterns."),
    ]:
        if create_collection(client, collection, icon, note):
            created_collections.append(collection)

    field_specs: dict[str, list[dict[str, Any]]] = {
        "locations": [
            field_payload("name", "string", interface="input", required=True, nullable=False, unique=True),
            field_payload("location_type", "string", interface="select-dropdown", options=choice_options("location_type"), default="other"),
            field_payload("address", "text", interface="input-multiline"),
            field_payload("latitude", "decimal", interface="input"),
            field_payload("longitude", "decimal", interface="input"),
            field_payload("default_transport_mode", "string", interface="select-dropdown", options=choice_options("transport_mode"), default="bike"),
            field_payload("default_departure_buffer_min", "integer", interface="input", default=5),
            field_payload("default_arrival_buffer_min", "integer", interface="input", default=5),
            field_payload("notes", "text", interface="input-multiline"),
            field_payload("created_at", "timestamp", interface="datetime", special=["date-created"], note="Created timestamp."),
            field_payload("updated_at", "timestamp", interface="datetime", special=["date-updated"], note="Updated timestamp."),
        ],
        "work_patterns": [
            field_payload("name", "string", interface="input", required=True, nullable=False, unique=True),
            field_payload("status", "string", interface="select-dropdown", options=choice_options("work_pattern_status"), default="active"),
            field_payload("timezone", "string", interface="input", default=directus_state.DEFAULT_TIMEZONE),
            field_payload("days_of_week", "json", interface="tags", note="ISO weekday numbers, Monday=1 through Sunday=7."),
            field_payload("work_start", "time", interface="input", default="09:00:00"),
            field_payload("work_end", "time", interface="input", default="17:00:00"),
            field_payload("lunch_start", "time", interface="input", default="12:00:00"),
            field_payload("lunch_end", "time", interface="input", default="13:00:00"),
            field_payload("lunch_flexible", "boolean", interface="boolean", default=True),
            field_payload("location_mode", "string", interface="select-dropdown", options=choice_options("location_mode"), default="office"),
            field_payload("location", "integer", interface="select-dropdown-m2o", special=["m2o"]),
            field_payload("priority", "integer", interface="input", default=10, note="Lower number wins when patterns overlap."),
            field_payload("effective_from", "date", interface="datetime"),
            field_payload("effective_until", "date", interface="datetime"),
            field_payload("notes", "text", interface="input-multiline"),
            field_payload("created_at", "timestamp", interface="datetime", special=["date-created"]),
            field_payload("updated_at", "timestamp", interface="datetime", special=["date-updated"]),
        ],
        "day_overrides": [
            field_payload("date", "date", interface="datetime", required=True, nullable=False),
            field_payload("title", "string", interface="input", required=True, nullable=False),
            field_payload("override_type", "string", interface="select-dropdown", options=choice_options("day_override_type"), default="custom_hours"),
            field_payload("work_start", "time", interface="input"),
            field_payload("work_end", "time", interface="input"),
            field_payload("lunch_start", "time", interface="input"),
            field_payload("lunch_end", "time", interface="input"),
            field_payload("location", "integer", interface="select-dropdown-m2o", special=["m2o"]),
            field_payload("busy", "boolean", interface="boolean", default=False),
            field_payload("source", "string", interface="select-dropdown", options=choice_options("override_source"), default="manual"),
            field_payload("source_event", "integer", interface="select-dropdown-m2o", special=["m2o"]),
            field_payload("source_event_key", "string", interface="input"),
            field_payload("notes", "text", interface="input-multiline"),
            field_payload("created_at", "timestamp", interface="datetime", special=["date-created"]),
            field_payload("updated_at", "timestamp", interface="datetime", special=["date-updated"]),
        ],
        "daily_blocks": [
            field_payload("location", "integer", interface="select-dropdown-m2o", special=["m2o"]),
            field_payload("origin_location", "integer", interface="select-dropdown-m2o", special=["m2o"]),
            field_payload("destination_location", "integer", interface="select-dropdown-m2o", special=["m2o"]),
            field_payload("transport_mode", "string", interface="select-dropdown", options=choice_options("transport_mode")),
        ],
    }

    for collection, specs in field_specs.items():
        for spec in specs:
            if create_field(client, collection, spec):
                created_fields.append(f"{collection}.{spec['field']}")

    block_choices = [
        ("Focus", "focus"),
        ("Admin", "admin"),
        ("Health", "health"),
        ("Meal", "meal"),
        ("Event", "event"),
        ("Commute", "commute"),
        ("Transport", "transport"),
        ("Work", "work"),
        ("Lunch", "lunch"),
        ("Personal", "personal"),
        ("Chores", "chores"),
        ("Rest", "rest"),
        ("Buffer", "buffer"),
    ]
    if patch_field_meta(
        client,
        "daily_blocks",
        "block_type",
        options={"choices": [{"text": text, "value": value} for text, value in block_choices]},
        interface="select-dropdown",
    ):
        updated_fields.append("daily_blocks.block_type")

    source_choices = [
        ("Google Calendar", "google_calendar"),
        ("Home Assistant", "home_assistant"),
        ("Daily Flow Overrides", "daily_flow_overrides"),
        ("Manual", "manual"),
    ]
    if patch_field_meta(
        client,
        "calendar_events",
        "source",
        options={"choices": [{"text": text, "value": value} for text, value in source_choices]},
        interface="select-dropdown",
    ):
        updated_fields.append("calendar_events.source")

    for collection, field, related in [
        ("work_patterns", "location", "locations"),
        ("day_overrides", "location", "locations"),
        ("day_overrides", "source_event", "calendar_events"),
        ("daily_blocks", "location", "locations"),
        ("daily_blocks", "origin_location", "locations"),
        ("daily_blocks", "destination_location", "locations"),
    ]:
        if create_relation(client, collection, field, related):
            created_relations.append(f"{collection}.{field}->{related}")

    return {
        "created_collections": created_collections,
        "created_fields": created_fields,
        "updated_fields": updated_fields,
        "created_relations": created_relations,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Migrate Daily Flow work schedule schema")
    parser.add_argument("--base-url")
    parser.add_argument("--token-path")
    args = parser.parse_args()
    client = build_client(args)
    print(json.dumps(ensure_schema(client), indent=2))


if __name__ == "__main__":
    main()
