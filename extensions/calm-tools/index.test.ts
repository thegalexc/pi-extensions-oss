import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("calm-tools overrides rendering without re-registering built-in tools", async () => {
	const { default: calmTools } = await import(new URL("./index.ts", import.meta.url).href);
	const home = mkdtempSync(join(tmpdir(), "calm-tools-"));
	const previousHome = process.env.HOME;
	mkdirSync(join(home, ".pi", "agent"), { recursive: true });
	writeFileSync(
		join(home, ".pi", "agent", "settings.json"),
		JSON.stringify({ calmTools: { enabled: true, statusLine: false, compactTools: ["read", "edit"] } }),
	);

	let resolver: ((toolName: string, next: () => unknown) => unknown) | undefined;
	const pi = {
		registerTool() {
			assert.fail("calm-tools must not re-register built-in tools");
		},
		registerToolRenderer(value: typeof resolver) {
			resolver = value;
		},
	} as any;

	try {
		process.env.HOME = home;
		calmTools(pi);
		assert.ok(resolver?.("read", () => undefined));
		assert.equal(resolver?.("edit", () => undefined), undefined);
	} finally {
		process.env.HOME = previousHome;
		rmSync(home, { recursive: true, force: true });
	}
});
