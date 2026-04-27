import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import { openSessionContextBrowser } from "./session-context-browser.js";
import {
	SESSION_CONTEXT_CUSTOM_TYPE,
	formatImportedSessionContext,
	parseSessionContextArgs,
	rankSessionChunks,
	resolveTargetSession,
	extractSessionChunks,
	type SessionContextMetadata,
} from "./session-context-core.js";

export * from "./session-context-core.js";

export const MIN_SESSION_CONTEXT_WIDTH = 72;

export async function runSessionContextCommand(pi: ExtensionAPI, ctx: ExtensionCommandContext, args: string): Promise<void> {
	if (!ctx.hasUI) {
		ctx.ui.notify("/session-context requires interactive mode", "error");
		return;
	}
	if (!ctx.isIdle()) {
		ctx.ui.notify("Wait for the current response to finish before importing session context", "warning");
		return;
	}

	const terminalWidth = process.stdout.columns ?? 0;
	if (terminalWidth > 0 && terminalWidth < MIN_SESSION_CONTEXT_WIDTH) {
		ctx.ui.notify(`/session-context needs a terminal at least ${MIN_SESSION_CONTEXT_WIDTH} columns wide. Current width: ${terminalWidth}.`, "warning");
		return;
	}

	const parsed = parseSessionContextArgs(args);
	if ("error" in parsed) {
		ctx.ui.notify(parsed.error, "warning");
		return;
	}

	const currentSessionId = ctx.sessionManager.getSessionId()?.toLowerCase();
	if (currentSessionId === parsed.sessionId) {
		ctx.ui.notify("Target session matches the current session", "warning");
		return;
	}

	ctx.ui.setStatus("session-context", "Resolving session context...");
	try {
		const targetInfo = await resolveTargetSession(parsed.sessionId);
		if (!targetInfo) {
			ctx.ui.notify(`Session not found: ${parsed.sessionId}`, "error");
			return;
		}

		const targetSession = SessionManager.open(targetInfo.path);
		const entries = targetSession.getEntries();
		const chunks = rankSessionChunks(extractSessionChunks(entries), parsed.query);
		if (chunks.length === 0) {
			ctx.ui.notify("No useful context candidates found in target session", "warning");
			return;
		}

		const metadata: SessionContextMetadata = {
			sessionId: targetInfo.id,
			sessionPath: targetInfo.path,
			cwd: targetInfo.cwd,
			name: targetInfo.name,
			modifiedAt: targetInfo.modified,
			query: parsed.query,
			crossCwd: targetInfo.cwd !== ctx.cwd,
		};

		const selected = await openSessionContextBrowser(ctx, metadata, chunks);
		if (!selected || selected.length === 0) {
			ctx.ui.notify("Session context import cancelled", "info");
			return;
		}

		const formatted = formatImportedSessionContext(metadata, selected);
		if (formatted.tooLarge) {
			ctx.ui.notify("Selected excerpts are too large to import together. Deselect some items and try again.", "warning");
			return;
		}

		pi.sendMessage(
			{
				customType: SESSION_CONTEXT_CUSTOM_TYPE,
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
		ctx.ui.setStatus("session-context", undefined);
	}
}
