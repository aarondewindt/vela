# Domain documentation

Vela uses a single-context domain-document layout for the engineering skills. This describes where glossary and decision records belong; it does not replace the existing architecture and feature documentation under `docs/`.

## Before exploring

Read the relevant existing documentation first:

- `docs/architecture.md` for current code organization and architectural rules.
- `docs/PROJECT_PLAN.md` for product direction and implemented-versus-planned distinctions.
- The feature document linked from `docs/architecture.md` for the area being changed.
- `GLOSSARY.md`, if it exists, for canonical domain terms.
- Relevant records under `docs/adr/`, if that directory exists.

Missing glossary or ADR files are not errors. Proceed silently and create them only when the work produces content worth recording.

## Layout

- `GLOSSARY.md` at the repository root is the single canonical glossary. Create it lazily when a Vela-specific term is first clarified. Keep definitions independent of implementation details and avoid duplicating definitions already made clear by established terminology.
- `docs/adr/` contains numbered records for significant architectural decisions. Create it lazily. An ADR is appropriate only when the decision is hard to reverse, surprising without context and the result of a real trade-off.
- Existing feature and architecture documents remain authoritative for behavior, contracts and implementation detail. Link to them instead of copying their content into the glossary or an ADR.

Use glossary terms in specifications, issue titles, test names and architecture proposals. If a proposed change contradicts an existing architecture document or ADR, surface the conflict instead of silently overriding it.
