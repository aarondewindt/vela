# Working with Copilot and Codex

## Shared project context

- Both agents should follow the root [AGENTS.md](../AGENTS.md). Copilot also supports `AGENTS.md` in agent mode; Codex loads it from the repository root. No separate Copilot-only instructions are needed.
- Shared agent skills are in `.agents/skills/`. Copilot and Codex both discover this directory. The Prisma skills use standard `SKILL.md` frontmatter and optional `references/` files.
- Architecture and frontend state conventions are described in [architecture.md](architecture.md) and [FRONTEND_API.md](FRONTEND_API.md). Read the relevant docs before significant changes.

## Skills maintenance

Prisma 7.9.1 is the version declared in `package.json`. The project uses the general `skills` CLI and `skills-lock.json` to manage skills; Prisma does not provide a project setting that pins skills to the installed Prisma version or changes their target directory. The CLI supports choosing agents, and both Codex and GitHub Copilot use `.agents/skills`, which remains the single tracked source. `.claude/skills` and `.windsurf/skills` contain symlink mirrors for those agents.

When upgrading Prisma, review the Prisma skill sources and run `npx skills update -p`, then inspect the resulting skill and lockfile diff. Skill content is maintained independently of the npm Prisma package version; updating Prisma does not automatically update its skills. The current `skills-lock.json` also contains 12 `prisma-next` entries without matching directories under `.agents/skills`; do not assume those skills are currently available or remove their lock entries without confirming the intended source/update behavior.

When adding Prisma skills specifically for Codex and Copilot, target those agents explicitly: `npx skills add prisma/skills --skill '*' --agent codex github-copilot --yes`. Both target `.agents/skills`; the existing Claude and Windsurf symlinks can remain as local compatibility paths.

## MCP servers

The source of truth is `.vscode/mcp.json`; `.codex/config.toml` mirrors its server names, endpoints, commands, arguments and environment requirements. Keep both files aligned when a server changes. Do not copy credentials into either file.

| Server | Transport | Configuration notes |
| --- | --- | --- |
| `better-auth` | Streamable HTTP | `https://mcp.better-auth.com/mcp`; neither file currently specifies credentials. |
| `mantine-mcp-server` | stdio | Runs `npx @mantine/mcp-server`; VS Code prompts for `MANTINE_MCP_DATA_URL`, while Codex forwards that variable from its host environment. Timeout is 10000 ms. |
| `next-devtools` | stdio | Runs `npx -y next-devtools-mcp@latest`; it relies on the local Next.js development server for runtime tools. |

The remote Better Auth endpoint is shared by URL. Each agent starts its own local stdio process for Mantine and Next DevTools; the current VS Code definitions do not expose shared local endpoints for those processes. Codex project configuration is loaded only after the repository is trusted. If the remote service requires authentication in your environment, configure it through Codex's supported user-level OAuth/token mechanism, not a committed secret.

## Setup and handoff

Install the OpenAI Codex extension from the VS Code Extensions view and choose its **Sign in with ChatGPT** flow using the ChatGPT subscription account with Codex access. Access depends on the account's current plan entitlements. Trust this repository in Codex to load `.codex/config.toml`. Before launching the Codex host, make `MANTINE_MCP_DATA_URL` available in its environment if using the Mantine MCP server; unlike VS Code's `promptString` input, the Codex project config forwards an existing environment variable and does not prompt for it.

For cross-agent continuation, update [agent-handoff.md](agent-handoff.md) when significant work is incomplete: state the objective, relevant files, completed work, decisions, open issues, next steps and validation. Clear the checkpoint when the task is complete. Avoid having two agents edit the same working tree concurrently; use separate Git worktrees and coordinate commits or cherry-picks instead.

After changes, run the narrowest relevant test or check and report the exact validation performed. Update architecture or decision documentation for meaningful design changes, not for routine edits.