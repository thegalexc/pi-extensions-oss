/**
 * Safe Screenshot Extension
 *
 * Intercepts the built-in `screenshot` tool to prevent sessions from crashing
 * when a full-page capture exceeds Claude's 8000px image height limit.
 *
 * When fullPage is not explicitly false, mutates the call to use viewport-only
 * mode with a safe default height (900px). The tool result is annotated with a
 * note explaining the constraint and how to capture specific page sections.
 *
 * Zero config — works globally with no per-project setup.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const MAX_SAFE_HEIGHT = 7500;
const DEFAULT_VIEWPORT_HEIGHT = 900;

export default function (pi: ExtensionAPI) {
	let clamped = new Set<string>();

	pi.on("tool_call", async (event, _ctx) => {
		if (event.toolName !== "screenshot") return;

		const input = event.input as Record<string, unknown>;

		// Only intercept when fullPage is not explicitly false
		if (input.fullPage === false) return;

		// Clamp: disable fullPage, set safe viewport height
		input.fullPage = false;
		if (input.height === undefined || (typeof input.height === "number" && input.height > MAX_SAFE_HEIGHT)) {
			input.height = DEFAULT_VIEWPORT_HEIGHT;
		}

		clamped.add(event.toolCallId);
	});

	pi.on("tool_result", async (event, _ctx) => {
		if (event.toolName !== "screenshot") return;
		if (!clamped.delete(event.toolCallId)) return;

		const note = [
			"[safe-screenshot] Full-page capture was disabled to avoid exceeding Claude's 8000px image height limit.",
			"The screenshot was taken at viewport size instead (default 900px tall).",
			"To capture a specific section, call screenshot with fullPage=false and set height to your desired viewport size.",
		].join(" ");

		return {
			content: [
				...(Array.isArray(event.content) ? event.content : []),
				{ type: "text" as const, text: note },
			],
		};
	});
}
