import { test } from "node:test";
import assert from "node:assert/strict";

async function loadModule() {
	return import(new URL("./index.ts", import.meta.url).href);
}

test("formatCompactUpdateStatus keeps the startup notice compact", async () => {
	const { formatCompactUpdateStatus } = await loadModule();
	const status = formatCompactUpdateStatus(
		{
			setStatus() {},
			theme: { fg: (color: string, text: string) => `[${color}]${text}` },
		},
		{ version: "0.70.3", packageCount: 2 },
	);

	assert.equal(status, "[mdHeading]* 0.70.3 Available, 2 pkg updates");
});

test("patched InteractiveMode version notice writes a footer status instead of rendering the boxed notice", async () => {
	const { default: compactUpdateNoticeExtension, installCompactUpdatePatch, loadInteractiveModePrototype } = await loadModule();
	await installCompactUpdatePatch();
	const prototype = await loadInteractiveModePrototype();

	const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<void>>();
	compactUpdateNoticeExtension({
		on(event: string, handler: (event: unknown, ctx: unknown) => Promise<void>) {
			handlers.set(event, handler as (event: unknown, ctx: unknown) => Promise<void>);
		},
	} as any);

	const calls: Array<{ key: string; text: string | undefined }> = [];
	await handlers.get("session_start")?.({}, {
		hasUI: true,
		ui: {
			setStatus(key: string, text: string | undefined) {
				calls.push({ key, text });
			},
			theme: {
				fg(color: string, text: string) {
					return `[${color}]${text}`;
				},
			},
		},
	});

	assert.deepEqual(calls, [{ key: "update-available", text: undefined }]);

	(prototype.showNewVersionNotification as (version: string) => void)("0.70.3");
	assert.deepEqual(calls.at(-1), {
		key: "update-available",
		text: "[mdHeading]* 0.70.3 Available",
	});

	(prototype.showPackageUpdateNotification as (packages: string[]) => void)(["a", "b"]);
	assert.deepEqual(calls.at(-1), {
		key: "update-available",
		text: "[mdHeading]* 0.70.3 Available, 2 pkg updates",
	});
});
