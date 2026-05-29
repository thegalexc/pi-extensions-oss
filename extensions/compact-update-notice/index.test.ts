import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

async function loadModule() {
	return import(new URL("./index.ts", import.meta.url).href);
}

async function loadVersionCheckModule() {
	const piEntryHref = import.meta.resolve("@earendil-works/pi-coding-agent");
	const piEntryPath = fileURLToPath(piEntryHref);
	const versionCheckPath = path.join(path.dirname(piEntryPath), "utils", "version-check.js");
	return import(pathToFileURL(versionCheckPath).href);
}

async function startExtensionSession() {
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

	return { prototype, calls };
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

test("assertPatchableInteractiveModePrototype rejects upstream prototype drift", async () => {
	const { assertPatchableInteractiveModePrototype } = await loadModule();

	assert.throws(() => {
		assertPatchableInteractiveModePrototype({
			showPackageUpdateNotification() {},
		});
	}, /showNewVersionNotification/);

	assert.throws(() => {
		assertPatchableInteractiveModePrototype({
			showNewVersionNotification() {},
		});
	}, /showPackageUpdateNotification/);
});

test("patched InteractiveMode version notice writes a footer status instead of rendering the boxed notice", async () => {
	const { prototype, calls } = await startExtensionSession();

	assert.deepEqual(calls, [{ key: "10-update-available", text: undefined }]);

	const boxedNoticeSentinel = {
		chatContainer: {
			addChild() {
				throw new Error("boxed notice render should not run");
			},
		},
		ui: {
			requestRender() {
				throw new Error("boxed notice requestRender should not run");
			},
		},
	};

	(prototype.showNewVersionNotification as (this: unknown, release: string | { version?: string; packageName?: string; note?: string }) => void).call(
		boxedNoticeSentinel,
		"0.70.3",
	);
	assert.deepEqual(calls.at(-1), {
		key: "10-update-available",
		text: "[mdHeading]* 0.70.3 Available",
	});

	(prototype.showNewVersionNotification as (this: unknown, release: string | { version?: string; packageName?: string; note?: string }) => void).call(
		boxedNoticeSentinel,
		{
			version: "v0.70.4",
			packageName: "@earendil-works/pi-coding-agent",
			note: "Heads up",
		},
	);
	assert.deepEqual(calls.at(-1), {
		key: "10-update-available",
		text: "[mdHeading]* 0.70.4 Available",
	});

	(prototype.showPackageUpdateNotification as (packages: string[]) => void)(["a", "b"]);
	assert.deepEqual(calls.at(-1), {
		key: "10-update-available",
		text: "[mdHeading]* 0.70.4 Available, 2 pkg updates",
	});
});

test("patched InteractiveMode version notice ignores malformed release objects without crashing", async () => {
	const { prototype, calls } = await startExtensionSession();

	(prototype.showNewVersionNotification as (release: { note: string }) => void)({ note: "Heads up" });
	assert.deepEqual(calls.at(-1), {
		key: "10-update-available",
		text: undefined,
	});
});

test("patched notice accepts a live Pi release payload from version-check", async () => {
	const { checkForNewPiVersion } = await loadVersionCheckModule();
	const { prototype, calls } = await startExtensionSession();

	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async () => ({
		ok: true,
		async json() {
			return {
				version: "v9.9.9",
				packageName: "@earendil-works/pi-coding-agent",
				note: "Fresh release",
			};
		},
	})) as unknown as typeof fetch;

	try {
		const release = await checkForNewPiVersion("0.1.0");
		assert.deepEqual(release, {
			version: "v9.9.9",
			packageName: "@earendil-works/pi-coding-agent",
			note: "Fresh release",
		});
		(prototype.showNewVersionNotification as (release: unknown) => void)(release);
		assert.deepEqual(calls.at(-1), {
			key: "10-update-available",
			text: "[mdHeading]* 9.9.9 Available",
		});
	} finally {
		globalThis.fetch = originalFetch;
	}
});
