import type { ExtensionCommandContext, Theme } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";
import type { Component } from "@mariozechner/pi-tui";
import { MAX_SELECTED_CHUNKS, type SessionChunk, type SessionContextMetadata } from "./session-context-types.js";

const MAX_VISIBLE_ITEMS = 9;
const MAX_PREVIEW_LINES = 10;

export async function openSessionContextBrowser(
	ctx: ExtensionCommandContext,
	metadata: SessionContextMetadata,
	chunks: SessionChunk[],
): Promise<SessionChunk[] | undefined> {
	return ctx.ui.custom<SessionChunk[] | undefined>(
		(tui, theme, _kb, done) => new SessionContextBrowserComponent(tui, theme, metadata, chunks, done),
		{
			overlay: true,
			overlayOptions: {
				width: "88%",
				maxHeight: "84%",
				anchor: "center",
				margin: 1,
				visible: (termWidth) => termWidth >= 72,
			},
		},
	);
}

class SessionContextBrowserComponent implements Component {
	private selectedIndex = 0;
	private selectedIds = new Set<string>();
	private cachedWidth?: number;
	private cachedLines?: string[];
	private statusMessage = "";

	constructor(
		private tui: { requestRender(): void; terminal: { rows: number } },
		private theme: Theme,
		private metadata: SessionContextMetadata,
		private chunks: SessionChunk[],
		private done: (result: SessionChunk[] | undefined) => void,
	) {}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape)) {
			this.done(undefined);
			return;
		}
		if (matchesKey(data, Key.up)) {
			this.selectedIndex = this.selectedIndex === 0 ? this.chunks.length - 1 : this.selectedIndex - 1;
			this.clearStatus();
			this.requestRender();
			return;
		}
		if (matchesKey(data, Key.down)) {
			this.selectedIndex = this.selectedIndex === this.chunks.length - 1 ? 0 : this.selectedIndex + 1;
			this.clearStatus();
			this.requestRender();
			return;
		}
		if (matchesKey(data, Key.space)) {
			this.toggleSelection(this.chunks[this.selectedIndex]);
			this.requestRender();
			return;
		}
		if (data === "a") {
			for (const chunk of this.chunks) {
				if (this.selectedIds.size >= MAX_SELECTED_CHUNKS) break;
				this.selectedIds.add(chunk.id);
			}
			this.setStatus(`Selected up to ${MAX_SELECTED_CHUNKS} excerpts`);
			this.requestRender();
			return;
		}
		if (data === "n") {
			this.selectedIds.clear();
			this.setStatus("Cleared selection");
			this.requestRender();
			return;
		}
		if (data === "g") {
			this.selectedIndex = 0;
			this.clearStatus();
			this.requestRender();
			return;
		}
		if (data === "G") {
			this.selectedIndex = this.chunks.length - 1;
			this.clearStatus();
			this.requestRender();
			return;
		}
		if (matchesKey(data, Key.enter)) {
			const selected = this.getConfirmedSelection();
			if (selected.length === 0) {
				this.setStatus("No excerpts available to import");
				this.requestRender();
				return;
			}
			this.done(selected);
		}
	}

	render(width: number): string[] {
		if (this.cachedWidth === width && this.cachedLines) return this.cachedLines;
		const lines: string[] = [];
		const innerWidth = Math.max(20, width - 4);
		const bodyHeight = this.targetBodyHeight();
		const border = this.theme.fg("border", `╭${"─".repeat(innerWidth)}╮`);
		const bottom = this.theme.fg("border", `╰${"─".repeat(innerWidth)}╯`);
		lines.push(border);
		lines.push(this.row(innerWidth, this.theme.fg("accent", this.theme.bold("Session Context Browser"))));
		lines.push(this.row(innerWidth, `${this.theme.fg("dim", "Session:")} ${this.metadata.sessionId}`));
		lines.push(this.row(innerWidth, `${this.theme.fg("dim", "CWD:")} ${this.metadata.cwd}`));
		if (this.metadata.query) lines.push(this.row(innerWidth, `${this.theme.fg("dim", "Query:")} ${this.metadata.query}`));
		if (this.metadata.crossCwd) {
			lines.push(this.row(innerWidth, this.theme.fg("warning", "Source session cwd differs from the current cwd")));
		}
		lines.push(
			...this.rowsWrapped(
				innerWidth,
				this.theme.fg("dim", "Use space to mark excerpts. Enter imports marked excerpts, or the focused item if none are marked."),
			),
		);
		lines.push(this.row(innerWidth, this.theme.fg("dim", `Selection limit: ${MAX_SELECTED_CHUNKS}`)));
		lines.push(this.row(innerWidth, ""));

		const start = Math.max(0, Math.min(this.selectedIndex - Math.floor(MAX_VISIBLE_ITEMS / 2), this.chunks.length - MAX_VISIBLE_ITEMS));
		const end = Math.min(this.chunks.length, start + MAX_VISIBLE_ITEMS);
		for (let index = start; index < end; index++) {
			const chunk = this.chunks[index]!;
			const selected = this.selectedIds.has(chunk.id);
			const focused = index === this.selectedIndex;
			const marker = selected ? this.theme.fg("success", "[x]") : this.theme.fg("dim", "[ ]");
			const prefix = focused ? this.theme.fg("accent", "→") : " ";
			const label = `${prefix} ${marker} ${this.chunkTypeLabel(chunk.type)} ${chunk.title}`;
			lines.push(this.row(innerWidth, focused ? this.theme.fg("accent", truncateToWidth(label, innerWidth)) : truncateToWidth(label, innerWidth)));
		}
		if (start > 0 || end < this.chunks.length) {
			lines.push(this.row(innerWidth, this.theme.fg("dim", `Showing ${start + 1}-${end} of ${this.chunks.length}`)));
		}

		const focusedChunk = this.chunks[this.selectedIndex];
		lines.push(this.row(innerWidth, ""));
		lines.push(this.row(innerWidth, this.theme.fg("accent", this.theme.bold("Preview"))));
		if (focusedChunk) {
			lines.push(this.row(innerWidth, `${this.theme.fg("dim", "Type:")} ${focusedChunk.type}`));
			lines.push(this.row(innerWidth, `${this.theme.fg("dim", "Score:")} ${focusedChunk.score}`));
			for (const previewLine of this.previewLines(focusedChunk.fullText, innerWidth)) {
				lines.push(this.row(innerWidth, previewLine));
			}
		}
		if (this.statusMessage) {
			lines.push(this.row(innerWidth, ""));
			lines.push(this.row(innerWidth, this.theme.fg("warning", this.statusMessage)));
		}
		lines.push(this.row(innerWidth, ""));
		lines.push(this.row(innerWidth, this.theme.fg("dim", "↑↓ move • space select • enter import • a select limit • n clear • esc cancel")));

		while (lines.length < bodyHeight + 1) {
			lines.push(this.row(innerWidth, ""));
		}
		lines.push(bottom);

		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}

	private row(innerWidth: number, content: string): string {
		const visible = visibleWidth(content);
		const padding = " ".repeat(Math.max(0, innerWidth - visible));
		return this.theme.fg("border", "│") + content + padding + this.theme.fg("border", "│");
	}

	private rowsWrapped(innerWidth: number, content: string): string[] {
		return wrapTextWithAnsi(content, Math.max(10, innerWidth)).map((line) => this.row(innerWidth, line));
	}

	private previewLines(text: string, width: number): string[] {
		return wrapTextWithAnsi(text, Math.max(10, width)).slice(0, MAX_PREVIEW_LINES);
	}

	private targetBodyHeight(): number {
		const rows = this.tui.terminal.rows;
		return Math.max(20, Math.min(rows - 6, Math.floor(rows * 0.76)));
	}

	private chunkTypeLabel(type: SessionChunk["type"]): string {
		switch (type) {
			case "branch_summary":
				return "[branch]";
			case "compaction_summary":
				return "[compact]";
			case "label_checkpoint":
				return "[label]";
			case "user_goal":
				return "[user]";
			case "assistant_plan":
				return "[plan]";
			case "assistant_conclusion":
				return "[answer]";
			case "tool_finding":
				return "[tool]";
		}
	}

	private toggleSelection(chunk: SessionChunk | undefined): void {
		if (!chunk) return;
		if (this.selectedIds.has(chunk.id)) {
			this.selectedIds.delete(chunk.id);
			this.setStatus(`Unselected ${chunk.title}`);
			return;
		}
		if (this.selectedIds.size >= MAX_SELECTED_CHUNKS) {
			this.setStatus(`Selection limit reached: ${MAX_SELECTED_CHUNKS}`);
			return;
		}
		this.selectedIds.add(chunk.id);
		this.setStatus(`Selected ${chunk.title}`);
	}

	private getConfirmedSelection(): SessionChunk[] {
		if (this.selectedIds.size === 0) {
			const focused = this.chunks[this.selectedIndex];
			return focused ? [focused] : [];
		}
		return this.chunks.filter((chunk) => this.selectedIds.has(chunk.id));
	}

	private setStatus(message: string): void {
		this.statusMessage = message;
	}

	private clearStatus(): void {
		this.statusMessage = "";
	}

	private requestRender(): void {
		this.invalidate();
		this.tui.requestRender();
	}
}
