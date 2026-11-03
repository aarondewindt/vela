# Issue tracker: GitHub

Vela issues, specifications and implementation tickets live in GitHub Issues in `aarondewindt/vela`. Do not introduce a second tracker or write issue files under `.scratch/`.

## Access

- Infer the repository from `origin`, then verify that the resolved target is `aarondewindt/vela` before the first write in a session.
- Prefer an available GitHub integration for reads and writes. The `gh` CLI is an equivalent fallback when it is installed and authenticated.
- Read an issue's full body, comments, labels and relationships before acting on it.
- A skill's instruction to publish, label, close, assign or comment is not authorization by itself. Draft first and obtain explicit user approval before changing GitHub.

## Vela conventions

- Preserve existing titles, bodies, labels, assignees, milestones, native sub-issue relationships and dependency links unless the requested work specifically changes them.
- Use native GitHub sub-issues for a parent/child breakdown and native blocking relationships where available. If a relationship cannot be represented natively, retain Vela's existing `Parent: #…`, `Depends on #…` or `Blocked by: #…` body convention.
- Do not close or rewrite a parent issue when creating or completing a child ticket.
- Pull requests are not an issue-triage surface.
- Before creating a new issue, confirm that it belongs in this repository and is not a duplicate.

## Labels

The upstream `triage` skill is not installed, so Vela does not configure its five generic triage roles or create matching labels. Preserve the repository's current labels. If a skill asks for a generic label such as `ready-for-agent`, do not create or apply it unless the user first approves a Vela label mapping.

## Skill behavior

- `to-spec` and `to-tickets` may prepare drafts in the conversation, but publish only after user approval.
- `code-review` may read the originating issue or specification without approval because that is non-mutating.
- `implement` may read a ticket and report its title, but issue comments, status changes, commits, branches and pull requests remain separate, explicitly authorized actions.
