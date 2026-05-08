import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { checkLibraryManifest, getIssueCount } from "./check.js";
import { formatCheckReport, formatHydrateResult, formatStartupWarning } from "./format.js";
import { runLibraryHydrate } from "./hydrate.js";
import { loadLibraryManifest } from "./manifest.js";

export default function libraryManifestExtension(pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		const result = getManifestCheck(ctx.cwd);
		if (!result) return;
		if (!ctx.hasUI) return;
		if (getIssueCount(result) === 0) return;
		ctx.ui.notify(formatStartupWarning(result), "warning");
	});

	pi.registerCommand("library-check", {
		description: "Check this repo's library manifest for missing installed artifacts",
		handler: async (_args, ctx) => {
			const result = getManifestCheck(ctx.cwd);
			if (!result) {
				emitMessage(ctx, "No .pi/library-manifest.yaml found in this repo.", "info");
				return;
			}
			emitMessage(ctx, formatCheckReport(result, ctx.cwd), getIssueCount(result) > 0 ? "warning" : "info");
		},
	});

	pi.registerCommand("library-hydrate", {
		description: "Install this repo's required library artifacts into .agents and reload Pi",
		handler: async (_args, ctx) => {
			const manifest = loadLibraryManifest(ctx.cwd);
			if (!manifest) {
				emitMessage(ctx, "No .pi/library-manifest.yaml found in this repo.", "info");
				return;
			}

			emitMessage(ctx, `Hydrating library artifacts for ${ctx.cwd} ...`, "info");
			const result = await runLibraryHydrate(ctx.cwd);
			if (!result.ok) {
				emitMessage(ctx, `Library hydrate failed\n${formatHydrateResult(result.stdout, result.stderr)}`, "error");
				return;
			}

			emitMessage(ctx, `Library hydrate succeeded\n${formatHydrateResult(result.stdout, result.stderr)}`, "info");
			await ctx.reload();
			return;
		},
	});
}

function getManifestCheck(cwd: string) {
	const manifest = loadLibraryManifest(cwd);
	if (!manifest) return null;
	return checkLibraryManifest(cwd, manifest);
}

function emitMessage(
	ctx: {
		hasUI: boolean;
		ui: { notify(message: string, level?: "info" | "warning" | "error") : void };
	},
	message: string,
	level: "info" | "warning" | "error",
) {
	if (ctx.hasUI) {
		ctx.ui.notify(message, level);
		return;
	}
	if (level === "error") console.error(message);
		else console.log(message);
}
