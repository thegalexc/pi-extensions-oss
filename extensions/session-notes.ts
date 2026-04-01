/**
 * Session Notes Extension
 *
 * Maintains a running, append-only note log for the session. Every pin action
 * appends a new note with a globally monotonic id (continues from previous
 * sessions). The Ctrl+Alt+K picker shows an interleaved timeline of notes and
 * session messages in reverse chronological order.
 *
 * Notes are permanent - content can be cleared but the entry is never removed.
 * Global nextId persists across sessions in ~/.pi/agent/session-notes.json.
 *
 * Shortcuts:
 *   Ctrl+Alt+E    - Edit active note directly (no picker)
 *   Ctrl+Alt+K    - Open interleaved timeline picker
 *   Ctrl+Alt+H    - Toggle panel visibility (hide/show)
 *   Ctrl+Alt+X    - Clear active note content (note entry preserved)
 *   Ctrl+Alt+U    - Scroll up   (letter form, reliable)
 *   Ctrl+Alt+D    - Scroll down (letter form, reliable)
 *   Ctrl+Alt+Up   - Scroll up   (arrow form, terminal-dependent)
 *   Ctrl+Alt+Down - Scroll down (arrow form, terminal-dependent)
 *   Ctrl+Alt+=    - Expand panel height (+2 lines, max 40)
 *   Ctrl+Alt+-    - Contract panel height (-2 lines, min 3)
 *
 * Command:
 *   /pin - Open the note timeline picker (same as Ctrl+Alt+K)
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import type { Theme } from "@mariozechner/pi-coding-agent";
import { Container, getKeybindings, Text, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

const EXT_ID = "session-notes";
const DEFAULT_MAX_LINES = 8;
const MIN_LINES = 3;
const MAX_LINES = 40;
const HEIGHT_STEP = 2;

// ─── Types ────────────────────────────────────────────────────────────────────

type NoteSource = "user" | "agent";

type PickerAction =
	| { type: "new_blank" }
	| { type: "pick_note"; note: PinNote }
	| { type: "session_msg"; content: string };

interface TimelineRow {
	kind: "new_blank" | "note" | "msg";
	icon: string;
	iconColor: string;
	marker: string;
	preview: string;
	action: PickerAction;
}

interface PinNote {
	id: number;          // session-local sequential id
	content: string;     // may be empty string if cleared
	source: NoteSource;  // who originated the note
	createdAt: number;   // insertion timestamp for timeline ordering
}

interface PinState {
	notes: PinNote[];        // append-only, oldest first
	activeId: number | null; // which note is shown in the widget
	visible: boolean;
	maxLines: number;
	nextId: number;          // next id to assign within this session
}

const defaultState = (): PinState => ({
	notes: [],
	activeId: null,
	visible: false,
	maxLines: DEFAULT_MAX_LINES,
	nextId: 1,
});

// ─── Widget component ─────────────────────────────────────────────────────────

class PinWidgetComponent {
	constructor(
		private theme: Theme,
		private content: string,
		private noteId: number,
		private totalNotes: number,
		private noteSource: NoteSource,
		private scrollOffset: number,
		private maxLines: number,
	) {}

	render(width: number): string[] {
		const { theme, noteId, totalNotes, noteSource, scrollOffset, maxLines } = this;
		const displayContent = this.content || "(cleared)";
		const contentLines = displayContent.split("\n");
		const total = contentLines.length;
		const maxScroll = Math.max(0, total - maxLines);
		const scroll = Math.min(scrollOffset, maxScroll);

		const canUp = scroll > 0;
		const canDown = scroll < maxScroll;
		const overflows = total > maxLines;

		const bg = (text: string): string => {
			const pad = " ".repeat(Math.max(0, width - visibleWidth(text)));
			return theme.bg("customMessageBg", text + pad);
		};

		const lines: string[] = [];

		// ── Header ────────────────────────────────────────────────────────────────
		const edgePart = theme.fg("accent", "▌▌");
		const titlePart = theme.fg("accent", theme.bold(" ✎ Session Notes "));
		const sourceLabel = noteSource === "agent" ? "agent" : "user";
		const notePart = theme.fg("muted", `[${sourceLabel} ${noteId}/${totalNotes}] `);
		const scrollPosRaw = overflows
			? ` ${canUp ? "▲" : "·"} ${scroll + 1}–${Math.min(scroll + maxLines, total)}/${total} ${canDown ? "▼" : "·"} `
			: "";
		const scrollPosPart = scrollPosRaw ? theme.fg("warning", scrollPosRaw) : "";
		const hintRaw = " ^⌥↑U/↓D:scroll  ^⌥+/-:size  ^⌥E:edit  ^⌥K/pin:notes  ^⌥X:clear  ^⌥H:hide ";
		const hintPart = theme.fg("dim", hintRaw);

		const fixedWidth = visibleWidth(edgePart) + visibleWidth(titlePart) + visibleWidth(notePart)
			+ visibleWidth(scrollPosPart) + visibleWidth(hintPart);
		const fillLen = Math.max(1, width - fixedWidth);
		const fillPart = theme.fg("borderAccent", "─".repeat(fillLen));

		lines.push(bg(truncateToWidth(edgePart + titlePart + notePart + fillPart + scrollPosPart + hintPart, width)));
		lines.push(bg(theme.fg("accent", "▔".repeat(width))));

		// ── Content ───────────────────────────────────────────────────────────────
		for (const l of contentLines.slice(scroll, scroll + maxLines)) {
			lines.push(bg(truncateToWidth(l, width)));
		}

		if (canDown) {
			const rem = total - (scroll + maxLines);
			lines.push(bg(theme.fg("dim", truncateToWidth(`  ↓ ${rem} more line${rem === 1 ? "" : "s"}  (^⌥D to scroll)`, width))));
		}

		return lines;
	}

	invalidate(): void {}
}

class TimelinePickerComponent {
	private selectedIndex = 0;

	constructor(
		private rows: TimelineRow[],
		private maxVisible: number,
		private theme: Theme,
		private done: (value: string | null) => void,
	) {}

	render(width: number): string[] {
		const lines: string[] = [];
		const startIndex = Math.max(0, Math.min(this.selectedIndex - Math.floor(this.maxVisible / 2), this.rows.length - this.maxVisible));
		const endIndex = Math.min(startIndex + this.maxVisible, this.rows.length);

		for (let i = startIndex; i < endIndex; i++) {
			const row = this.rows[i];
			if (!row) continue;
			const selected = i === this.selectedIndex;
			const arrow = selected ? this.theme.fg("accent", "→") : " ";
			const icon = this.theme.fg(row.iconColor as any, row.icon);
			const marker = selected && row.kind !== "new_blank"
				? this.theme.fg("warning", row.marker || "●")
				: " ";
			const prefix = `${arrow} ${icon} ${marker} `;
			const textWidth = Math.max(1, width - visibleWidth(prefix));
			const text = selected
				? this.theme.fg("accent", truncateToWidth(row.preview, textWidth))
				: row.kind === "msg"
					? this.theme.fg("muted", truncateToWidth(row.preview, textWidth))
					: truncateToWidth(row.preview, textWidth);
			lines.push(prefix + text);
		}

		if (startIndex > 0 || endIndex < this.rows.length) {
			lines.push(this.theme.fg("dim", `  (${this.selectedIndex + 1}/${this.rows.length})`));
		}
		return lines;
	}

	handleInput(data: Buffer | string): void {
		const kb = getKeybindings();
		if (kb.matches(data as any, "tui.select.up")) {
			this.selectedIndex = this.selectedIndex === 0 ? this.rows.length - 1 : this.selectedIndex - 1;
		} else if (kb.matches(data as any, "tui.select.down")) {
			this.selectedIndex = this.selectedIndex === this.rows.length - 1 ? 0 : this.selectedIndex + 1;
		} else if (kb.matches(data as any, "tui.select.confirm")) {
			this.done(String(this.selectedIndex));
		} else if (kb.matches(data as any, "tui.select.cancel")) {
			this.done(null);
		}
	}

	invalidate(): void {}
}

// ─── Extension ────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	let pin: PinState = defaultState();
	let scrollOffset = 0;

	// ── Helpers ─────────────────────────────────────────────────────────────────

	const getActiveNote = (): PinNote | null =>
		pin.activeId == null ? null : (pin.notes.find(n => n.id === pin.activeId) ?? null);

	const normalizeNote = (note: Omit<PinNote, "source" | "createdAt"> & { source?: NoteSource; createdAt?: number }): PinNote => ({
		...note,
		source: note.source === "agent" ? "agent" : "user",
		createdAt: typeof note.createdAt === "number" ? note.createdAt : 0,
	});

	const noteIcon = (note: PinNote): string => note.source === "agent" ? "✦" : "☺";
	const toMillis = (value: unknown): number => {
		if (typeof value === "number") return value;
		if (typeof value === "string") {
			const parsed = Date.parse(value);
			return Number.isNaN(parsed) ? 0 : parsed;
		}
		return 0;
	};

	/** Append new note, make it active. */
	const addNote = (content: string, source: NoteSource, ctx: ExtensionContext) => {
		const note: PinNote = { id: pin.nextId++, content, source, createdAt: Date.now() };
		pin.notes.push(note);
		pin.activeId = note.id;
		pin.visible = true;
		scrollOffset = 0;
		persist(ctx);
	};

	/** Make an existing note the active display without creating a new entry. */
	const setActive = (id: number, ctx: ExtensionContext) => {
		pin.activeId = id;
		pin.visible = true;
		scrollOffset = 0;
		persist(ctx);
	};

	/** Edit a specific note by id in place. Content may be empty (cleared). */
	const editNoteById = (id: number, content: string, ctx: ExtensionContext) => {
		const note = pin.notes.find(n => n.id === id);
		if (!note) return;
		note.content = content;
		pin.activeId = id;
		pin.visible = true;
		scrollOffset = 0;
		persist(ctx);
	};

	// ── Persistence ──────────────────────────────────────────────────────────────

	const persist = (ctx: ExtensionContext) => {
		pi.appendEntry(EXT_ID, {
			notes: pin.notes,
			activeId: pin.activeId,
			visible: pin.visible,
			maxLines: pin.maxLines,
			nextId: pin.nextId,
		});
		renderWidget(ctx);
	};

	const reconstructState = (ctx: ExtensionContext) => {
		pin = defaultState();
		scrollOffset = 0;
		const firstSeenAt = new Map<number, number>();

		for (const entry of ctx.sessionManager.getBranch()) {
			const e = entry as unknown as { type: string; customType?: string; data?: any; timestamp?: string | number };
			if (e.type !== "custom" || e.customType !== EXT_ID || e.data == null) continue;
			const d = e.data;
			if (Array.isArray(d.notes)) {
				const entryTime = toMillis(e.timestamp) || Date.now();
				const notes = (d.notes as Array<Omit<PinNote, "source" | "createdAt"> & { source?: NoteSource; createdAt?: number }>).map(normalizeNote)
					.map((note) => {
						if (!firstSeenAt.has(note.id)) firstSeenAt.set(note.id, entryTime);
						return {
							...note,
							createdAt: note.createdAt || firstSeenAt.get(note.id) || entryTime,
						};
					});
				const maxId = notes.reduce((m, note) => Math.max(m, note.id), 0);
				pin = {
					notes,
					activeId: d.activeId ?? null,
					visible: d.visible ?? false,
					maxLines: d.maxLines ?? DEFAULT_MAX_LINES,
					nextId: maxId + 1,
				};
			}
		}

		renderWidget(ctx);
	};

	// ── Widget ───────────────────────────────────────────────────────────────────

	const renderWidget = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		const active = getActiveNote();
		if (!pin.visible || !active) {
			ctx.ui.setWidget(EXT_ID, undefined);
			ctx.ui.setStatus(EXT_ID, undefined);
			return;
		}
		const { content, id, source } = active;
		const total = pin.notes.length;
		const scroll = scrollOffset;
		const maxL = pin.maxLines;
		ctx.ui.setWidget(EXT_ID, (_tui, theme) =>
			new PinWidgetComponent(theme, content, id, total, source, scroll, maxL),
		);
		ctx.ui.setStatus(EXT_ID, ctx.ui.theme.fg("accent", source === "agent" ? "✦" : "☺"));
	};

	// ── Branch entry helpers ──────────────────────────────────────────────────────

	const extractAssistantText = (entry: unknown): string | null => {
		const e = entry as { type?: string; message?: { role?: string; content?: unknown[] } };
		if (e.type !== "message" || e.message?.role !== "assistant") return null;
		const text = (e.message?.content ?? [])
			.filter((b): b is { type: "text"; text: string } => (b as { type: string }).type === "text")
			.map(b => b.text).join("\n").trim();
		return text || null;
	};

	/**
	 * Walk the branch entries once and build an interleaved chronological timeline
	 * of assistant messages and note creation events. Notes appear at the position
	 * they were first pinned, showing their current (possibly edited) content.
	 */
	const buildTimeline = (branch: unknown[]) => {
		type TItem =
			| { kind: "note"; note: PinNote; at: number }
			| { kind: "msg"; content: string; preview: string; at: number };

		const items: TItem[] = [];

		for (const entry of branch) {
			const e = entry as any;

			if (e.type === "message" && e.message?.role === "assistant") {
				const text = extractAssistantText(entry);
				if (text) {
					const preview = text.slice(0, 70).replace(/\n/g, " ") + (text.length > 70 ? "…" : "");
					items.push({ kind: "msg", content: text, preview, at: toMillis(e.timestamp) });
				}
			}
		}

		for (const note of pin.notes) {
			items.push({ kind: "note", note, at: note.createdAt });
		}

		return items
			.sort((a, b) => b.at - a.at || (b.kind === "note" && a.kind === "msg" ? 1 : -1));
	};

	// ── Session lifecycle ────────────────────────────────────────────────────────

	pi.on("session_start", async (_e, ctx) => reconstructState(ctx));
	pi.on("session_switch", async (_e, ctx) => reconstructState(ctx));
	pi.on("session_fork", async (_e, ctx) => reconstructState(ctx));
	pi.on("session_tree", async (_e, ctx) => reconstructState(ctx));

	// ── Ctrl+Alt+E: Edit active note directly ────────────────────────────────────

	pi.registerShortcut("ctrl+alt+e", {
		description: "📌 Edit active note directly",
		handler: async (ctx) => {
			const active = getActiveNote();
			if (!active) {
				await openPicker(ctx);
				return;
			}
			ctx.ui.setWidget(EXT_ID, undefined);
			const edited = await ctx.ui.editor(`Note ${active.id} — esc to cancel:`, active.content);
			if (edited == null) {
				renderWidget(ctx);
			} else {
				editNoteById(active.id, edited, ctx);
				ctx.ui.notify(`${noteIcon(active)} Note ${active.id} updated`, "info");
			}
		},
	});

	// ── Picker (shared by Ctrl+Alt+K and /pin) ─────────────────────────────────────

	const openPicker = async (ctx: ExtensionContext) => {
		const branch = ctx.sessionManager.getBranch();
		const timeline = buildTimeline(branch);

		const msgTotal = timeline.filter(i => i.kind === "msg").length; // for picker title only

		const rows: TimelineRow[] = [];
		const push = (row: TimelineRow) => rows.push(row);

		push({
			kind: "new_blank",
			icon: "✎",
			iconColor: "accent",
			marker: "",
			preview: "New blank note",
			action: { type: "new_blank" },
		});

		const totalItems = timeline.length;
		let posNum = totalItems;
		for (const item of timeline) {
			if (item.kind === "note") {
				const preview = item.note.content.trim()
					? `${posNum--}. ${item.note.content.slice(0, 60).replace(/\n/g, " ")}${item.note.content.length > 60 ? "…" : ""}`
					: `${posNum--}. (cleared)`;
				push({
					kind: "note",
					icon: noteIcon(item.note),
					iconColor: item.note.source === "agent" ? "warning" : "borderAccent",
					marker: item.note.id === pin.activeId ? "●" : "",
					preview,
					action: { type: "pick_note", note: item.note },
				});
			} else {
				push({
					kind: "msg",
					icon: "✦",
					iconColor: "warning",
					marker: "",
					preview: `${posNum--}. ${item.preview}`,
					action: { type: "session_msg", content: item.content },
				});
			}
		}

		const noteCount = pin.notes.length;
		const selected = await ctx.ui.custom<string | null>(
			(tui, theme, _kb, done) => {
				const container = new Container();
				container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
				container.addChild(new Text(
					theme.fg("accent", theme.bold(`✎ Session Notes — ${noteCount} note${noteCount === 1 ? "" : "s"}, ${msgTotal} session message${msgTotal === 1 ? "" : "s"}`)),
					1, 0,
				));
				container.addChild(new Text("", 1, 0));
				container.addChild(new Text("", 1, 0));
				const list = new TimelinePickerComponent(rows, Math.min(rows.length, 14), theme, done);
				container.addChild(list);
				container.addChild(new Text("", 1, 0));
				container.addChild(new Text("", 1, 0));
				container.addChild(new Text(
					theme.fg("dim", "↑↓ navigate  •  [pin] enter: pin or edit  •  esc: view"),
					1, 0,
				));
				container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
				return {
					render: (w) => container.render(w),
					invalidate: () => container.invalidate(),
					handleInput: (data) => { list.handleInput(data); tui.requestRender(); },
				};
			},
			{ overlay: true },
		);

		if (selected == null) return;
		const action = rows[parseInt(selected)]?.action;
		if (!action) return;

		if (action.type === "new_blank") {
			// ctx.ui.input() is an overlay dialog -- no ctrl+g involved, works in zellij
			const text = await ctx.ui.input("New note:");
			if (!text?.trim()) { renderWidget(ctx); return; }
			addNote(text, "user", ctx);
			ctx.ui.notify(`☺ Note ${pin.activeId} added (${pin.notes.length} total)`, "info");

		} else if (action.type === "pick_note") {
			// ctx.ui.editor() is pre-seeded with existing content -- ESC = view only
			// Note: ctrl+g (external editor) won't work in zellij, but direct typing works fine
			ctx.ui.setWidget(EXT_ID, undefined);
			const edited = await ctx.ui.editor(
				`Note ${action.note.id} — esc to view without editing:`,
				action.note.content,
			);
			if (edited == null) {
				setActive(action.note.id, ctx);
			} else {
				editNoteById(action.note.id, edited, ctx);
				ctx.ui.notify(`${noteIcon(action.note)} Note ${action.note.id} updated`, "info");
			}

		} else if (action.type === "session_msg") {
			addNote(action.content, "agent", ctx);
			ctx.ui.notify(`✦ Note ${pin.activeId} pinned (${pin.notes.length} total)`, "info");
		}
	};

	pi.registerShortcut("ctrl+alt+k", {
		description: "✎ Open session timeline picker",
		handler: async (ctx) => openPicker(ctx),
	});

	// ── Ctrl+Alt+H: Toggle visibility ────────────────────────────────────────────

	pi.registerShortcut("ctrl+alt+h", {
		description: "✎ Toggle panel visibility",
		handler: async (ctx) => {
			if (pin.notes.length === 0) {
				ctx.ui.notify("No notes yet -- open the picker with Ctrl+Alt+K", "info");
				return;
			}
			pin.visible = !pin.visible;
			persist(ctx);
			ctx.ui.notify(pin.visible ? "✎ Panel visible" : "Panel hidden", "info");
		},
	});

	// ── Ctrl+Alt+X: Clear active note content (note entry preserved) ──────────────

	pi.registerShortcut("ctrl+alt+x", {
		description: "✎ Clear active note content (note entry stays)",
		handler: async (ctx) => {
			const active = getActiveNote();
			if (!active) { ctx.ui.notify("No active note", "info"); return; }
			if (!active.content) { ctx.ui.notify(`Note ${active.id} is already cleared`, "info"); return; }
			editNoteById(active.id, "", ctx);
			ctx.ui.notify(`${noteIcon(active)} Note ${active.id} cleared (entry preserved)`, "info");
		},
	});

	// ── Scroll ────────────────────────────────────────────────────────────────────

	const scrollUp = (ctx: ExtensionContext) => {
		if (!pin.visible || !getActiveNote() || scrollOffset <= 0) return;
		scrollOffset--;
		renderWidget(ctx);
	};
	const scrollDown = (ctx: ExtensionContext) => {
		const note = getActiveNote();
		if (!pin.visible || !note) return;
		const maxScroll = Math.max(0, (note.content || "(cleared)").split("\n").length - pin.maxLines);
		if (scrollOffset >= maxScroll) return;
		scrollOffset++;
		renderWidget(ctx);
	};

	pi.registerShortcut("ctrl+alt+u", { description: "✎ Scroll up", handler: async (ctx) => scrollUp(ctx) });
	pi.registerShortcut("ctrl+alt+d", { description: "✎ Scroll down", handler: async (ctx) => scrollDown(ctx) });
	pi.registerShortcut("ctrl+alt+up", { description: "✎ Scroll up (arrow)", handler: async (ctx) => scrollUp(ctx) });
	pi.registerShortcut("ctrl+alt+down", { description: "✎ Scroll down (arrow)", handler: async (ctx) => scrollDown(ctx) });

	// ── Height ────────────────────────────────────────────────────────────────────

	pi.registerShortcut("ctrl+alt+=", {
		description: "✎ Expand height",
		handler: async (ctx) => {
			if (pin.maxLines >= MAX_LINES) { ctx.ui.notify(`Max height (${MAX_LINES} lines)`, "info"); return; }
			pin.maxLines = Math.min(MAX_LINES, pin.maxLines + HEIGHT_STEP);
			persist(ctx);
		},
	});
	pi.registerShortcut("ctrl+alt+-", {
		description: "✎ Contract height",
		handler: async (ctx) => {
			if (pin.maxLines <= MIN_LINES) { ctx.ui.notify(`Min height (${MIN_LINES} lines)`, "info"); return; }
			pin.maxLines = Math.max(MIN_LINES, pin.maxLines - HEIGHT_STEP);
			persist(ctx);
		},
	});

	// ── /pin: Opens the picker (same as Ctrl+Alt+K) ──────────────────────────────

	pi.registerCommand("pin", {
		description: "✎ Open the note timeline picker",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) { ctx.ui.notify("/pin requires interactive mode", "error"); return; }
			await openPicker(ctx);
		},
	});
}
