import { test } from "node:test";
import assert from "node:assert/strict";
import { createJiti } from "jiti";

test("library-manifest entrypoint loads through jiti and exports an extension factory", async () => {
	const jiti = createJiti(import.meta.url, { moduleCache: false });
	const mod = (await jiti.import("./index.ts")) as { default?: unknown };
	assert.equal(typeof mod.default, "function");
});
