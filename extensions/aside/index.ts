import { complete, type AssistantMessage, type Model, type UserMessage } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@mariozechner/pi-coding-agent";
import {
	CURSOR_MARKER,
	type EditorTheme,
	Key,
	matchesKey,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
	type Focusable,
	type OverlayHandle,
	type TUI,
} from "@mariozechner/pi-tui";
import { buildAsideCapsule, serializeAsideCapsule, type AsideCapsule } from "./capsule.js";
import { createAsideEditor, initializeAsideEditor, resolveAsidePreviewPrompt, type AsideEditor } from "./editor.js";
import { formatAsidePromotion, formatElapsed, type AsideResult } from "./format.js";
import { describeAsideModelSelection, resolveAsideModel } from "./model.js";

type AsideStatus = "compose" | "running" | "result" | "failure";

type OverlayResult = { kind: "closed" | "inserted" | "replaced" };

type AsideOverlayState = {
	status: AsideStatus;
	draft: string;
	submittedQuestion?: string;
	capsule: AsideCapsule;
	result?: AsideResult;
	error?: string;
	notice?: string;
	modelBadge: string;
};

const ASIDE_OVERLAY_OPTIONS = {
	anchor: "center" as const,
	width: "90%" as const,
	minWidth: 60,
	maxHeight: "90%" as const,
	margin: 1,
};
const ASIDE_OUTPUT_MAX_TOKENS = 896;
const ASIDE_TIMEOUT_MS = 45_000;
const ASIDE_SYSTEM_PROMPT = [
	"You answer temporary side questions from a bounded session capsule.",
	"Use only the provided capsule and do not assume access to tools, files, or hidden transcript history.",
	"If the question clearly requires repository inspection, shell commands, or edits, say this aside has no tool access and recommend /fork.",
	"Keep the answer concise, direct, and useful.",
].join(" ");
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

interface ActiveAsideController {
	close(kind: OverlayResult["kind"]): void;
}

let activeAside: ActiveAsideController | null = null;

export default function asideExtension(pi: ExtensionAPI) {
	pi.registerCommand("aside", {
		description: "Open a temporary single-shot side question overlay",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/aside requires interactive UI support.", "error");
				return;
			}
			if (!ctx.isIdle()) {
				ctx.ui.notify("Wait for the current response to finish before using /aside.", "warning");
				return;
			}

			activeAside?.close("replaced");
			const initialDraft = args.trim();
			const initialCapsule = buildAsideCapsule({
				cwd: ctx.cwd,
				editorText: ctx.ui.getEditorText(),
				branch: ctx.sessionManager.getBranch(),
				prompt: initialDraft,
			});
			let overlayHandle: OverlayHandle | undefined;
			let component: AsideOverlayComponent | undefined;
			let settled = false;

			const settle = (kind: OverlayResult["kind"], done: (value: OverlayResult) => void) => {
				if (settled) return;
				settled = true;
				if (activeAside?.close === closeActiveAside) {
					activeAside = null;
				}
				done({ kind });
			};

			const closeActiveAside = (kind: OverlayResult["kind"]) => {
				component?.externalClose(kind);
				overlayHandle?.hide();
			};

			activeAside = { close: closeActiveAside };

			await ctx.ui.custom<OverlayResult>(
				(tui, theme, _keybindings, done) => {
					component = new AsideOverlayComponent({
						tui,
						theme,
						ctx,
						initialDraft,
						initialCapsule,
						initialModelBadge: describeAsideModelSelection({
							overrideId: process.env.PI_ASIDE_MODEL,
							currentModel: ctx.model,
						}),
						onDone: (kind) => settle(kind, done),
					});
					return component;
				},
				{
					overlay: true,
					overlayOptions: ASIDE_OVERLAY_OPTIONS,
					onHandle: (handle) => {
						overlayHandle = handle;
					},
				},
			);
		},
	});
}

export class AsideOverlayComponent implements Focusable {
	focused = false;

	private readonly props: {
		tui: TUI;
		theme: Theme;
		ctx: ExtensionCommandContext;
		initialDraft: string;
		initialCapsule: AsideCapsule;
		initialModelBadge: string;
		onDone: (kind: OverlayResult["kind"]) => void;
		createEditor?: (tui: TUI, theme: EditorTheme) => AsideEditor;
	};
	private editor: AsideEditor;
	private spinnerIndex = 0;
	private spinnerTimer: NodeJS.Timeout | undefined;
	private activeAbort: AbortController | undefined;
	private cancelRequested = false;
	private timeoutTriggered = false;
	private done = false;
	private scrollOffset = 0;
	private state: AsideOverlayState;

	constructor(props: {
		tui: TUI;
		theme: Theme;
		ctx: ExtensionCommandContext;
		initialDraft: string;
		initialCapsule: AsideCapsule;
		initialModelBadge: string;
		onDone: (kind: OverlayResult["kind"]) => void;
		createEditor?: (tui: TUI, theme: EditorTheme) => AsideEditor;
	}) {
		this.props = props;
		const editorTheme: EditorTheme = {
			borderColor: (text) => props.theme.fg("accent", text),
			selectList: {
				selectedPrefix: (text) => props.theme.fg("accent", text),
				selectedText: (text) => props.theme.fg("accent", text),
				description: (text) => props.theme.fg("muted", text),
				scrollInfo: (text) => props.theme.fg("dim", text),
				noMatch: (text) => props.theme.fg("warning", text),
			},
		};
		this.state = {
			status: "compose",
			draft: props.initialDraft,
			capsule: props.initialCapsule,
			modelBadge: props.initialModelBadge,
		};
		const editor = props.createEditor?.(props.tui, editorTheme) ?? createAsideEditor(props.tui, editorTheme);
		this.editor = editor;
		initializeAsideEditor({
			editor,
			initialDraft: props.initialDraft,
			onDraftChange: (text) => {
				this.state.draft = text;
				this.state.notice = undefined;
				this.state.error = undefined;
				this.refreshCapsulePreview(resolveAsidePreviewPrompt(editor, text));
			},
			onSubmit: (text) => {
				void this.submit(text);
			},
		});
	}

	externalClose(kind: OverlayResult["kind"]): void {
		if (this.done) return;
		this.activeAbort?.abort();
		this.cleanup();
		this.done = true;
		this.props.onDone(kind);
	}

	handleInput(data: string): void {
		if (this.state.status === "running") {
			if (matchesKey(data, Key.escape)) {
				this.cancelRequested = true;
				this.activeAbort?.abort();
			}
			return;
		}

		if (matchesKey(data, Key.escape)) {
			this.externalClose("closed");
			return;
		}

		if (this.state.status === "compose") {
			this.editor.focused = this.focused;
			this.editor.handleInput(data);
			this.props.tui.requestRender();
			return;
		}

		if (this.state.status === "result") {
			if (matchesKey(data, "i") || data === "i" || data === "I") {
				this.insertIntoEditor();
				return;
			}
			if (matchesKey(data, Key.enter)) {
				void this.submit(this.state.submittedQuestion ?? this.state.draft);
				return;
			}
			this.handleScroll(data);
			return;
		}

		if (this.state.status === "failure") {
			if (matchesKey(data, Key.enter)) {
				void this.submit(this.state.submittedQuestion ?? this.state.draft);
				return;
			}
			this.handleScroll(data);
		}
	}

	render(width: number): string[] {
		const innerWidth = Math.max(10, width - 2);
		const lines: string[] = [];
		const addRow = (content = "") => {
			const truncated = truncateToWidth(content, innerWidth);
			const padding = Math.max(0, innerWidth - visibleWidth(truncated));
			lines.push(
				this.props.theme.fg("border", "│") + truncated + " ".repeat(padding) + this.props.theme.fg("border", "│"),
			);
		};
		const addWrapped = (text: string, indent = "") => {
			const available = Math.max(4, innerWidth - visibleWidth(indent));
			for (const rawLine of wrapTextWithAnsi(text, available)) {
				addRow(indent + rawLine);
			}
		};
		const divider = () => addRow(this.props.theme.fg("dim", "─".repeat(Math.max(0, innerWidth))));

		lines.push(this.props.theme.fg("border", `╭${"─".repeat(innerWidth)}╮`));
		addRow(` ${this.props.theme.fg("accent", "Aside")}`);
		addWrapped(" Aside: only accesses current session context/stream. No access to tools, filesystem, etc.");
		addRow("");
		addWrapped(
			` ${this.props.theme.fg("dim", `context: ${this.state.capsule.mode}`)}   ${this.props.theme.fg("dim", `model: ${this.state.modelBadge}`)}`,
		);
		addRow("");

		if (this.state.status === "compose") {
			addWrapped(` ${this.props.theme.fg("muted", "Question")}`);
			for (const line of this.editor.render(Math.max(8, innerWidth - 2))) {
				addRow(` ${line}`);
			}
			if (this.state.notice) {
				addRow("");
				addWrapped(` ${this.props.theme.fg("warning", this.state.notice)}`);
			}
			addRow("");
			divider();
			addWrapped(` ${this.props.theme.fg("dim", "Enter ask • Esc close")}`);
		}

		if (this.state.status === "running") {
			addWrapped(` ${this.props.theme.fg("accent", `${SPINNER_FRAMES[this.spinnerIndex]} Asking aside...`)}`);
			addRow("");
			addWrapped(` ${this.props.theme.fg("muted", `model: ${this.state.modelBadge}`)}`);
			addRow("");
			divider();
			addWrapped(` ${this.props.theme.fg("dim", "Esc cancel")}`);
		}

		if (this.state.status === "result" && this.state.result) {
			const bodyLines = this.scrollableBodyLines(this.state.result.answer, innerWidth);
			for (const line of bodyLines) addRow(` ${line}`);
			addRow("");
			addWrapped(
				` ${this.props.theme.fg("dim", `model: ${this.state.result.modelId} • elapsed: ${formatElapsed(this.state.result.elapsedMs)} • context: ${this.state.capsule.mode}`)}`,
			);
			addRow("");
			divider();
			addWrapped(` ${this.props.theme.fg("dim", "Press Enter to retry • i insert • Esc close • ↑↓ scroll")}`);
		}

		if (this.state.status === "failure" && this.state.error) {
			for (const line of this.scrollableBodyLines(this.state.error, innerWidth)) {
				addRow(` ${this.props.theme.fg("error", line)}`);
			}
			addRow("");
			divider();
			addWrapped(` ${this.props.theme.fg("dim", "Press Enter to retry • Esc close • ↑↓ scroll")}`);
		}

		lines.push(this.props.theme.fg("border", `╰${"─".repeat(innerWidth)}╯`));
		return lines;
	}

	invalidate(): void {
		this.editor.invalidate();
	}

	dispose(): void {
		this.cleanup();
	}

	private handleScroll(data: string): void {
		if (matchesKey(data, Key.up)) {
			this.scrollOffset = Math.max(0, this.scrollOffset - 1);
			this.props.tui.requestRender();
			return;
		}
		if (matchesKey(data, Key.down)) {
			this.scrollOffset += 1;
			this.props.tui.requestRender();
		}
	}

	private scrollableBodyLines(text: string, innerWidth: number): string[] {
		const wrapped = text
			.split(/\n{2,}/)
			.flatMap((paragraph, index, arr) => {
				const lines = wrapTextWithAnsi(paragraph || " ", Math.max(4, innerWidth - 2));
				return index < arr.length - 1 ? [...lines, ""] : lines;
			});
		const maxBodyLines = Math.max(6, Math.floor(this.props.tui.terminal.rows * 0.7) - 10);
		const maxOffset = Math.max(0, wrapped.length - maxBodyLines);
		this.scrollOffset = Math.min(this.scrollOffset, maxOffset);
		const visible = wrapped.slice(this.scrollOffset, this.scrollOffset + maxBodyLines);
		if (maxOffset > 0) {
			const indicator = this.props.theme.fg("dim", `(${this.scrollOffset + 1}-${Math.min(wrapped.length, this.scrollOffset + maxBodyLines)} of ${wrapped.length})`);
			visible.push(indicator);
		}
		return visible;
	}

	private refreshCapsulePreview(prompt = resolveAsidePreviewPrompt(this.editor, this.state.draft)): void {
		this.state.capsule = buildAsideCapsule({
			cwd: this.props.ctx.cwd,
			editorText: this.props.ctx.ui.getEditorText(),
			branch: this.props.ctx.sessionManager.getBranch(),
			prompt,
		});
		this.props.tui.requestRender();
	}

	private async submit(promptOverride?: string): Promise<void> {
		const prompt = (promptOverride ?? this.editor.getExpandedText()).trim();
		if (!prompt) {
			this.state.notice = "Enter a question before asking aside.";
			this.props.tui.requestRender();
			return;
		}
		this.state.submittedQuestion = prompt;

		const modelResult = resolveAsideModel({
			overrideId: process.env.PI_ASIDE_MODEL,
			currentModel: this.props.ctx.model,
			modelRegistry: this.props.ctx.modelRegistry,
		});
		if (!modelResult.ok) {
			this.state.status = "failure";
			this.state.error = modelResult.error;
			this.state.notice = undefined;
			this.scrollOffset = 0;
			this.props.tui.requestRender();
			return;
		}

		this.state.capsule = buildAsideCapsule({
			cwd: this.props.ctx.cwd,
			editorText: this.props.ctx.ui.getEditorText(),
			branch: this.props.ctx.sessionManager.getBranch(),
			prompt,
		});
		this.state.modelBadge = modelResult.model.id;
		this.state.status = "running";
		this.state.notice = undefined;
		this.state.error = undefined;
		this.scrollOffset = 0;
		this.startSpinner();
		this.props.tui.requestRender();

		const startedAt = Date.now();
		this.cancelRequested = false;
		this.timeoutTriggered = false;
		const abortController = new AbortController();
		this.activeAbort = abortController;
		const timeout = setTimeout(() => {
			this.timeoutTriggered = true;
			abortController.abort();
		}, ASIDE_TIMEOUT_MS);

		try {
			const auth = await this.props.ctx.modelRegistry.getApiKeyAndHeaders(modelResult.model);
			if (!auth.ok) {
				throw new Error(auth.error);
			}
			if (!auth.apiKey) {
				throw new Error(`No API key configured for ${modelResult.model.provider}/${modelResult.model.id}.`);
			}

			const userMessage: UserMessage = {
				role: "user",
				content: [
					{
						type: "text",
						text: serializeAsideCapsule(this.state.capsule, prompt),
					},
				],
				timestamp: Date.now(),
			};
			const response = await complete(
				modelResult.model,
				{
					systemPrompt: ASIDE_SYSTEM_PROMPT,
					messages: [userMessage],
				},
				{
					apiKey: auth.apiKey,
					headers: auth.headers,
					maxTokens: ASIDE_OUTPUT_MAX_TOKENS,
					signal: abortController.signal,
				},
			);

			if (abortController.signal.aborted || response.stopReason === "aborted") {
				if (this.cancelRequested) {
					this.state.status = "compose";
					this.state.notice = "Aside request cancelled.";
					this.state.modelBadge = modelResult.model.id;
					return;
				}
				throw new Error(this.timeoutTriggered ? "Aside request timed out." : "Aside request was aborted.");
			}

			if (response.stopReason === "error") {
				throw new Error(response.errorMessage || "Aside request failed.");
			}

			const answer = extractText(response).trim();
			if (!answer) {
				throw new Error("Aside response was empty.");
			}

			this.state.result = {
				answer,
				modelId: modelResult.model.id,
				elapsedMs: Date.now() - startedAt,
				outputTokens: response.usage?.output,
			};
			this.state.status = "result";
			this.state.error = undefined;
			this.state.notice = undefined;
			this.scrollOffset = 0;
		} catch (error) {
			if (this.cancelRequested) {
				this.state.status = "compose";
				this.state.notice = "Aside request cancelled.";
				this.state.error = undefined;
			} else {
				this.state.status = "failure";
				this.state.error = error instanceof Error ? error.message : String(error);
				this.state.notice = undefined;
			}
			this.scrollOffset = 0;
		} finally {
			clearTimeout(timeout);
			this.activeAbort = undefined;
			this.stopSpinner();
			this.props.tui.requestRender();
		}
	}

	private insertIntoEditor(): void {
		if (!this.state.result) return;
		const prompt = this.state.submittedQuestion ?? this.state.draft.trim();
		this.props.ctx.ui.pasteToEditor(
			formatAsidePromotion({
				question: prompt,
				capsule: this.state.capsule,
				result: this.state.result,
			}),
		);
		this.externalClose("inserted");
	}

	private startSpinner(): void {
		this.stopSpinner();
		this.spinnerIndex = 0;
		this.spinnerTimer = setInterval(() => {
			this.spinnerIndex = (this.spinnerIndex + 1) % SPINNER_FRAMES.length;
			this.props.tui.requestRender();
		}, 80);
	}

	private stopSpinner(): void {
		if (this.spinnerTimer) {
			clearInterval(this.spinnerTimer);
			this.spinnerTimer = undefined;
		}
	}

	private cleanup(): void {
		this.stopSpinner();
		this.activeAbort?.abort();
		this.activeAbort = undefined;
	}
}

function extractText(message: AssistantMessage): string {
	return message.content
		.filter((block): block is { type: "text"; text: string } => block.type === "text")
		.map((block) => block.text)
		.join("\n")
		.replace(new RegExp(CURSOR_MARKER, "g"), "");
}
