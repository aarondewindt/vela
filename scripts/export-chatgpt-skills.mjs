#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, relative, dirname, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillsRoot = resolve(repositoryRoot, ".agents/skills");
const outputPath = resolve(repositoryRoot, "docs/agents/chatgpt-skills.md");
const virtualRoot = "/vela";

const selectedSkills = [
  "grilling",
  "grill-with-docs",
  "domain-modeling",
  "codebase-design",
  "to-spec",
  "to-tickets",
  "setup-matt-pocock-skills",
  "ask-matt",
];

// These are workflow calls rather than every skill merely named in prose. Keep
// this map explicit: ask-matt deliberately describes optional upstream routes.
const requiredSkillDependencies = new Map([
  ["grill-with-docs", ["grilling", "domain-modeling"]],
]);

// These files configure the selected workflows for Vela. They are source
// material, not generated output, and retain their project-relative paths.
const velaSupportFiles = [
  "docs/agents/issue-tracker.md",
  "docs/agents/domain.md",
];

const optionalSkillNames = new Set([
  "triage",
  "prototype",
  "implement",
  "implement-spec",
  "tdd",
  "code-review",
  "handoff",
  "retro",
  "pr",
  "wayfinder",
  "research",
  "to-questionnaire",
  "wizard",
  "wait-what",
  "teach",
  "writing-for-agents",
  "improve-codebase-architecture",
  "grill-me",
  "diagnosing-bugs",
]);

async function exists(path) {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = resolve(directory, entry.name);
      if (entry.isDirectory()) return markdownFiles(entryPath);
      return extname(entry.name).toLowerCase() === ".md" ? [entryPath] : [];
    }),
  );

  return files.flat();
}

function toRepositoryPath(path) {
  return relative(repositoryRoot, path).split(sep).join("/");
}

function toVirtualPath(path) {
  return `${virtualRoot}/${toRepositoryPath(path)}`;
}

function markdownLinks(contents) {
  return [...contents.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)]
    .map((match) => match[1].trim().replace(/^<|>$/g, ""))
    .filter((link) => !/^(?:[a-z][a-z+.-]*:|#)/i.test(link));
}

function linkedMarkdownPath(fromPath, link) {
  const withoutFragment = link.split(/[?#]/, 1)[0];
  if (!withoutFragment || extname(withoutFragment).toLowerCase() !== ".md") {
    return null;
  }

  const target = resolve(dirname(fromPath), withoutFragment);
  return target.startsWith(`${repositoryRoot}${sep}`) ? target : null;
}

function fence(contents) {
  const longestRun = Math.max(
    0,
    ...[...contents.matchAll(/`+/g)].map((match) => match[0].length),
  );
  return "`".repeat(Math.max(6, longestRun + 1));
}

function fileBlock(path, contents) {
  const marker = fence(contents);
  const ending = contents.endsWith("\n") ? "" : "\n";
  return [
    `<!-- BEGIN VIRTUAL FILE: ${toVirtualPath(path)} -->`,
    `${marker}markdown`,
    `${contents}${ending}${marker}`,
    `<!-- END VIRTUAL FILE: ${toVirtualPath(path)} -->`,
  ].join("\n");
}

async function buildExport() {
  const includedSkills = new Set(selectedSkills);
  const missingDependencies = [];

  for (const [skill, dependencies] of requiredSkillDependencies) {
    if (!includedSkills.has(skill)) continue;
    for (const dependency of dependencies) {
      const entryPoint = resolve(skillsRoot, dependency, "SKILL.md");
      if (await exists(entryPoint)) includedSkills.add(dependency);
      else missingDependencies.push(`${skill} requires ${dependency}`);
    }
  }

  const files = new Set();
  for (const skill of includedSkills) {
    const directory = resolve(skillsRoot, skill);
    if (!(await exists(resolve(directory, "SKILL.md")))) {
      missingDependencies.push(`selected skill ${skill} has no SKILL.md`);
      continue;
    }
    for (const file of await markdownFiles(directory)) files.add(file);
  }

  for (const path of velaSupportFiles) {
    const file = resolve(repositoryRoot, path);
    if (await exists(file)) files.add(file);
    else missingDependencies.push(`Vela support file ${path} is missing`);
  }

  const unresolvedReferences = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const file of [...files]) {
      const contents = await readFile(file, "utf8");
      for (const link of markdownLinks(contents)) {
        const target = linkedMarkdownPath(file, link);
        if (!target) continue;
        if (await exists(target)) {
          if (!files.has(target)) {
            files.add(target);
            changed = true;
          }
        } else {
          unresolvedReferences.add(`${toRepositoryPath(file)} → ${link}`);
        }
      }
    }
  }

  const sortedFiles = [...files].sort((left, right) =>
    toRepositoryPath(left).localeCompare(toRepositoryPath(right)),
  );
  const source = new Map(
    await Promise.all(
      sortedFiles.map(async (file) => [file, await readFile(file, "utf8")]),
    ),
  );
  const optionalSkillsMentioned = [...optionalSkillNames]
    .filter((skill) =>
      [...source.values()].some((contents) =>
        new RegExp(`(?:/|\\\`)${skill.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}(?:\\\`|\\b)`).test(
          contents,
        ),
      ),
    )
    .sort();
  const sourceHash = createHash("sha256")
    .update(
      sortedFiles
        .map((file) => `${toRepositoryPath(file)}\0${source.get(file)}`)
        .join("\0"),
    )
    .digest("hex");

  const indexRows = [...includedSkills]
    .sort()
    .map((skill) => `| \`${skill}\` | \`${virtualRoot}/.agents/skills/${skill}/SKILL.md\` |`)
    .join("\n");
  const requiredEdges = [...requiredSkillDependencies]
    .filter(([skill]) => includedSkills.has(skill))
    .flatMap(([skill, dependencies]) => dependencies.map((dependency) => `- \`${skill}\` → \`${dependency}\``))
    .join("\n");
  const unresolved = [...unresolvedReferences].sort();

  const lines = [
    "# ChatGPT Project skill reference bundle",
    "",
    "Generated by `yarn skills:export-chatgpt`. Do not edit this file directly; update the canonical sources and regenerate.",
    "",
    "This is a path-preserving Markdown bundle for a ChatGPT Project. Every embedded source file retains its logical path below the virtual `/vela` root. Resolve a relative link from the directory of the virtual file containing it; do not assume referenced text has been inlined into its parent.",
    "",
    "## Skill index",
    "",
    "| Skill | Entry point |",
    "| --- | --- |",
    indexRows,
    "",
    "## Dependency report",
    "",
    "Required cross-skill dependencies:",
    "",
    requiredEdges || "- None.",
    "",
    missingDependencies.length
      ? `Missing required dependencies:\n\n${missingDependencies.sort().map((item) => `- ${item}`).join("\n")}`
      : "Missing required dependencies: none.",
    "",
    "The following skills may be mentioned by `ask-matt` as optional upstream routes. They are not required by this selected planning bundle and are intentionally not expanded:",
    "",
    optionalSkillsMentioned.length
      ? optionalSkillsMentioned.map((skill) => `- \`${skill}\``).join("\n")
      : "- None.",
    "",
    unresolved.length
      ? `Unresolved Markdown references (these are runtime/project documents, not omitted skill files):\n\n${unresolved.map((item) => `- \`${item}\``).join("\n")}`
      : "Unresolved Markdown references: none.",
    "",
    "## Included files",
    "",
    `Source manifest SHA-256: \`${sourceHash}\``,
    "",
    ...sortedFiles.flatMap((file) => [fileBlock(file, source.get(file)), ""]),
  ];

  return { contents: `${lines.join("\n")}\n`, missingDependencies, unresolved };
}

const checkOnly = process.argv.includes("--check");
const { contents, missingDependencies, unresolved } = await buildExport();

if (checkOnly) {
  const current = (await exists(outputPath)) ? await readFile(outputPath, "utf8") : null;
  if (current !== contents) {
    console.error("ChatGPT skill export is stale. Run: yarn skills:export-chatgpt");
    process.exitCode = 1;
  }
} else {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, contents);
}

console.log(
  `ChatGPT skill export ${checkOnly ? "checked" : "written"}: ${toRepositoryPath(outputPath)}`,
);
console.log(`Missing required dependencies: ${missingDependencies.length}`);
console.log(`Unresolved Markdown references: ${unresolved.length}`);

if (missingDependencies.length > 0) {
  process.exitCode = 1;
}
