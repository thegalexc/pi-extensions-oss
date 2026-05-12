import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

function moduleHref(tsRelativePath: string): string {
	const tsUrl = new URL(tsRelativePath, import.meta.url);
	if (fs.existsSync(fileURLToPath(tsUrl))) return tsUrl.href;
	return new URL(tsRelativePath.replace(/\.ts$/, ".js"), import.meta.url).href;
}

async function loadCoreModule(): Promise<any> {
	const jiti = createJiti(import.meta.url, { moduleCache: false });
	return jiti.import(moduleHref("./pluck-core.ts"));
}

async function loadCommandModule(): Promise<any> {
	const jiti = createJiti(import.meta.url, { moduleCache: false });
	return jiti.import(moduleHref("./pluck.ts"));
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

function makeEntriesWithThinkingSummary(): SessionEntry[] {
	return [
		{
			type: "message",
			id: "u1",
			parentId: null,
			timestamp: "2026-05-12T01:26:39.329Z",
			message: {
				role: "user",
				content: "Evaluate everything and summarize where we're at / what needs my attention.",
				timestamp: 1,
			},
		},
		{
			type: "message",
			id: "a1",
			parentId: "u1",
			timestamp: "2026-05-12T01:29:53.433Z",
			message: {
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "**Clarifying form options**\n\nI need to note some taxonomy details before I answer." },
					{
						type: "text",
						text: "I reviewed the Google Doc and the live CREO form.\n\n## Where you’re at\n\n**Already filled / basically settled**\n- Permission to share: **Yes**\n\n## What needs your attention\n- Referral/contact details\n\n## Bottom line\nThis needs a decision checklist.",
					},
				],
				provider: "openai-codex",
				model: "gpt-5.4",
				api: "openai-codex-responses",
				usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
				stopReason: "stop",
				timestamp: 2,
			},
		},
	];
}

function makeEntriesWithDuplicateVisibleText(): SessionEntry[] {
	return [
		{
			type: "message",
			id: "a1",
			parentId: null,
			timestamp: "2026-05-12T00:00:00.000Z",
			message: {
				role: "assistant",
				content: [{ type: "text", text: "Recommendation: same visible summary" }],
				provider: "anthropic",
				model: "claude",
				api: "anthropic",
				usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
				stopReason: "stop",
				timestamp: 1,
			},
		},
		{
			type: "label",
			id: "l1",
			parentId: "a1",
			timestamp: "2026-05-12T00:01:00.000Z",
			targetId: "a1",
			label: "first-pass",
		},
		{
			type: "label",
			id: "l2",
			parentId: "l1",
			timestamp: "2026-05-12T00:02:00.000Z",
			targetId: "a1",
			label: "final",
		},
		{
			type: "message",
			id: "t1",
			parentId: "l2",
			timestamp: "2026-05-12T00:03:00.000Z",
			message: {
				role: "toolResult",
				toolCallId: "call-1",
				toolName: "todo",
				content: [{ type: "text", text: "Added todo #1: same text across tools" }],
				isError: false,
				timestamp: 2,
			},
		},
		{
			type: "message",
			id: "t2",
			parentId: "t1",
			timestamp: "2026-05-12T00:04:00.000Z",
			message: {
				role: "toolResult",
				toolCallId: "call-2",
				toolName: "custom",
				content: [{ type: "text", text: "Added todo #1: same text across tools" }],
				isError: false,
				timestamp: 3,
			},
		},
	];
}

test("parsePluckArgs enforces exact session id and optional query", async () => {
	const { parsePluckArgs } = await loadCoreModule();
	assert.deepEqual(parsePluckArgs("019dc6a2-0349-748c-a4fb-613ab0276cc7 search terms"), {
		sessionId: "019dc6a2-0349-748c-a4fb-613ab0276cc7",
		query: "search terms",
	});
	assert.match(parsePluckArgs("not-a-session-id").error, /Invalid session id/);
});

test("extractPluckChunks classifies deterministic high-signal excerpts", async () => {
	const { extractPluckChunks } = await loadCoreModule();
	const chunks = extractPluckChunks(makeEntries());
	assert.equal(chunks.some((chunk: any) => chunk.type === "user_goal"), true);
	assert.equal(chunks.some((chunk: any) => chunk.type === "assistant_conclusion"), true);
	assert.equal(chunks.some((chunk: any) => chunk.type === "assistant_plan"), true);
	assert.equal(chunks.some((chunk: any) => chunk.type === "branch_summary"), true);
	assert.equal(chunks.some((chunk: any) => chunk.type === "compaction_summary"), true);
	assert.equal(chunks.some((chunk: any) => chunk.type === "label_checkpoint"), true);
	assert.equal(chunks.some((chunk: any) => chunk.type === "tool_finding" && chunk.title.includes("models")), true);
	assert.equal(chunks.some((chunk: any) => chunk.type === "tool_finding" && chunk.title.includes("bash")), false);
});

test("rankPluckChunks prefers query matches and breaks ties deterministically", async () => {
	const { extractPluckChunks, rankPluckChunks } = await loadCoreModule();
	const ranked = rankPluckChunks(extractPluckChunks(makeEntries()), "browser");
	assert.equal(ranked[0]?.title.includes("Branch") || ranked[0]?.title.includes("Assistant") || ranked[0]?.title.includes("Checkpoint"), true);
	for (let index = 1; index < ranked.length; index++) {
		const prev = ranked[index - 1]!;
		const current = ranked[index]!;
		assert.equal(prev.score >= current.score || prev.timestamp >= current.timestamp, true);
	}
});

test("extractPluckChunks ignores assistant thinking and preserves the visible summary", async () => {
	const { extractPluckChunks, rankPluckChunks } = await loadCoreModule();
	const chunks = extractPluckChunks(makeEntriesWithThinkingSummary());
	const summary = chunks.find((chunk: any) => chunk.type === "assistant_conclusion");
	assert.ok(summary);
	assert.match(summary.fullText, /^I reviewed the Google Doc and the live CREO form\./);
	assert.doesNotMatch(summary.fullText, /Clarifying form options/);
	assert.match(summary.preview, /Where you’re at/);

	const ranked = rankPluckChunks(chunks);
	assert.equal(ranked[0]?.type, "assistant_conclusion");
});

test("extractPluckChunks preserves distinct labels and tool findings even when visible text matches", async () => {
	const { extractPluckChunks } = await loadCoreModule();
	const chunks = extractPluckChunks(makeEntriesWithDuplicateVisibleText());
	assert.equal(chunks.filter((chunk: any) => chunk.type === "label_checkpoint").length, 2);
	assert.equal(chunks.filter((chunk: any) => chunk.type === "tool_finding").length, 2);
	assert.equal(chunks.some((chunk: any) => chunk.title === "Checkpoint: first-pass"), true);
	assert.equal(chunks.some((chunk: any) => chunk.title === "Checkpoint: final"), true);
	assert.equal(chunks.some((chunk: any) => chunk.title === "Tool finding: todo"), true);
	assert.equal(chunks.some((chunk: any) => chunk.title === "Tool finding: custom"), true);
});


test("extractPluckChunks caps oversized tool findings instead of letting them dominate imports", async () => {
	const { extractPluckChunks } = await loadCoreModule();
	const giant = "X".repeat(2500);
	const chunks = extractPluckChunks([
		{
			type: "message",
			id: "t1",
			parentId: null,
			timestamp: "2026-05-12T00:00:00.000Z",
			message: {
				role: "toolResult",
				toolCallId: "call-1",
				toolName: "custom",
				content: [{ type: "text", text: giant }],
				isError: false,
				timestamp: 1,
			},
		},
	] as any);
	assert.equal(chunks.length, 1);
	assert.equal(chunks[0]?.type, "tool_finding");
	assert.equal((chunks[0]?.fullText.length ?? 0) <= 700, true);
	assert.match(chunks[0]?.fullText ?? "", /\[truncated\]$/);
});

test("rankPluckChunks resists generic query chatter and prefers strong assistant summaries", async () => {
	const { rankPluckChunks } = await loadCoreModule();
	const ranked = rankPluckChunks(
		[
			{
				id: "a",
				sourceEntryId: "a",
				type: "assistant_conclusion",
				title: "Assistant conclusion",
				preview: "A precise funding summary",
				fullText: "A precise funding summary for the CREO deal.",
				timestamp: 10,
				score: 0,
				tags: [],
			},
			{
				id: "b",
				sourceEntryId: "b",
				type: "user_goal",
				title: "User goal",
				preview: "please investigate the thing and summarize it for me",
				fullText: "please investigate the thing and summarize it for me",
				timestamp: 20,
				score: 0,
				tags: [],
			},
		],
		"summarize the thing",
	);
	assert.equal(ranked[0]?.type, "assistant_conclusion");
});


test("rankPluckChunks downranks verbose tool findings relative to comparable answers", async () => {
	const { rankPluckChunks } = await loadCoreModule();
	const ranked = rankPluckChunks([
		{
			id: "a",
			sourceEntryId: "a",
			type: "assistant_conclusion",
			title: "Assistant conclusion",
			preview: "Useful concise answer",
			fullText: "Useful concise answer about the deployment state.",
			timestamp: 100,
			score: 0,
			tags: [],
		},
		{
			id: "t",
			sourceEntryId: "t",
			type: "tool_finding",
			title: "Tool finding: custom",
			preview: "deployment state raw output",
			fullText: "deployment state "+"X".repeat(680),
			timestamp: 100,
			score: 0,
			tags: ["custom"],
		},
	], "deployment state");
	assert.equal(ranked[0]?.type, "assistant_conclusion");
});

test("formatImportedPluck truncates and fits within the import budget", async () => {
	const { formatImportedPluck } = await loadCoreModule();
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
	const formatted = formatImportedPluck(
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

test("runPluckCommand fails fast on narrow terminals instead of opening an invisible overlay", async () => {
	const { MIN_PLUCK_WIDTH, runPluckCommand } = await loadCommandModule();
	const originalColumns = process.stdout.columns;
	Object.defineProperty(process.stdout, "columns", {
		configurable: true,
		value: MIN_PLUCK_WIDTH - 1,
	});

	const notifications: Array<{ message: string; level: string }> = [];
	const ui = {
		notify: (message: string, level: string) => {
			notifications.push({ message, level });
		},
		setStatus: () => {
			throw new Error("setStatus should not run on narrow terminals");
		},
	};
	const ctx = {
		hasUI: true,
		ui,
		isIdle: () => true,
	} as any;
	const pi = {
		sendMessage: () => {
			throw new Error("sendMessage should not run on narrow terminals");
		},
	} as any;

	try {
		await runPluckCommand(pi, ctx, "019dc6a2-0349-748c-a4fb-613ab0276cc7");
	} finally {
		Object.defineProperty(process.stdout, "columns", {
			configurable: true,
			value: originalColumns,
		});
	}

	assert.equal(notifications.length, 1);
	assert.equal(notifications[0]?.level, "warning");
	assert.match(notifications[0]?.message ?? "", /needs a terminal at least/i);
});
