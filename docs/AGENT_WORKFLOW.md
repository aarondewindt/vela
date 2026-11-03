# Agent skills and workflow

## Shared project context

All agents follow the root [AGENTS.md](../AGENTS.md). `.agents/skills/` is the only canonical project skill tree and `skills-lock.json` records the upstream source, skill path and content hash for CLI-managed skills.

Codex and GitHub Copilot discover `.agents/skills/` directly. Claude Code and Windsurf use tracked relative symlinks from `.claude/skills/` and `.windsurf/skills/`; those links must point back to the canonical directories and must never become copied skill trees.

Architecture and frontend state conventions are described in [architecture.md](architecture.md) and [FRONTEND_API.md](FRONTEND_API.md). Read the relevant documents before significant application changes.

When an upstream document says to call the `Skill` tool, Codex should invoke the named skill through its normal skill mechanism or, where no dedicated tool is exposed, read and follow `.agents/skills/<name>/SKILL.md`. The root instructions and the user's current request override generic skill defaults.

## Matt Pocock engineering skills

| Skill | Purpose |
| --- | --- |
| `ask-matt` | Optional router describing the broader upstream workflow. |
| `grill-with-docs` | Stress-test a repo-backed idea while maintaining domain documentation. |
| `grill-me` | Stateless wrapper around `grilling`; installed as a dependency. |
| `grilling` | Interview primitive that works through a decision tree in rounds. |
| `to-spec` | Synthesize the current conversation into a specification draft. |
| `to-tickets` | Split an approved plan into tracer-bullet tickets with blocking edges. |
| `implement` | Implement a specification or ticket using TDD and review guidance. |
| `tdd` | Red/green behavior testing at agreed public seams. |
| `diagnosing-bugs` | Build a tight reproduction loop, isolate a cause and retain a regression test. |
| `code-review` | Review a fixed-point diff separately against repository standards and its specification. |
| `improve-codebase-architecture` | Find deepening opportunities and explore a selected candidate. |
| `codebase-design` | Shared deep-module, interface and seam vocabulary. |
| `domain-modeling` | Sharpen domain language and record qualified decisions. |
| `handoff` | Create a portable temporary handoff; installed as a workflow dependency. |
| `setup-matt-pocock-skills` | Configure issue tracking and domain-document locations for this repository. |

The configured tracker is [GitHub Issues](agents/issue-tracker.md). The configured [domain-document layout](agents/domain.md) is single-context and lazy: do not create a glossary or ADR merely to satisfy the layout.

### Dependency map

- `grill-with-docs` invokes `grilling` and `domain-modeling`; `grill-me` invokes `grilling`.
- `implement` invokes `tdd` and `code-review`; `tdd` consults `codebase-design` when the test seam itself needs design work.
- `improve-codebase-architecture` consults `codebase-design`, then uses `grilling` and `domain-modeling` for a selected candidate.
- `code-review`, `to-spec` and `to-tickets` consume the issue-tracker and domain configuration created by `setup-matt-pocock-skills`.
- Supporting templates, scripts and references stay inside their owning skill directory. The CLI installs and updates them with the skill; do not copy them between skills.

`ask-matt` documents the complete upstream catalog and can mention skills that Vela has not installed, including `triage`, `prototype`, `implement-spec`, `pr`, `retro`, `wayfinder`, `research`, `wizard` and others. Those mentions are optional routes, not missing dependencies of Vela's installed collection. Check `.agents/skills/<name>/SKILL.md` before assuming a recommendation is available.

## Vela-specific precedence

The engineering skills are workflow guidance, not authorization and not an alternate architecture:

- GitHub writes require explicit user approval. `to-spec` and `to-tickets` draft before publishing, preserve native sub-issue/dependency relationships and never create labels implicitly.
- `implement` does not commit automatically, despite its upstream final step. It leaves the diff for review unless the user asks for a commit, branch or pull request.
- Validation follows [AGENTS.md](../AGENTS.md): run focused Jest tests and typechecks first, then broader checks in proportion to risk. A full suite is not mandatory for documentation-only or skill-infrastructure changes.
- Vela's deterministic service, persistence, validation, tRPC, state-management and UI conventions remain authoritative. A skill cannot introduce alternate business logic or persistence paths.
- Upstream `/handoff` writes a portable file in the OS temporary directory. It does not replace Vela's tracked [shared checkpoint](agent-handoff.md), which remains the handoff for significant unfinished work that will move between agents.
- Architecture suggestions reuse existing `docs/` material. Add `GLOSSARY.md` lazily and add ADRs only for significant decisions; do not duplicate feature documentation.
- Do not create branches, commits or pull requests merely because an upstream workflow recommends them.

## Prisma skills

The existing Prisma skills remain in `.agents/skills/` and in `skills-lock.json`: `prisma-cli`, `prisma-client-api`, `prisma-compute`, `prisma-database-setup`, `prisma-driver-adapter-implementation`, `prisma-mongodb-upgrade`, `prisma-postgres`, `prisma-postgres-setup` and `prisma-upgrade-v7`.

Prisma 7.9.1 is declared in `package.json`. Skill content is maintained independently of the npm package version; upgrading Prisma does not update skills automatically. The lockfile also contains historical `prisma-next` entries without matching directories under `.agents/skills/`. Do not treat those entries as installed skills or remove them without confirming the intended source/update behavior.

## Managing skills

Use the general `skills` CLI so directories and `skills-lock.json` stay aligned. Review every generated diff.

Update installed skills interactively:

```sh
npx skills update -p
```

Add a Matt Pocock skill for the shared Codex/Copilot location:

```sh
npx skills add mattpocock/skills --skill <skill-name> --agent codex github-copilot --yes
```

Add a Prisma skill in the same way, using `prisma/skills` as the source. After adding a shared skill, add relative Claude and Windsurf symlinks to `.agents/skills/<skill-name>`; never install a second agent-specific copy. If a new skill references other named skills, install only the required dependencies through the CLI, then inspect every referenced script, template and supporting file.

To add the complete Prisma collection for Codex and Copilot, use `npx skills add prisma/skills --skill '*' --agent codex github-copilot --yes`, then review the resulting directories and lockfile.

To remove or replace a skill, use the CLI's supported operation for the installed version and review both the directory and lockfile changes. Do not manually edit computed hashes.

## Validation checklist

For skill changes, application tests are unnecessary unless application code also changed. Validate instead that:

1. Every installed directory has a readable `SKILL.md` with `name` and `description` frontmatter matching its directory.
2. Every local Markdown reference, script and template named by a skill exists.
3. Every named required skill dependency is installed and locked.
4. Claude and Windsurf entries are relative symlinks resolving into `.agents/skills/`, with no duplicated trees.
5. Existing Prisma directories and lockfile entries remain intact.
6. `git status` and `git diff` contain only the intended skill infrastructure, documentation and symlinks.

Static inspection proves that files and dependency references resolve. Runtime discovery is separate: Codex must expose or successfully invoke the skill in a fresh trusted-project session. Skills with `disable-model-invocation: true` are intentionally explicit-only and should not be expected to trigger implicitly.

## MCP servers

The source of truth is `.vscode/mcp.json`; `.codex/config.toml` mirrors its server names, endpoints, commands, arguments and environment requirements. Keep both files aligned when a server changes. Do not copy credentials into either file.

| Server | Transport | Configuration notes |
| --- | --- | --- |
| `better-auth` | Streamable HTTP | `https://mcp.better-auth.com/mcp`; neither file currently specifies credentials. |
| `mantine-mcp-server` | stdio | Runs `npx @mantine/mcp-server`; VS Code prompts for `MANTINE_MCP_DATA_URL`, while Codex forwards that variable from its host environment. Timeout is 10000 ms. |
| `next-devtools` | stdio | Runs `npx -y next-devtools-mcp@0.4.0` inside the devcontainer; Codex allows 60 seconds for startup. See [runtime diagnostics and troubleshooting](NEXT_DEVTOOLS_MCP.md). |

The remote Better Auth endpoint is shared by URL. Each agent starts its own local stdio process for Mantine and Next DevTools; the current VS Code definitions do not expose shared local endpoints for those processes. Codex project configuration is loaded only after the repository is trusted. If a remote service requires authentication, use the agent's supported user-level OAuth or token mechanism, never a committed secret.

## Codex setup and handoff

Install the OpenAI Codex extension from the VS Code Extensions view and use **Sign in with ChatGPT** with an account that has Codex access. Trust this repository to load `.codex/config.toml`. Before launching the Codex host, make `MANTINE_MCP_DATA_URL` available in its environment if using the Mantine MCP server; unlike VS Code's `promptString`, Codex forwards an existing environment variable and does not prompt for it.

For cross-agent continuation, update [agent-handoff.md](agent-handoff.md) when significant work is incomplete: record the objective, relevant files, completed work, decisions, open issues, next steps and validation. Clear the checkpoint when the task is complete. Avoid having two agents edit the same working tree concurrently; use separate Git worktrees and coordinate commits or cherry-picks instead.
