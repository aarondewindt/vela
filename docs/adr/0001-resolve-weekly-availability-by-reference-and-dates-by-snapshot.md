# Resolve versioned weekly availability by reference and dates by snapshot

Vela represents recurring availability with effective-dated weekday-to-template assignments and immutable template revisions, while date-specific availability owns independent slot snapshots. Template edits and assignment changes default to tomorrow; the user may explicitly choose today or a later effective date, but never a past date. The absence of a date override means inherit, and an empty override means explicitly unavailable.

Date availability is separate from other date context currently stored by legacy day overrides, so resetting availability cannot discard unrelated planning context. Copying or duplicating slots creates new identities; optional source provenance is explanatory only and never participates in effective-availability resolution.

Slots retain logical identity across revisions of the same template, while every revision stores immutable values. Template names, slot names, guidance and category policies are versioned alongside times so historical dates cannot display a misleading mixture of old and new configuration. Templates referenced by historical assignments are archived rather than physically deleted. Applying a template to dates copies independent slot identities and never creates a behavioral link back to the template.

Vela preserves the effective configuration applicable to each calendar date rather than a complete event log of abandoned edits. Ordinary availability editing stops when the local date ends so history cannot be silently rewritten; a later correction workflow would need to retain both original and amended values.

Every accepted plan additionally captures the exact effective slots used for planning in a dedicated schema-versioned JSON snapshot. The snapshot includes its timezone and origins, slot identities, local times and resolved instants, names, guidance and category policies; it is immutable provenance rather than another live availability source.

Each successful AI-generated draft revision also records the effective-slot snapshot or hash it actually used. A plan accepted after availability reconciliation records the configuration present at acceptance, so explanations can distinguish work generated under earlier guidance from the configuration under which it was accepted.

Full-day availability resolves across the actual local day, including 23-hour and 25-hour days. Any other slot boundary that is ambiguous or nonexistent during a timezone transition fails explicitly instead of being shifted silently.

Planner timezone is itself effective-dated. A timezone change takes effect today by default, stales an open draft for today and does not reinterpret availability on earlier dates; date overrides and accepted-plan snapshots retain their resolved timezone.

Before saving a template revision, the UI previews its effective date, affected weekdays and open drafts that will become stale. The revision and its effective-dated consequences commit transactionally.

Editing inherited availability for one date first copies its effective slots into an independent date override. Availability saves independently of any working draft or model call. When the resolved availability beneath an open draft changes—including guidance-only changes—the draft remains intact and stale until explicitly reconciled. The user may pin the draft's prior availability into a date override, adopt current availability while preserving every block, regenerate only eligible automatic work while preserving manual/protected blocks, or cancel the draft. Resetting a date removes its override and restores weekly resolution.

Planner conversation may propose reviewed date-specific slot edits, template snapshot application, reset or explicit unavailability. It cannot mutate templates or weekday assignments. Applying the availability proposal does not silently reconcile or regenerate an open draft.

A stale draft remains manually editable and retains undo, redo and cancel. AI generation and acceptance remain blocked until the user explicitly reconciles its availability provenance.
