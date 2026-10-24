# Next.js runtime diagnostics with Codex

Phase 1 of #105 (#106) connects Codex to the running Vela development server
through Vercel's official `next-devtools-mcp`. Vela uses Next.js 16.2.9, which
already exposes `/_next/mcp` during `next dev`; no Next.js configuration or
application endpoint needs to be added.

## Configuration and persistence

- Codex CLI and the VS Code extension share Codex configuration. The tracked
  `.codex/config.toml` supplies project MCP servers after Codex trusts the project.
  A standalone `.mcp.json` is not the discovery mechanism used here.
- VS Code/Copilot uses `.vscode/mcp.json`. Keep its server definitions aligned
  with Codex; each client starts its own stdio connector process.
- Both files run `npx -y next-devtools-mcp@0.4.0`. The exact version avoids changes
  from `@latest` on a rebuild. Codex allows 60 seconds for initial startup.
  To upgrade, change both files together and repeat the runtime checks below.
- The devcontainer installs `openai.chatgpt` through `customizations.vscode.extensions`.
  The existing Node 24/npm image supplies `npx`; Yarn 4 remains the app package
  manager. No global package install, host executable or user-global MCP entry is
  required. First connector startup downloads the package from npm; after a
  rebuild a lost npm cache is recreated automatically (network access required).
- The repository is bind-mounted at `/workspaces/vela`, so configuration survives
  container replacement. Existing Better Auth/Mantine settings, Android SDK,
  signing/cache mounts, ADB relays and lifecycle commands remain intact.

## Start and use

1. Open Vela using **Dev Containers: Reopen in Container**. For the extension
   installation change, use **Dev Containers: Rebuild and Reopen in Container**.
   Sign in to Codex and trust this repository when prompted. Confirm the Codex
   extension is installed/enabled in the devcontainer, not just on Ubuntu.
2. In a container terminal at `/workspaces/vela`, run `yarn dev` and wait for
   readiness. Reuse an existing Vela server when one is already running. The normal
   port is 3000, already forwarded by the devcontainer.
3. Start a new Codex conversation. Ask it to discover Next.js with `nextjs_index`
   and confirm `/workspaces/vela` with `get_project_metadata` before inspecting it.
4. Open the affected page in a browser, sign in if needed and exercise the changed
   flow. Ask Codex to inspect current errors and logs again after the change.
   Retain focused tests/typechecks appropriate to the change.

Example prompt:

> Use next-devtools to discover Vela on port 3000, verify the project path, list
> routes, read current errors and inspect recent development logs. After my change,
> repeat the diagnostics and distinguish current errors from historical log entries.

The tool sequence is:

```text
nextjs_index()
# If discovery fails or several servers exist, target the actual startup port:
nextjs_index({"port":"3000"})
nextjs_call({"port":"3000","toolName":"get_project_metadata"})
nextjs_call({"port":"3000","toolName":"get_routes"})
nextjs_call({"port":"3000","toolName":"get_errors"})
nextjs_call({"port":"3000","toolName":"get_logs"})
```

Use the input schemas returned by `nextjs_index`; omit `args` for tools without
arguments. `get_logs` returns a file path, not log contents. Read a bounded recent
portion of that file in the container and avoid copying private data into issues.
Available tools depend on the installed Next.js version; do not assume tools from
newer documentation exist. No deprecated `init` step is required.

## Troubleshooting

- **Server missing in Codex:** trust `/workspaces/vela` in Codex and check the
  project `.codex/config.toml`. VS Code's MCP server list only verifies Copilot's
  configuration. If the extension-bundled CLI is on PATH, run `codex mcp list`
  and `codex mcp get next-devtools` from the repository; these check configuration,
  not a successful tool call. Check Codex's VS Code Output channel for startup
  failures. Keep any authentication in supported user settings, outside Git.
- **Configuration changed but tools are stale:** do not assume an active conversation
  reloads its MCP processes. Finish the turn, run **Developer: Reload Window** in
  the container window, then start a new Codex conversation and run the sequence
  above. Restarting only Copilot's MCP process does not restart Codex's connector.
- **No Next.js server found:** `yarn dev` must be running, rather than `yarn start`
  or a production build. Read its startup output for port fallback (for example
  3001) and pass that port explicitly to `nextjs_index`. Check project metadata so
  another Next.js app is not mistaken for Vela.
- **Wrong side of container:** the connector and Next.js must run inside the same
  devcontainer. `localhost` on Ubuntu is a different network context; forwarded
  browser ports do not establish where Codex runs. Use the container's Codex
  extension and `/workspaces/vela`, without adding a proxy or remote endpoint.
- **Connector startup/download failure:** verify `node --version`, `npm --version`
  and `npx` availability in the container and npm registry access. Retry after
  network recovery and reload Codex. A cold npm download may need more than the
  configured 60 seconds; inspect the startup error before adjusting the timeout.
- **Empty errors or metadata:** browser runtime diagnostics depend on active browser
  sessions. Visit/exercise affected pages first. Route listing scans the filesystem;
  it does not compile every route. Empty errors are not proof of full application
  correctness. Historical errors can remain in the log after a fix.

## Verification for #106 — 2026-10-25

The existing VS Code/devcontainer Codex session exposed `next-devtools` and
successfully invoked `nextjs_index` and `nextjs_call`, rather than only starting a
process. The extension-bundled CLI reported version `0.162.0-alpha.17.2`; its
`mcp list` recognized all three project servers. After editing, `mcp get
next-devtools` recognized the pinned command and 60-second timeout.

- Discovery found `http://localhost:3000` with six runtime tools:
  `get_project_metadata`, `get_errors`, `get_page_metadata`, `get_logs`,
  `get_server_action_by_id` and `get_routes`.
- Project metadata confirmed `/workspaces/vela` and `http://localhost:3000`.
- Routes returned 36 App Router entries, including `/planner/today`,
  `/dev-tools/companion` and `/api/trpc/[trpc]`.
- Current errors returned `{"configErrors":[],"sessionErrors":[]}`. This verifies
  error retrieval, not compilation of every route or a newly injected failure.
- Logs resolved to `.next/dev/logs/next-development.log`; reading it confirmed
  server/browser output, historical errors and a subsequent successful compilation.

The active conversation was started with the previous `@latest` config (resolved
to 0.4.0). A fresh connector test using the pinned repository command and an empty
temporary npm cache separately verifies download, stdio connection and the same
runtime calls. This test is a temporary MCP client, not a new Vela MCP server.
Reloading the VS Code window and physically rebuilding the user's devcontainer
remain manual checks; this session cannot reload its own extension host. Repeat
the sequence above after rebuilding to confirm installation/trust and the pinned
configuration in a new Codex conversation.

Sources: [Codex MCP configuration](https://developers.openai.com/codex/mcp),
[Codex project configuration](https://developers.openai.com/codex/config-basic),
[Vercel connector](https://github.com/vercel/next-devtools-mcp),
[Next.js MCP guide](https://nextjs.org/docs/app/guides/mcp).
