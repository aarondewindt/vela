# Vela

Experimental personal planning and nutrition tracking. See [daily-use deployment](docs/DAILY_USE_DEPLOYMENT.md) for the desktop/Pi Cloudflare Tunnel setup, public startup commands, account setup, backups and recovery.

The native [Android Companion](android/README.md) has a separate Kotlin/Compose project and Ubuntu host build/device workflow. VS Code/Codex can continue editing in the existing devcontainer; the Next.js/Yarn workflow is unchanged.

# Mantine Next.js template

This is a template for [Next.js](https://nextjs.org/) app router + [Mantine](https://mantine.dev/).
If you want to use pages router instead, see [next-pages-template](https://github.com/mantinedev/next-pages-template).

## Features

This template comes with the following features:

- [PostCSS](https://postcss.org/) with [mantine-postcss-preset](https://mantine.dev/styles/postcss-preset)
- [TypeScript](https://www.typescriptlang.org/)
- [Storybook](https://storybook.js.org/)
- [Jest](https://jestjs.io/) setup with [React Testing Library](https://testing-library.com/docs/react-testing-library/intro)
- Oxlint setup for TypeScript and React sources

## npm scripts

### Build and dev scripts

- `dev` – start dev server
- `build` – bundle application for production
- `analyze` – analyzes application bundle with [@next/bundle-analyzer](https://www.npmjs.com/package/@next/bundle-analyzer)

### Testing scripts

- `typecheck` – checks TypeScript types
- `lint` – runs oxlint and stylelint
- `format:test` – checks files with oxfmt
- `jest` – runs jest tests
- `jest:watch` – starts jest watch
- `test` – runs `jest`, `format:test`, `lint` and `typecheck` scripts

### Other scripts

- `storybook` – starts storybook dev server
- `storybook:build` – build production storybook bundle to `storybook-static`
- `format:write` – formats all files with oxfmt

## AI coding agents

For live Next.js errors, routes and logs in Codex, see [Next.js DevTools MCP](docs/NEXT_DEVTOOLS_MCP.md), including devcontainer startup, reload steps and troubleshooting.

Vela supports GitHub Copilot and OpenAI Codex. Shared project instructions are in [AGENTS.md](AGENTS.md); shared architecture and agent setup are in [docs/architecture.md](docs/architecture.md) and [docs/AGENT_WORKFLOW.md](docs/AGENT_WORKFLOW.md). Both agents discover the canonical project skills in `.agents/skills/`, including the Prisma skills.

In VS Code, install the OpenAI Codex extension from the Extensions view and choose **Sign in with ChatGPT** using the subscription account that has Codex access; availability depends on the account's current plan entitlements. Copilot uses the existing VS Code GitHub sign-in. Codex reads the repository MCP configuration in `.codex/config.toml` after you trust the project; VS Code continues to use `.vscode/mcp.json`. Set `MANTINE_MCP_DATA_URL` in the environment that launches Codex if you need the Mantine MCP server; VS Code instead prompts for this value. Do not commit tokens or credentials.

Keep the VS Code and Codex MCP definitions aligned when changing servers. To refresh installed skills after a Prisma upgrade, review the Prisma sources and run `npx skills update -p`; the skills are versioned independently of the Prisma npm package. For a substantial unfinished task, use the Git-tracked [agent handoff](docs/agent-handoff.md). Do not have agents edit one working tree simultaneously; use separate Git worktrees for concurrent tasks. See [the full agent workflow](docs/AGENT_WORKFLOW.md) for transport details and maintenance notes.
