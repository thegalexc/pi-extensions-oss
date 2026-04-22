import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function loadModule() {
	return import(new URL("./agents-prompts-discover.ts", import.meta.url).href);
}

test("discoverAgentsPromptPaths returns project and global .agents prompt paths when present", async () => {
	const root = mkdtempSync(join(tmpdir(), "agents-prompts-discover-"));
	const cwd = join(root, "project");
	const home = join(root, "home");
	mkdirSync(join(cwd, ".agents", "prompts"), { recursive: true });
	mkdirSync(join(home, ".agents", "prompts"), { recursive: true });
	const originalHome = process.env.HOME;
	process.env.HOME = home;

	try {
		const { discoverAgentsPromptPaths } = await loadModule();
		assert.deepEqual(discoverAgentsPromptPaths(cwd), [
			join(cwd, ".agents", "prompts"),
			join(home, ".agents", "prompts"),
		]);
	} finally {
		if (originalHome == null) delete process.env.HOME;
		else process.env.HOME = originalHome;
		rmSync(root, { recursive: true, force: true });
	}
});

test("discoverAgentsPromptPaths skips missing paths and deduplicates project/global overlap", async () => {
	const root = mkdtempSync(join(tmpdir(), "agents-prompts-discover-"));
	const home = join(root, "home");
	mkdirSync(home, { recursive: true });
	const originalHome = process.env.HOME;
	process.env.HOME = home;

	try {
		const { discoverAgentsPromptPaths } = await loadModule();
		assert.deepEqual(discoverAgentsPromptPaths(home), []);

		mkdirSync(join(home, ".agents", "prompts"), { recursive: true });
		assert.deepEqual(discoverAgentsPromptPaths(home), [join(home, ".agents", "prompts")]);
	} finally {
		if (originalHome == null) delete process.env.HOME;
		else process.env.HOME = originalHome;
		rmSync(root, { recursive: true, force: true });
	}
});
