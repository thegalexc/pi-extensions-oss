// project-context -- Read project files at session start, inject into system prompt.
//
// Pi equivalent of Claude's CLAUDE.md auto-loading + session-start hook.
//
// Default files (always checked, skipped if missing):
//   AGENTS.md, .pi/AGENTS.md, CLAUDE.md, Justfile, README.md
//
// Per-project overrides via .pi/context.yaml:
//   files:           # replaces the default list entirely
//     - AGENTS.md
//     - docs/ARCHITECTURE.md
//   extra_files:     # appended to defaults (use when defaults are fine + you want more)
//     - docs/ARCHITECTURE.md
//     - docs/API.md
//   exclude_files:   # removed from defaults (e.g. skip a huge Justfile)
//     - Justfile
//
// If .pi/context.yaml is absent, the default list is used unchanged.
// No dependencies -- uses only Node built-ins.

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Order matters: AGENTS.md first (Pi-native conventions), then CLAUDE.md (bridge),
// then Justfile (commands), then README (overview).
const DEFAULT_CONTEXT_FILES = [
  "AGENTS.md",
  ".pi/AGENTS.md",
  "CLAUDE.md",
  "Justfile",
  "README.md",
];

// Minimal YAML parser for the simple structure we need.
// Handles: top-level keys mapping to arrays of strings.
// Does NOT handle nested objects, multi-line strings, anchors, etc.
function parseSimpleYaml(
  text: string,
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  let currentKey: string | null = null;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trimEnd();
    // Skip comments and blank lines
    if (!line || line.trimStart().startsWith("#")) continue;

    // Top-level key (no leading whitespace, ends with colon)
    const keyMatch = line.match(/^(\w[\w_]*):\s*$/);
    if (keyMatch) {
      currentKey = keyMatch[1];
      result[currentKey] = [];
      continue;
    }

    // List item under current key
    if (currentKey) {
      const itemMatch = line.match(/^\s+-\s+(.+)$/);
      if (itemMatch) {
        result[currentKey].push(itemMatch[1].trim());
      }
    }
  }
  return result;
}

function resolveFileList(cwd: string): string[] {
  const configPath = path.join(cwd, ".pi", "context.yaml");

  if (!fs.existsSync(configPath)) {
    return [...DEFAULT_CONTEXT_FILES];
  }

  const raw = fs.readFileSync(configPath, "utf-8");
  const config = parseSimpleYaml(raw);

  // "files" replaces defaults entirely
  if (config.files && config.files.length > 0) {
    return config.files;
  }

  // Start with defaults, apply exclude then extra
  let files = [...DEFAULT_CONTEXT_FILES];

  if (config.exclude_files) {
    const excludeSet = new Set(config.exclude_files);
    files = files.filter((f) => !excludeSet.has(f));
  }

  if (config.extra_files) {
    for (const f of config.extra_files) {
      if (!files.includes(f)) {
        files.push(f);
      }
    }
  }

  return files;
}

export default function (pi: ExtensionAPI) {
  let context = "";
  let loadedFiles: string[] = [];

  pi.on("session_start", async (_event, ctx) => {
    const contextFiles = resolveFileList(ctx.cwd);
    const parts: string[] = [];
    const seen = new Set<string>();
    loadedFiles = [];

    for (const file of contextFiles) {
      const p = path.join(ctx.cwd, file);
      // Deduplicate by resolved path (AGENTS.md and .pi/AGENTS.md might overlap)
      const resolved = path.resolve(p);
      if (seen.has(resolved)) continue;
      if (fs.existsSync(p)) {
        seen.add(resolved);
        loadedFiles.push(file);
        parts.push(`## ${file}\n\n${fs.readFileSync(p, "utf-8")}`);
      }
    }
    context = parts.join("\n\n");
  });

  pi.on("before_agent_start", async (event) => {
    if (!context) return;

    // Build a preamble that describes what was actually loaded
    const fileList = loadedFiles.map((f) => `- ${f}`).join("\n");
    const preamble =
      "# Project Context\n\n" +
      "The following project files were loaded automatically. " +
      "Review them and follow any conventions they define.\n\n" +
      "Files loaded:\n" +
      fileList +
      "\n";

    return {
      systemPrompt:
        event.systemPrompt + "\n\n" + preamble + "\n" + context,
    };
  });
}
