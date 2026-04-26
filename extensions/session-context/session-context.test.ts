import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import type { SessionEntry } from "@mariozechner/pi-coding-agent";

function moduleHref(tsRelativePath: string): string {
	const tsUrl = new URL(tsRelativePath, import.meta.url);
	if (fs.existsSync(fileURLToPath(tsUrl))) return tsUrl.href;
	return new URL(tsRelativePath.replace(/\.ts$/, ".js"), import.meta.url).href;
}

async function loadModule(): Promise<any> {
	const jiti = createJiti(import.meta.url, { moduleCache: false });
	return jiti.import(moduleHref("./session-context-core.ts"));
}

function makeEntries(): SessionEntry[] {
	return [
		{
			type: "message",
			id: "u1",
			parentId: null,
			timestamp: "2026-04-25T20:00:00.000Z",
			message: {
				role: "user",
				content: "I need a browser that can search another session by exact id and import only selected parts.",
				timestamp: 1,
			},
		},
		{
			type: "message",
			id: "a1",
			parentId: "u1",
			timestamp: "2026-04-25T20:01:00.000Z",
			message: {
				role: "assistant",
				content: [{ type: "text", text: "Recommendation: build a focused browser, then import a compact context bundle." }],
				provider: "anthropic",
				model: "claude",
				api: "anthropic",
				usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
				stopReason: "stop",
				timestamp: 2,
			},
		},
		{
			type: "message",
			id: "a2",
			parentId: "a1",
			timestamp: "2026-04-25T20:02:00.000Z",
			message: {
				role: "assistant",
				content: [{ type: "text", text: "Execution Plan\n1. Resolve the target session\n2. Rank candidate chunks\n3. Let the user multi-select excerpts" }],
				provider: "anthropic",
				model: "claude",
				api: "anthropic",
				usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
				stopReason: "stop",
				timestamp: 3,
			},
		},
		{
			type: "branch_summary",
			id: "b1",
			parentId: "a2",
			timestamp: "2026-04-25T20:03:00.000Z",
			fromId: "a1",
			summary: "Branch explored the browser UX and settled on multi-select import.",
		},
		{
			type: "compaction",
			id: "c1",
			parentId: "b1",
			timestamp: "2026-04-25T20:04:00.000Z",
			summary: "Compaction summary covering the exact session id retrieval workflow.",
			firstKeptEntryId: "u1",
			tokensBefore: 999,
		},
		{
			type: "label",
			id: "l1",
			parentId: "c1",
			timestamp: "2026-04-25T20:05:00.000Z",
			targetId: "a2",
			label: "browser-shape",
		},
		{
			type: "message",
			id: "t1",
			parentId: "l1",
			timestamp: "2026-04-25T20:06:00.000Z",
			message: {
				role: "toolResult",
				toolCallId: "call-1",
				toolName: "models",
				content: [{ type: "text", text: "Recommended reviewer models from Anthropic and Google were available." }],
				isError: false,
				timestamp: 4,
			},
		},
		{
			type: "message",
			id: "t2",
			parentId: "t1",
			timestamp: "2026-04-25T20:07:00.000Z",
			message: {
				role: "toolResult",
				toolCallId: "call-2",
				toolName: "bash",
				content: [{ type: "text", text: "raw shell output that should not become a finding" }],
				isError: false,
				timestamp: 5,
			},
		},
	];
}

test("parseSessionContextArgs enforces exact session id and optional query", async () => {
	const { parseSessionContextArgs } = await loadModule();
	assert.deepEqual(parseSessionContextArgs("019dc6a2-0349-748c-a4fb-613ab0276cc7 search terms"), {
		sessionId: "019dc6a2-0349-748c-a4fb-613ab0276cc7",
		query: "search terms",
	});
	assert.match(parseSessionContextArgs("not-a-session-id").error, /Invalid session id/);
});

test("extractSessionChunks classifies deterministic high-signal excerpts", async () => {
	const { extractSessionChunks } = await loadModule();
	const chunks = extractSessionChunks(makeEntries());
	assert.equal(chunks.some((chunk: any) => chunk.type === "user_goal"), true);
	assert.equal(chunks.some((chunk: any) => chunk.type === "assistant_conclusion"), true);
	assert.equal(chunks.some((chunk: any) => chunk.type === "assistant_plan"), true);
	assert.equal(chunks.some((chunk: any) => chunk.type === "branch_summary"), true);
	assert.equal(chunks.some((chunk: any) => chunk.type === "compaction_summary"), true);
	assert.equal(chunks.some((chunk: any) => chunk.type === "label_checkpoint"), true);
	assert.equal(chunks.some((chunk: any) => chunk.type === "tool_finding" && chunk.title.includes("models")), true);
	assert.equal(chunks.some((chunk: any) => chunk.type === "tool_finding" && chunk.title.includes("bash")), false);
});

test("rankSessionChunks prefers query matches and breaks ties deterministically", async () => {
	const { extractSessionChunks, rankSessionChunks } = await loadModule();
	const ranked = rankSessionChunks(extractSessionChunks(makeEntries()), "browser");
	assert.equal(ranked[0]?.title.includes("Branch") || ranked[0]?.title.includes("Assistant") || ranked[0]?.title.includes("Checkpoint"), true);
	for (let index = 1; index < ranked.length; index++) {
		const prev = ranked[index - 1]!;
		const current = ranked[index]!;
		assert.equal(prev.score >= current.score || prev.timestamp >= current.timestamp, true);
	}
});

test("formatImportedSessionContext truncates and fits within the import budget", async () => {
	const { formatImportedSessionContext } = await loadModule();
	const longText = "A".repeat(2600);
	const chunks = Array.from({ length: 5 }, (_, index) => ({
		id: `chunk-${index}`,
		sourceEntryId: `entry-${index}`,
		type: "assistant_conclusion",
		title: `Chunk ${index}`,
		preview: "preview",
		fullText: longText,
		timestamp: index,
		score: 1,
		tags: [],
	}));
	const formatted = formatImportedSessionContext(
		{
			sessionId: "019dc6a2-0349-748c-a4fb-613ab0276cc7",
			sessionPath: "/tmp/session.jsonl",
			cwd: "/repo",
			query: "browser",
			crossCwd: false,
		},
		chunks as any,
	);
	assert.equal(formatted.tooLarge, false);
	assert.equal(formatted.truncated, true);
	assert.equal(formatted.content.length <= 5000, true);
});
