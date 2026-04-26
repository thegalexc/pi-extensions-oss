import type { SessionNotesPanelSnapshot } from "../extensions/session-notes";

export const SESSION_NOTES_PANEL_WIDTH = 154;

export const sessionNotesPanelFixture = {
	content: [
		"Ship the first asset pipeline inside pi-extensions-oss.",
		"",
		"V1 scope:",
		"- fixture-driven session-notes panel screenshot",
		"- canonical output path stays stable",
		"- deterministic local regeneration via pnpm",
		"",
		"Later: picker states, session-context, then GIF-worthy flows.",
	].join("\n"),
	noteId: 4,
	totalNotes: 7,
	noteSource: "agent",
	scrollOffset: 0,
	maxLines: 6,
} satisfies SessionNotesPanelSnapshot;
