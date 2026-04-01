/**
 * Safe Screenshot Extension
 *
 * Intercepts the built-in `screenshot` tool to prevent sessions from crashing
 * when a capture exceeds Claude's 8000px image dimension limit.
 *
 * Two protection layers:
 *   1. fullPage guard -- when fullPage is not explicitly false, mutates the call
 *      to use viewport-only mode (fullPage: false) so the image height is bounded.
 *   2. Height guard -- when height exceeds MAX_SAFE_HEIGHT (regardless of fullPage),
 *      clamps it to DEFAULT_VIEWPORT_HEIGHT. A viewport-only capture with an
 *      oversized height would still exceed the limit.
 *
 * When either guard fires, the tool result is annotated with a note explaining
 * what was clamped and how to capture specific sections.
 *
 * Zero config -- works globally with no per-project setup.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const MAX_SAFE_HEIGHT = 7500;
const DEFAULT_VIEWPORT_HEIGHT = 900;

export default function (pi: ExtensionAPI) {
	// Maps toolCallId -> the effective height used after clamping.
	// Using a Map (not Set) so the tool_result handler can report the
	// actual height in its note rather than always citing the default.
	const clamped = new Map<string, number>();

	pi.on("tool_call", async (event, _ctx) => {
		if (event.toolName !== "screenshot") return;

		const input = event.input as Record<string, unknown>;

		// Coerce height to a number early. LLM-generated inputs occasionally
		// send numeric params as strings; a string "9000" would bypass the
		// numeric comparison below and slip through unclamped.
		const rawHeight = input.height;
		const numericHeight =
			typeof rawHeight === "number"
				? rawHeight
				: typeof rawHeight === "string" && rawHeight !== ""
					? Number(rawHeight)
					: undefined;

		const isFullPageExplicitlyFalse = input.fullPage === false;
		const heightTooTall =
			numericHeight !== undefined &&
			!Number.isNaN(numericHeight) &&
			numericHeight > MAX_SAFE_HEIGHT;

		// If fullPage is explicitly false and height is within safe bounds,
		// the call is safe -- pass through untouched.
		if (isFullPageExplicitlyFalse && !heightTooTall) return;

		// At least one guard needs to fire. Apply both fixes in a single pass
		// so the note accurately reflects everything that was changed.
		let effectiveHeight: number;

		if (heightTooTall || numericHeight === undefined) {
			effectiveHeight = DEFAULT_VIEWPORT_HEIGHT;
			input.height = DEFAULT_VIEWPORT_HEIGHT;
		} else {
			// numericHeight is safe; normalize to a number in case it arrived
			// as a string, and preserve the value.
			effectiveHeight = numericHeight;
			input.height = numericHeight;
		}

		if (!isFullPageExplicitlyFalse) {
			input.fullPage = false;
		}

		clamped.set(event.toolCallId, effectiveHeight);
	});

	pi.on("tool_result", async (event, _ctx) => {
		if (event.toolName !== "screenshot") return;

		const effectiveHeight = clamped.get(event.toolCallId);
		if (effectiveHeight === undefined) return;
		clamped.delete(event.toolCallId);

		const note = [
			"[safe-screenshot] The screenshot call was modified to avoid exceeding Claude's 8000px image dimension limit.",
			`Captured at viewport size (height ${effectiveHeight}px) instead of full-page.`,
			"To capture a specific section, navigate to a URL anchor (#section) or call screenshot with fullPage=false and your desired height.",
		].join(" ");

		return {
			content: [
				...(Array.isArray(event.content) ? event.content : []),
				{ type: "text" as const, text: note },
			],
		};
	});

	// Clean up any orphaned toolCallIds when sessions end or switch, so the
	// Map doesn't accumulate entries from calls that never produced a result.
	const clearClamped = () => clamped.clear();
	pi.on("session_end" as any, clearClamped);
	pi.on("session_switch" as any, clearClamped);
	pi.on("session_tree" as any, clearClamped);
}
