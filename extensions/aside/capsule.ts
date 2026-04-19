import path from "node:path";
import type { AssistantMessage, Message, ToolResultMessage, UserMessage } from "@mariozechner/pi-ai";
import type { SessionEntry } from "@mariozechner/pi-coding-agent";

export type AsideCapsuleMode = "recent-turn" | "minimal";

export interface AsideCapsule {
	mode: AsideCapsuleMode;
	projectLabel: string;
	editorDraft?: string;
	lastUserText?: string;
	lastAssistantText?: string;
	toolSummary?: string[];
	approxTokens: number;
}

export interface BuildAsideCapsuleInput {
	cwd: string;
	editorText?: string;
	branch: SessionEntry[];
	prompt: string;
}

export interface AsideCapsuleOptions {
	tokenCap?: number;
	maxEditorTokens?: number;
	maxUserTokens?: number;
	maxAssistantTokens?: number;
	maxQuestionTokens?: number;
	maxToolSummaryItems?: number;
	maxToolSummaryLineTokens?: number;
}

const DEFAULT_OPTIONS: Required<AsideCapsuleOptions> = {
	tokenCap: 4000,
	maxEditorTokens: 800,
	maxUserTokens: 320,
	maxAssistantTokens: 900,
	maxQuestionTokens: 220,
	maxToolSummaryItems: 4,
	maxToolSummaryLineTokens: 40,
};

export function approxTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

export function truncateByTokens(text: string | undefined, maxTokens: number): string | undefined {
	if (!text) return undefined;
	const cleaned = normalizeWhitespace(text);
	if (!cleaned) return undefined;
	const maxChars = Math.max(1, maxTokens * 4);
	if (cleaned.length <= maxChars) return cleaned;
	return `${cleaned.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

export function buildAsideCapsule(
	input: BuildAsideCapsuleInput,
	options?: AsideCapsuleOptions,
): AsideCapsule {
	const resolved = { ...DEFAULT_OPTIONS, ...options };
	const editorDraft = truncateByTokens(input.editorText, resolved.maxEditorTokens);
	const question = truncateByTokens(input.prompt, resolved.maxQuestionTokens) ?? "";
	const projectLabel = input.cwd || path.basename(process.cwd()) || ".";
	const recentTurn = extractRecentTurn(input.branch, resolved);

	const candidate: AsideCapsule = {
		mode: "recent-turn",
		projectLabel,
		editorDraft,
		lastUserText: recentTurn.lastUserText,
		lastAssistantText: recentTurn.lastAssistantText,
		toolSummary: recentTurn.toolSummary.length > 0 ? recentTurn.toolSummary : undefined,
		approxTokens: 0,
	};
	candidate.approxTokens = approxTokens(serializeAsideCapsule(candidate, question));

	const isExtractionEmpty =
		!candidate.lastUserText && !candidate.lastAssistantText && (!candidate.toolSummary || candidate.toolSummary.length === 0);
	if (isExtractionEmpty || candidate.approxTokens > resolved.tokenCap) {
		return buildMinimalCapsule({ projectLabel, editorDraft, prompt: question });
	}

	return candidate;
}

export function buildMinimalCapsule(input: {
	projectLabel: string;
	editorDraft?: string;
	prompt: string;
}): AsideCapsule {
	const capsule: AsideCapsule = {
		mode: "minimal",
		projectLabel: input.projectLabel,
		editorDraft: input.editorDraft,
		approxTokens: 0,
	};
	capsule.approxTokens = approxTokens(serializeAsideCapsule(capsule, input.prompt));
	return capsule;
}

export function serializeAsideCapsule(capsule: AsideCapsule, prompt: string): string {
	const parts = [
		"You are answering a temporary side question from a bounded session capsule.",
		"Use only the provided context. If the user clearly needs repository inspection, tools, or file edits, say this aside has no tool access and recommend /fork.",
		"Be concise and practical.",
		"",
		`Context mode: ${capsule.mode}`,
		`Working directory: ${capsule.projectLabel}`,
	];

	if (capsule.editorDraft) {
		parts.push("", "Current editor draft:", capsule.editorDraft);
	}
	if (capsule.lastUserText) {
		parts.push("", "Last completed user message:", capsule.lastUserText);
	}
	if (capsule.lastAssistantText) {
		parts.push("", "Last completed assistant response:", capsule.lastAssistantText);
	}
	if (capsule.toolSummary && capsule.toolSummary.length > 0) {
		parts.push("", "Recent tool summary:", ...capsule.toolSummary.map((item) => `- ${item}`));
	}
	parts.push("", "Aside question:", prompt);

	return parts.join("\n");
}

function extractRecentTurn(
	branch: SessionEntry[],
	options: Required<AsideCapsuleOptions>,
): { lastUserText?: string; lastAssistantText?: string; toolSummary: string[] } {
	const messages = branch.filter(
		(entry): entry is SessionEntry & { type: "message"; message: Message } => entry.type === "message",
	);

	let lastCompletedAssistantIndex = -1;
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i]!.message;
		if (message.role === "assistant" && message.stopReason !== "toolUse") {
			lastCompletedAssistantIndex = i;
			break;
		}
	}

	if (lastCompletedAssistantIndex === -1) {
		return { toolSummary: [] };
	}

	let lastUserIndex = -1;
	for (let i = lastCompletedAssistantIndex - 1; i >= 0; i--) {
		if (messages[i]!.message.role === "user") {
			lastUserIndex = i;
			break;
		}
	}

	if (lastUserIndex === -1) {
		return { toolSummary: [] };
	}

	const turnMessages = messages.slice(lastUserIndex, lastCompletedAssistantIndex + 1).map((entry) => entry.message);
	const lastUser = turnMessages.find((message): message is UserMessage => message.role === "user");
	const assistantTexts = turnMessages
		.filter((message): message is AssistantMessage => message.role === "assistant")
		.flatMap((message) => message.content)
		.filter((block): block is { type: "text"; text: string } => block.type === "text")
		.map((block) => block.text)
		.join("\n\n");
	const toolSummary = turnMessages
		.filter((message): message is ToolResultMessage => message.role === "toolResult")
		.map((message) => summarizeToolResult(message, options.maxToolSummaryLineTokens))
		.filter((line): line is string => Boolean(line))
		.slice(0, options.maxToolSummaryItems);

	return {
		lastUserText: truncateByTokens(extractUserText(lastUser), options.maxUserTokens),
		lastAssistantText: truncateByTokens(assistantTexts, options.maxAssistantTokens),
		toolSummary,
	};
}

function extractUserText(message: UserMessage | undefined): string | undefined {
	if (!message) return undefined;
	if (typeof message.content === "string") {
		return message.content;
	}
	return message.content
		.filter((block): block is { type: "text"; text: string } => block.type === "text")
		.map((block) => block.text)
		.join("\n\n");
}

function summarizeToolResult(message: ToolResultMessage, maxTokens: number): string | undefined {
	const status = message.isError ? "error" : "ok";
	const parts = [`${message.toolName}: ${status}`];
	const paths = Array.from(collectPaths(message.details)).slice(0, 3);
	if (paths.length > 0) {
		parts.push(paths.join(", "));
	}
	return truncateByTokens(parts.join(" - "), maxTokens);
}

function collectPaths(value: unknown, depth = 0, out = new Set<string>()): Set<string> {
	if (depth > 4 || out.size >= 6 || value === null || value === undefined) {
		return out;
	}
	if (typeof value === "string") {
		if (looksLikePath(value)) out.add(value);
		return out;
	}
	if (Array.isArray(value)) {
		for (const item of value) collectPaths(item, depth + 1, out);
		return out;
	}
	if (typeof value !== "object") {
		return out;
	}
	for (const [key, child] of Object.entries(value)) {
		if (out.size >= 6) break;
		if (/path/i.test(key)) {
			collectPaths(child, depth + 1, out);
			continue;
		}
		if (depth < 2) {
			collectPaths(child, depth + 1, out);
		}
	}
	return out;
}

function looksLikePath(value: string): boolean {
	return /[/\\]/.test(value) || /^\.?\.?$/.test(value) || /^\.?\.?[/\\]/.test(value) || /^[\w.-]+\.[A-Za-z0-9]+$/.test(value);
}

function normalizeWhitespace(text: string): string {
	return text
		.replace(/\r\n/g, "\n")
		.replace(/\u0000/g, "")
		.split("\n")
		.map((line) => line.trimEnd())
		.join("\n")
		.trim();
}
