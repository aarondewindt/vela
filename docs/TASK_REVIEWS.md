# AI task reviews

Issue [#32](https://github.com/aarondewindt/vela/issues/32) adds an optional AI review below the notes in the task inspector. Choose **Review task**, inspect the assessments, then optionally select properties and **Apply selected suggestions**. Regeneration saves a new review. Model failures leave existing reviews and task properties intact.

## Assessments and evidence

Reviews contain an AI context summary, separate recorded facts, inferred context and missing information, suggested priority/size/total effort, theme, category, brief and tags, definition clarity, due-date risk, a first step, next steps, and blockers with ways forward. Every scalar assessment includes an explanation. Null property suggestions mean there is insufficient evidence; they cannot be accepted. Due risk can be unknown, low, medium, high or overdue and is an assessment rather than a capacity or deadline guarantee.

The focus score measures **how clearly the task is defined**, not personal concentration or ability:

| Score | Definition |
| --- | --- |
| 1 | Vague: desired outcome is unclear. |
| 2 | Emerging: outcome is identifiable, but scope or prerequisites are unclear. |
| 3 | Defined: outcome and scope are clear; an actionable next step is missing. |
| 4 | Actionable: scope and next step are clear; completion criteria need clarification. |
| 5 | Ready: outcome, scope, next step and completion criteria are explicit. |

Priority uses P1 (highest) through P5 (lowest), and size uses XS through XL. Estimated minutes describes total task effort; scheduled/completed block duration is recorded context, not evidence of actual work duration. Recurring task status and occurrence completion are distinct. The prompt asks for a concrete 5–15 minute first step where possible. Model claims, including the recorded-facts list, remain fallible AI output for the user to inspect.

## Sources and persistence

`lib/task-reviews/` owns bounded context extraction, schema validation, generation, freshness checks and acceptance. Protected `taskReviews.latest`, `generate` and `accept` procedures delegate to this service. `TaskReview` stores the complete supplied source snapshot, SHA-256 fingerprint, source schema version, prompt version, actual provider/model, creation time, and accepted fields/time. Earlier reviews remain stored; the inspector shows the latest saved review.

The consistent source snapshot contains task properties and notes, theme properties/notes, the owner's active theme choices with their versions, incoming and outgoing dependencies and their task versions, occurrences, linked blocks and linked check-ins. Rich text becomes plain text with a content fingerprint; source timestamps and scalar values remain available. Every read and write is scoped to the authenticated owner. Related records belonging to another owner are excluded. No real tasks are reviewed automatically.

A source allows at most 100 active theme choices, 100 dependencies, 200 occurrences, 200 blocks, 200 check-ins and 50,000 serialized characters. Larger sources fail explicitly instead of silently dropping progress. Generation uses the shared structured AI helper, including its 120-second timeout, output bound and Zod validation. Inference runs outside transactions. Embedded task text is untrusted data, never permission to execute instructions or mutate state.

Reviews become outdated when their fingerprint or prompt version changes, including edits to dependencies, theme, available theme choices, notes, progress, timezone, or the current date in the owner's timezone. A review whose source changes during generation is saved as outdated. The inspector refreshes every 30 seconds; acceptance always checks current sources on the server regardless of the displayed state.

## Acceptance and scheduling

Selected, non-null priority, size, estimated effort, first-step, theme, category, brief and tags suggestions can be applied. Theme suggestions choose from the owner's active themes and are checked again during acceptance. `NONE` explicitly removes the theme; `INHERIT` restores category inheritance. An empty brief clears it, and an empty tag array removes all tags. Tags replace the full list, preserve useful existing tags in the proposed replacement, and are limited to 30 unique, nonempty tags of at most 40 characters. Null always means no suggestion, not a request to clear a field. New generation requires all assessments; saved v1 review documents remain readable but require regeneration before acceptance. Acceptance revalidates the complete source and applies selected properties with an acceptance receipt in one transaction. A review can be accepted once; regenerate to consider further changes. Acceptance does not change status, due dates, dependencies or plans.

As with planning proposals, existing writers do not all share an advisory-lock protocol. Acceptance briefly takes PostgreSQL table locks on task/progress sources, users and reviews to prevent changes between revalidation and application. These locks can temporarily delay unrelated writes; the transaction has a 15-second timeout and performs no inference or network work. Ordinary source reads use repeatable-read transactions.

Day planning may reuse up to ten latest, fresh owner-scoped reviews from its current candidate pool. The bounded summaries identify their review/model and label focus, due risk and first steps as AI assessments. Old-source or old-prompt reviews are excluded, and review enrichment is omitted if it exceeds the planning prompt budget. Candidate properties, urgency ranking, placement and constraint validation continue to use deterministic recorded data. Review suggestions never become scheduler property overrides.

## Model configuration and migration

**Settings → AI & models → Planner · Task review** inherits the Balanced profile and then Default LLM. It supports the existing feature-level model override. There is no hardcoded production model.

Migration `20261019230000_task_reviews` adds the review table and cascading owner/task relationships. Run the repository backup command before applying pending migrations, then regenerate Prisma Client. The migration was applied locally after a successful backup.

Validation on 2026-10-19: the complete Jest suite, TypeScript, changed-code lint/format and Prisma schema validation passed. Synthetic PostgreSQL/Ollama checks verified generation, model attribution, unchanged task properties before acceptance, selected-property application, account isolation, stale-theme rejection and scheduler exclusion; temporary users and records were removed. No production build or browser automation was run for this change.
