import type { SessionEntry, SessionInfo, SessionMessageEntry } from "@mariozechner/pi-coding-agent";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import {
	HARD_CHARS_PER_CHUNK,
	MAX_SELECTED_CHUNKS,
	MAX_TOTAL_IMPORT_CHARS,
	SESSION_CONTEXT_CUSTOM_TYPE,
	TARGET_CHARS_PER_CHUNK,
	type FormattedImport,
	type ParsedSessionContextArgs,
	type SessionChunk,
	type SessionChunkType,
	type SessionContextMetadata,
} from "./session-context-types.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GOAL_VERB_RE = /\b(need|want|build|fix|debug|review|plan|design|implement|investigate|audit|ship|replace|create|add)\b/i;
const PLAN_RE = /(^|\n)\s*(?:\d+\.|[-*])\s+|\b(plan|execution plan|next step|next steps|implementation plan)\b/i;
const CONCLUSION_RE = /\b(recommend|recommendation|decision|summary|bottom line|what to do now|verdict|conclusion|should)\b/i;
const TRIVIAL_USER_RE = /^(ok|okay|thanks|thank you|yep|yes|no|proceed|continue|go on)\.?$/i;
const NOISY_TOOL_NAMES = new Set(["bash", "read", "edit", "write", "ls", "find", "grep"]);

export {
	HARD_CHARS_PER_CHUNK,
	MAX_SELECTED_CHUNKS,
	MAX_TOTAL_IMPORT_CHARS,
	SESSION_CONTEXT_CUSTOM_TYPE,
	TARGET_CHARS_PER_CHUNK,
};
export type { FormattedImport, ParsedSessionContextArgs, SessionChunk, SessionChunkType, SessionContextMetadata };

function cleanWhitespace(text: string): string {
	return text.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function normalizeInlineWhitespace(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function truncateText(text: string, maxChars: number): { text: string; truncated: boolean } {
	const trimmed = cleanWhitespace(text);
	if (trimmed.length <= maxChars) return { text: trimmed, truncated: false };
	const slice = trimmed.slice(0, Math.max(0, maxChars - 15)).trimEnd();
	return { text: `${slice}\n[truncated]`, truncated: true };
}

function timestampToNumber(timestamp: string | undefined): number {
	if (!timestamp) return 0;
	const value = Date.parse(timestamp);
	return Number.isNaN(value) ? 0 : value;
}

export function parseSessionContextArgs(args: string): ParsedSessionContextArgs | { error: string } {
	const trimmed = args.trim();
	if (!trimmed) {
		return { error: "Usage: /session-context <session-id> [query]. Run /session in the source session to copy its id." };
	}
	const firstSpace = trimmed.indexOf(" ");
	const sessionId = firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace);
	const query = firstSpace === -1 ? undefined : trimmed.slice(firstSpace + 1).trim();
	if (!UUID_RE.test(sessionId)) {
		return { error: `Invalid session id: ${sessionId}. Run /session in the source session to copy its exact id.` };
	}
	return { sessionId: sessionId.toLowerCase(), query: query ? query : undefined };
}

function extractTextFromContent(content: unknown): string {
	if (typeof content === "string") return cleanWhitespace(content);
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		if (!block || typeof block !== "object") continue;
		if ("type" in block && block.type === "text" && "text" in block && typeof block.text === "string") {
			parts.push(block.text);
		}
		if ("type" in block && block.type === "thinking" && "thinking" in block && typeof block.thinking === "string") {
			parts.push(block.thinking);
		}
	}
	return cleanWhitespace(parts.join("\n\n"));
}

function getEntryText(entry: SessionEntry | undefined): string {
	if (!entry) return "";
	if (entry.type === "branch_summary" || entry.type === "compaction") {
		return cleanWhitespace(entry.summary);
	}
	if (entry.type === "custom_message") {
		return extractTextFromContent(entry.content);
	}
	if (entry.type === "message") {
		const message = entry.message;
		if (message.role === "user" || message.role === "toolResult") return extractTextFromContent(message.content as any);
		if (message.role === "assistant") return extractTextFromContent(message.content as any);
	}
	return "";
}

function chunkId(entryId: string, type: SessionChunkType): string {
	return `${entryId}:${type}`;
}

function previewFromText(text: string, maxChars = 140): string {
	return normalizeInlineWhitespace(truncateText(text, maxChars).text.replace(/\n+/g, " "));
}

function buildChunk(type: SessionChunkType, sourceEntryId: string, title: string, text: string, timestamp: number, tags: string[] = []): SessionChunk {
	return {
		id: chunkId(sourceEntryId, type),
		sourceEntryId,
		type,
		title,
		preview: previewFromText(text),
		fullText: cleanWhitespace(text),
		timestamp,
		score: 0,
		tags,
	};
}

function isLikelyUserGoal(text: string): boolean {
	const trimmed = normalizeInlineWhitespace(text);
	if (!trimmed || trimmed.length < 12) return false;
	if (trimmed.startsWith("/") || trimmed.startsWith("!")) return false;
	if (TRIVIAL_USER_RE.test(trimmed)) return false;
	return trimmed.length >= 40 || GOAL_VERB_RE.test(trimmed);
}

function classifyAssistantText(text: string): SessionChunkType | undefined {
	const trimmed = cleanWhitespace(text);
	if (!trimmed || trimmed.length < 20) return undefined;
	if (PLAN_RE.test(trimmed)) return "assistant_plan";
	if (CONCLUSION_RE.test(trimmed) || trimmed.length >= 120) return "assistant_conclusion";
	return undefined;
}

function isSemanticToolFinding(entry: SessionMessageEntry): boolean {
	if (entry.message.role !== "toolResult") return false;
	const toolName = entry.message.toolName?.toLowerCase?.() ?? "";
	if (!toolName || NOISY_TOOL_NAMES.has(toolName)) return false;
	const text = extractTextFromContent(entry.message.content as any);
	if (!text || text.length < 20) return false;
	if (text.length > 1200) return false;
	return true;
}

export function extractSessionChunks(entries: SessionEntry[]): SessionChunk[] {
	const chunks: SessionChunk[] = [];
	const byId = new Map(entries.map((entry) => [entry.id, entry]));
	for (const entry of entries) {
		const ts = timestampToNumber(entry.timestamp);
		if (entry.type === "branch_summary") {
			chunks.push(buildChunk("branch_summary", entry.id, "Branch summary", entry.summary, ts));
			continue;
		}
		if (entry.type === "compaction") {
			chunks.push(buildChunk("compaction_summary", entry.id, "Compaction summary", entry.summary, ts));
			continue;
		}
		if (entry.type === "label") {
			const target = byId.get(entry.targetId);
			const targetText = getEntryText(target);
			if (targetText) {
				const label = entry.label?.trim() || "Checkpoint";
				chunks.push(buildChunk("label_checkpoint", entry.id, `Checkpoint: ${label}`, targetText, ts, entry.label ? [entry.label] : []));
			}
			continue;
		}
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (message.role === "user") {
			const text = extractTextFromContent(message.content as any);
			if (isLikelyUserGoal(text)) {
				chunks.push(buildChunk("user_goal", entry.id, "User goal", text, ts));
			}
			continue;
		}
		if (message.role === "assistant") {
			const text = extractTextFromContent(message.content as any);
			const kind = classifyAssistantText(text);
			if (kind) {
				chunks.push(buildChunk(kind, entry.id, kind === "assistant_plan" ? "Assistant plan" : "Assistant conclusion", text, ts));
			}
			continue;
		}
		if (message.role === "toolResult" && isSemanticToolFinding(entry)) {
			const text = extractTextFromContent(message.content as any);
			chunks.push(buildChunk("tool_finding", entry.id, `Tool finding: ${message.toolName}`, text, ts, [message.toolName]));
		}
	}

	const deduped = new Map<string, SessionChunk>();
	for (const chunk of chunks) {
		const key = `${chunk.type}:${normalizeInlineWhitespace(chunk.fullText).toLowerCase()}`;
		if (!deduped.has(key)) deduped.set(key, chunk);
	}
	return Array.from(deduped.values());
}

function queryTokens(query: string | undefined): string[] {
	if (!query) return [];
	return query
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.map((token) => token.trim())
		.filter((token) => token.length >= 2);
}

const TYPE_WEIGHTS: Record<SessionChunkType, number> = {
	branch_summary: 120,
	compaction_summary: 115,
	label_checkpoint: 105,
	user_goal: 95,
	assistant_plan: 90,
	assistant_conclusion: 88,
	tool_finding: 72,
};

export function rankSessionChunks(chunks: SessionChunk[], query?: string): SessionChunk[] {
	const tokens = queryTokens(query);
	const maxTimestamp = chunks.reduce((max, chunk) => Math.max(max, chunk.timestamp), 0);
	return [...chunks]
		.map((chunk) => {
			let score = TYPE_WEIGHTS[chunk.type];
			const agePenalty = maxTimestamp > 0 ? Math.min(30, Math.floor((maxTimestamp - chunk.timestamp) / (1000 * 60 * 30))) : 0;
			score -= agePenalty;
			if (tokens.length > 0) {
				const haystack = `${chunk.title}\n${chunk.preview}\n${chunk.fullText}\n${chunk.tags.join(" ")}`.toLowerCase();
				const titleLower = chunk.title.toLowerCase();
				const previewLower = chunk.preview.toLowerCase();
				const joinedTags = chunk.tags.join(" ").toLowerCase();
				for (const token of tokens) {
					if (titleLower.includes(token)) score += 40;
					if (previewLower.includes(token)) score += 20;
					if (haystack.includes(token)) score += 10;
					if (joinedTags.includes(token)) score += 8;
				}
				if (query && haystack.includes(query.toLowerCase())) score += 25;
			}
			return { ...chunk, score };
		})
		.sort((a, b) => {
			if (b.score !== a.score) return b.score - a.score;
			if (b.timestamp !== a.timestamp) return b.timestamp - a.timestamp;
			if (a.type !== b.type) return a.type.localeCompare(b.type);
			return a.sourceEntryId.localeCompare(b.sourceEntryId);
		});
}

export function formatImportedSessionContext(metadata: SessionContextMetadata, chunks: SessionChunk[]): FormattedImport {
	const selected = chunks.slice(0, MAX_SELECTED_CHUNKS);
	let truncated = false;
	const importedChunks = selected.map((chunk) => {
		const limited = truncateText(chunk.fullText, HARD_CHARS_PER_CHUNK);
		truncated ||= limited.truncated;
		return { ...chunk, importedText: limited.text };
	});

	const baseHeader = [
		"Imported session context",
		"",
		"Source",
		`- Session ID: ${metadata.sessionId}`,
		`- CWD: ${metadata.cwd}`,
		...(metadata.name ? [`- Session Name: ${metadata.name}`] : []),
		...(metadata.query ? [`- Query: ${metadata.query}`] : []),
		...(metadata.crossCwd ? ["- Warning: Source session cwd differs from the current cwd."] : []),
		"",
		"Selected excerpts",
	];

		let bodyChunks = importedChunks;
		let content = "";
		for (;;) {
			content = [
				...baseHeader,
				...bodyChunks.flatMap((chunk, index) => [
					"",
					`${index + 1}. [${chunk.type}] ${chunk.title}`,
					chunk.importedText,
				]),
			].join("\n");
			if (content.length <= MAX_TOTAL_IMPORT_CHARS) {
				return { content, usedChunks: bodyChunks, truncated, tooLarge: false };
			}
			let shrunk = false;
			bodyChunks = bodyChunks.map((chunk) => ({ ...chunk }));
			for (const chunk of bodyChunks.sort((a, b) => b.importedText.length - a.importedText.length)) {
				if (chunk.importedText.length <= 220) continue;
				const currentLimit = chunk.importedText.length > TARGET_CHARS_PER_CHUNK ? TARGET_CHARS_PER_CHUNK : Math.max(220, chunk.importedText.length - 220);
				const next = truncateText(chunk.importedText.replace(/\n\[truncated\]$/, ""), currentLimit);
				if (next.text.length < chunk.importedText.length) {
					chunk.importedText = next.text;
					truncated = true;
					shrunk = true;
					break;
				}
			}
			if (!shrunk) {
				return { content, usedChunks: bodyChunks, truncated: true, tooLarge: true };
			}
		}
}

export async function resolveTargetSession(sessionId: string): Promise<SessionInfo | undefined> {
	const sessions = await SessionManager.listAll();
	return sessions.find((session) => session.id.toLowerCase() === sessionId.toLowerCase());
}
