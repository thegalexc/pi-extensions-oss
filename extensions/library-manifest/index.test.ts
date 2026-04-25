import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "library-manifest-"));
const home = join(root, "home");
mkdirSync(home, { recursive: true });
const originalHome = process.env.HOME;
process.env.HOME = home;

function fixturePath(...parts: string[]) {
	return join(root, ...parts);
}

function resetDir(path: string) {
	rmSync(path, { recursive: true, force: true });
	mkdirSync(path, { recursive: true });
}

async function importModule(relativePath: string) {
	const url = new URL(`${relativePath}?t=${Date.now()}-${Math.random()}`, import.meta.url);
	return import(url.href);
}

async function loadManifestModule() {
	return importModule("./manifest.ts");
}

async function loadCheckModule() {
	return importModule("./check.ts");
}

async function loadFormatModule() {
	return importModule("./format.ts");
}

function makeRepo(name: string) {
	const repo = fixturePath(name);
	resetDir(repo);
	mkdirSync(join(repo, ".pi"), { recursive: true });
	return repo;
}

function writeManifest(repo: string, content: string) {
	writeFileSync(join(repo, ".pi", "library-manifest.yaml"), content, "utf-8");
}

function writeFile(path: string, content = "x") {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content, "utf-8");
}

function makeApi() {
	const handlers = new Map<string, Function>();
	const commands = new Map<string, any>();
	return {
		handlers,
		commands,
		api: {
			on(name: string, handler: Function) {
				handlers.set(name, handler);
			},
			registerCommand(name: string, command: any) {
				commands.set(name, command);
			},
		},
	};
}

test("parseLibraryManifest parses refs, strips quotes, and deduplicates duplicates", async () => {
	const { parseLibraryManifest } = await loadManifestModule();
	const parsed = parseLibraryManifest(
		[
			"required:",
			"  - prompt:implement",
			"  - 'prompt:implement'",
			"  - \"skill:wrapup\"",
			"  - agent:rho-sci-reviewer",
		].join("\n"),
	);

	assert.deepEqual(
		parsed.refs.map((ref: any) => ref.raw),
		["prompt:implement", "skill:wrapup", "agent:rho-sci-reviewer"],
	);
	assert.equal(parsed.issues.length, 0);
});

test("parseLibraryManifest reports invalid refs and missing required list", async () => {
	const { parseLibraryManifest } = await loadManifestModule();
	const parsed = parseLibraryManifest(
		[
			"extra:",
			"  - noop",
			"required:",
			"  - wrong",
			"  - theme:dark",
			"  bad: value",
		].join("\n"),
	);

	assert.equal(parsed.refs.length, 0);
	assert.equal(parsed.issues.length, 3);
	assert.match(parsed.issues[0].message, /invalid ref/);
	assert.match(parsed.issues[1].message, /unknown ref type/);
	assert.match(parsed.issues[2].message, /unsupported manifest entry/);

	const noRequired = parseLibraryManifest("skills:\n  - skill:wrapup\n");
	assert.equal(noRequired.issues.length, 1);
	assert.match(noRequired.issues[0].message, /required: list/);
});

test("checkLibraryManifest classifies local, global, collision, legacy, and missing states", async () => {
	const repo = makeRepo("repo-check");
	writeManifest(
		repo,
		[
			"required:",
			"  - prompt:implement",
			"  - skill:wrapup",
			"  - agent:legacy-reviewer",
			"  - agent:rho-sci-reviewer",
			"  - skill:file-operations",
		].join("\n"),
	);
	writeFile(join(repo, ".agents", "prompts", "implement.md"));
	writeFile(join(home, ".agents", "skills", "wrapup", "SKILL.md"));
	writeFile(join(home, ".pi", "agent", "agents", "legacy-reviewer", "AGENT.md"));
	writeFile(join(repo, ".pi", "agents", "rho-sci-reviewer", "AGENT.md"));

	const { loadLibraryManifest } = await loadManifestModule();
	const { checkLibraryManifest } = await loadCheckModule();
	const manifest = loadLibraryManifest(repo)!;
	const result = checkLibraryManifest(repo, manifest);
	const statuses = new Map(result.results.map((item: any) => [item.ref.raw, item.status]));

	assert.equal(statuses.get("prompt:implement"), "installed-local");
	assert.equal(statuses.get("skill:wrapup"), "installed-global");
	assert.equal(statuses.get("agent:legacy-reviewer"), "legacy-present");
	assert.equal(statuses.get("agent:rho-sci-reviewer"), "repo-authored-collision");
	assert.equal(statuses.get("skill:file-operations"), "missing");
});

test("format helpers produce compact startup warning and issue-oriented report", async () => {
	const repo = makeRepo("repo-format");
	writeManifest(repo, "required:\n  - skill:wrapup\n  - prompt:implement\n");
	const { loadLibraryManifest } = await loadManifestModule();
	const { checkLibraryManifest } = await loadCheckModule();
	const { formatStartupWarning, formatCheckReport } = await loadFormatModule();
	const result = checkLibraryManifest(repo, loadLibraryManifest(repo)!);

	assert.match(formatStartupWarning(result), /Library manifest issues/);
	const report = formatCheckReport(result, repo);
	assert.match(report, /Missing/);
	assert.match(report, /\/library-hydrate/);
	assert.match(report, /python3 .*library\.py hydrate/);
	assert.doesNotMatch(report, /Status\n- healthy/);
});

test("formatCheckReport shows healthy status and omits fix section when there are no issues", async () => {
	const repo = makeRepo("repo-format-healthy");
	writeManifest(repo, "required:\n  - prompt:implement\n  - skill:wrapup\n");
	writeFile(join(repo, ".agents", "prompts", "implement.md"));
	writeFile(join(repo, ".agents", "skills", "wrapup", "SKILL.md"));
	const { loadLibraryManifest } = await loadManifestModule();
	const { checkLibraryManifest } = await loadCheckModule();
	const { formatCheckReport } = await loadFormatModule();
	const result = checkLibraryManifest(repo, loadLibraryManifest(repo)!);
	const report = formatCheckReport(result, repo);

	assert.match(report, /Status\n- healthy/);
	assert.doesNotMatch(report, /\nFix\n/);
});

test("getIssueCount reflects missing refs, collisions, legacy installs, and manifest issues", async () => {
	const repo = makeRepo("repo-issue-count");
	writeManifest(repo, "required:\n  - skill:file-operations\n  - agent:legacy-reviewer\n  - prompt:implement\n");
	writeFile(join(repo, ".pi", "prompts", "implement.md"));
	writeFile(join(home, ".pi", "agent", "agents", "legacy-reviewer", "AGENT.md"));
	const { loadLibraryManifest } = await loadManifestModule();
	const { checkLibraryManifest, getIssueCount } = await loadCheckModule();
	const { formatStartupWarning } = await loadFormatModule();
	const result = checkLibraryManifest(repo, loadLibraryManifest(repo)!);

	assert.equal(getIssueCount(result), 3);
	assert.match(formatStartupWarning(result), /repo-owned collision/);
	assert.match(formatStartupWarning(result), /legacy install/);
	assert.match(formatStartupWarning(result), /missing/);
});

test("runLibraryHydrate succeeds when the Library CLI is present", async () => {
	const repo = makeRepo("repo-library-hydrate-success");
	writeManifest(repo, "required:\n  - skill:wrapup\n");
	writeFile(
		join(home, ".agents", "skills", "library", "bin", "library.py"),
		[
			"import sys",
			"from pathlib import Path",
			"project = Path(sys.argv[-1])",
			"target = project / '.agents' / 'skills' / 'wrapup' / 'SKILL.md'",
			"target.parent.mkdir(parents=True, exist_ok=True)",
			"target.write_text('wrapup', encoding='utf-8')",
			"print('Hydration complete: wrapup')",
		].join("\n"),
	);
	const { runLibraryHydrate } = await importModule("./hydrate.ts");
	const result = await runLibraryHydrate(repo);

	assert.equal(result.ok, true);
	assert.match(result.stdout, /Hydration complete/);
	assert.equal(result.command[0], "python3");
	assert.equal(result.command[2], "hydrate");
	assert.equal(result.command[4], repo);
	assert.equal(result.stderr, "");
	assert.equal(Boolean(result.command.length >= 5), true);
});

test("runLibraryHydrate reports missing CLI and process failures", async () => {
	const repo = makeRepo("repo-library-hydrate-failure");
	writeManifest(repo, "required:\n  - skill:wrapup\n");
	const cliPath = join(home, ".agents", "skills", "library", "bin", "library.py");
	rmSync(cliPath, { force: true });
	const { runLibraryHydrate } = await importModule("./hydrate.ts");

	const missingCli = await runLibraryHydrate(repo);
	assert.equal(missingCli.ok, false);
	assert.equal(missingCli.error, "missing_cli");
	assert.match(missingCli.stderr, /Library CLI not found/);

	writeFile(
		cliPath,
		[
			"import sys",
			"print('boom', file=sys.stderr)",
			"raise SystemExit(1)",
		].join("\n"),
	);
	const failed = await runLibraryHydrate(repo);
	assert.equal(failed.ok, false);
	assert.equal(failed.error, "hydrate_failed");
	assert.match(failed.stderr, /boom/);
});

process.on("exit", () => {
	if (originalHome == null) delete process.env.HOME;
	else process.env.HOME = originalHome;
	rmSync(root, { recursive: true, force: true });
});
