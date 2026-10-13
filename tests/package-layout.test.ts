import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const extensionsDir = fileURLToPath(new URL("../extensions", import.meta.url));

test("top-level extension discovery excludes test files", () => {
	const testFiles = readdirSync(extensionsDir).filter((name) => name.endsWith(".test.ts"));
	assert.deepEqual(testFiles, []);
});
