import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { openPluckBrowser } from "./pluck-browser.js";
import {
	PLUCK_CUSTOM_TYPE,
	formatImportedPluck,
	parsePluckArgs,
	rankPluckChunks,
	resolvePluckTargetSession,
	extractPluckChunks,
	type PluckMetadata,
} from "./pluck-core.js";

export * from "./pluck-core.js";

export const MIN_PLUCK_WIDTH = 72;

export async function runPluckCommand(pi: ExtensionAPI, ctx: ExtensionCommandContext, args: string): Promise<void> {
	if (!ctx.hasUI) {
		ctx.ui.notify("/pluck requires interactive mode", "error");
		return;
	}
	if (!ctx.isIdle()) {
		ctx.ui.notify("Wait for the current response to finish before running /pluck", "warning");
		return;
	}

	const terminalWidth = process.stdout.columns ?? 0;
	if (terminalWidth > 0 && terminalWidth < MIN_PLUCK_WIDTH) {
		ctx.ui.notify(`/pluck needs a terminal at least ${MIN_PLUCK_WIDTH} columns wide. Current width: ${terminalWidth}.`, "warning");
		return;
	}

	const parsed = parsePluckArgs(args);
	if ("error" in parsed) {
		ctx.ui.notify(parsed.error, "warning");
		return;
	}

	const currentSessionId = ctx.sessionManager.getSessionId()?.toLowerCase();
	if (currentSessionId === parsed.sessionId) {
		ctx.ui.notify("Target session matches the current session", "warning");
		return;
	}

	ctx.ui.setStatus("pluck", "Resolving plucked context...");
	try {
		const targetInfo = await resolvePluckTargetSession(parsed.sessionId);
		if (!targetInfo) {
			ctx.ui.notify(`Session not found: ${parsed.sessionId}`, "error");
			return;
		}

		const targetSession = SessionManager.open(targetInfo.path);
		const entries = targetSession.getEntries();
		const chunks = rankPluckChunks(extractPluckChunks(entries), parsed.query);
		if (chunks.length === 0) {
			ctx.ui.notify("No useful context candidates found in target session", "warning");
			return;
		}

		const metadata: PluckMetadata = {
			sessionId: targetInfo.id,
			sessionPath: targetInfo.path,
			cwd: targetInfo.cwd,
			name: targetInfo.name,
			modifiedAt: targetInfo.modified,
			query: parsed.query,
			crossCwd: targetInfo.cwd !== ctx.cwd,
		};

		const selected = await openPluckBrowser(ctx, metadata, chunks);
		if (!selected || selected.length === 0) {
			ctx.ui.notify("Pluck import cancelled", "info");
			return;
		}

		const formatted = formatImportedPluck(metadata, selected);
		if (formatted.tooLarge) {
			ctx.ui.notify("Selected excerpts are too large to import together. Deselect some items and try again.", "warning");
			return;
		}

		pi.sendMessage(
			{
				customType: PLUCK_CUSTOM_TYPE,
				content: formatted.content,
				display: true,
				details: {
					sessionId: metadata.sessionId,
					query: metadata.query,
					chunkIds: formatted.usedChunks.map((chunk) => chunk.id),
					truncated: formatted.truncated,
				},
			},
			{ deliverAs: "nextTurn" },
		);
		ctx.ui.notify(
			`Imported ${formatted.usedChunks.length} context ${formatted.usedChunks.length === 1 ? "excerpt" : "excerpts"} from ${metadata.sessionId}${formatted.truncated ? " with truncation" : ""}`,
			"info",
		);
	} finally {
		ctx.ui.setStatus("pluck", undefined);
	}
}
