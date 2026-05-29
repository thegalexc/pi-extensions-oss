import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type StatusUI = {
	setStatus(key: string, text: string | undefined): void;
	theme?: {
		fg(color: string, text: string): string;
	};
};

type UpdateState = {
	version?: string;
	packageCount?: number;
};

type ReleaseLike = {
	version?: unknown;
	packageName?: unknown;
	note?: unknown;
};

const STATUS_KEY = "10-update-available";
const PATCH_KEY = Symbol.for("pi-extensions-oss.compact-update-notice.patched");

let activeUi: StatusUI | undefined;
let updateState: UpdateState = {};

export function formatCompactUpdateStatus(ui: StatusUI, state: UpdateState): string | undefined {
	const parts: string[] = [];
	if (state.version) parts.push(`${state.version} Available`);
	if (state.packageCount && state.packageCount > 0) {
		parts.push(`${state.packageCount} pkg update${state.packageCount === 1 ? "" : "s"}`);
	}
	if (parts.length === 0) return undefined;
	const text = `* ${parts.join(", ")}`;
	return ui.theme?.fg ? ui.theme.fg("mdHeading", text) : text;
}

function renderStatus(): void {
	if (!activeUi) return;
	activeUi.setStatus(STATUS_KEY, formatCompactUpdateStatus(activeUi, updateState));
}

function resetStatus(ui?: StatusUI): void {
	updateState = {};
	if (ui) ui.setStatus(STATUS_KEY, undefined);
}

function normalizeVersion(version: string): string {
	return version.trim().replace(/^v/i, "");
}

function extractVersion(release: string | ReleaseLike): string | undefined {
	if (typeof release === "string") return normalizeVersion(release);
	if (release && typeof release.version === "string") {
		return normalizeVersion(release.version);
	}
	return undefined;
}

async function resolvePiEntryHref(): Promise<string> {
	for (const specifier of [
		"@earendil-works/pi-coding-agent",
		"@mariozechner/pi-coding-agent",
	]) {
		try {
			return import.meta.resolve(specifier);
		} catch {
			// Try the next known package scope.
		}
	}
	throw new Error("Unable to resolve the Pi coding agent package entrypoint");
}

export async function loadInteractiveModePrototype(): Promise<Record<PropertyKey, unknown>> {
	const piEntryHref = await resolvePiEntryHref();
	const piEntryPath = fileURLToPath(piEntryHref);
	const interactiveModePath = path.join(path.dirname(piEntryPath), "modes", "interactive", "interactive-mode.js");
	const interactiveModeHref = pathToFileURL(interactiveModePath).href;
	const mod = (await import(interactiveModeHref)) as {
		InteractiveMode?: { prototype?: Record<PropertyKey, unknown> };
	};
	const prototype = mod.InteractiveMode?.prototype;
	if (!prototype) {
		throw new Error("InteractiveMode prototype could not be resolved");
	}
	return prototype;
}

export function assertPatchableInteractiveModePrototype(prototype: Record<PropertyKey, unknown>): void {
	if (typeof prototype.showNewVersionNotification !== "function") {
		throw new Error("InteractiveMode.showNewVersionNotification is unavailable");
	}
	if (typeof prototype.showPackageUpdateNotification !== "function") {
		throw new Error("InteractiveMode.showPackageUpdateNotification is unavailable");
	}
}

export async function installCompactUpdatePatch(): Promise<void> {
	const prototype = await loadInteractiveModePrototype();
	if (prototype[PATCH_KEY]) return;
	assertPatchableInteractiveModePrototype(prototype);

	prototype.showNewVersionNotification = function (release: string | ReleaseLike) {
		updateState.version = extractVersion(release);
		renderStatus();
	};

	prototype.showPackageUpdateNotification = function (packages: string[]) {
		updateState.packageCount = packages.length > 0 ? packages.length : undefined;
		renderStatus();
	};

	prototype[PATCH_KEY] = true;
}

try {
	await installCompactUpdatePatch();
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	console.warn(`[compact-update-notice] Failed to install patch: ${message}`);
}

export default function compactUpdateNoticeExtension(pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		activeUi = ctx.ui as StatusUI;
		resetStatus(activeUi);
	});

	pi.on("session_shutdown", async () => {
		resetStatus(activeUi);
		activeUi = undefined;
	});
}
