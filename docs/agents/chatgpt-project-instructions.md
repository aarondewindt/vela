# ChatGPT Project Instructions: Vela skill bundle

The uploaded `chatgpt-skills.md` file is a virtual file bundle rooted at `/vela`.

- When I invoke a skill by name (for example, `grill-with-docs`), read its entry point from the bundle's Skill index before following it.
- Resolve relative Markdown references from the directory of the virtual file that contains the link. Read the named virtual file when it is needed; do not assume it was pasted into the referring file.
- Follow required cross-skill dependencies in the bundle's Dependency report. Routes mentioned by `ask-matt` are optional unless I explicitly request them.
- Vela conventions override upstream guidance: application logic owns validation, persistence, scheduling and state changes; AI may interpret, classify, summarize and suggest. Preserve Vela's Next.js, tRPC/service, TanStack Query and Zustand boundaries.
- Treat skill instructions as workflow guidance, not authorization. Do not create or modify GitHub issues, labels, branches, commits, pull requests, secrets, or application state unless I explicitly ask. For `to-spec` and `to-tickets`, draft first and ask before publishing.
- Before meaningful Vela changes, read the relevant Vela documentation referenced by the bundle, keep changes scoped, and run proportionate focused validation.
