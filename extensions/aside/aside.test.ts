import { test } from "node:test";
import assert from "node:assert/strict";
import type { SessionEntry } from "@mariozechner/pi-coding-agent";

async function loadCapsuleModule() {
	return import(new URL("./capsule.ts", import.meta.url).href);
}

async function loadModelModule() {
	return import(new URL("./model.ts", import.meta.url).href);
}

async function loadFormatModule() {
	return import(new URL("./format.ts", import.meta.url).href);
}

async function loadEditorModule() {
	return import(new URL("./editor.ts", import.meta.url).href);
}

function messageEntry(id: string, parentId: string | null, message: any): SessionEntry {
	return {
		type: "message",
		id,
		parentId,
		timestamp: new Date().toISOString(),
		message,
	} as SessionEntry;
}

test("buildAsideCapsule keeps only the last completed exchange and summarizes tools", async () => {
	const { buildAsideCapsule, serializeAsideCapsule } = await loadCapsuleModule();
	const branch: SessionEntry[] = [
		messageEntry("1", null, { role: "user", content: "older question" }),
		messageEntry("2", "1", {
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "hidden" },
				{ type: "text", text: "older answer" },
			],
			stopReason: "stop",
		}),
		messageEntry("3", "2", { role: "user", content: "what changed in src/index.ts?" }),
		messageEntry("4", "3", {
			role: "assistant",
			content: [{ type: "toolCall", id: "tool-1", name: "read", arguments: { path: "src/index.ts" } }],
			stopReason: "toolUse",
		}),
		messageEntry("5", "4", {
			role: "toolResult",
			toolCallId: "tool-1",
			toolName: "read",
			content: [{ type: "text", text: "very large raw tool output that should never be copied into the aside capsule" }],
			details: { path: "src/index.ts", content: "ignored payload" },
			isError: false,
		}),
		messageEntry("6", "5", {
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "also hidden" },
				{ type: "text", text: "The bug lives in src/index.ts." },
			],
			stopReason: "stop",
		}),
	];

	const capsule = buildAsideCapsule({
		cwd: "/repo/project",
		editorText: "draft editor notes",
		branch,
		prompt: "why?",
	});

	assert.equal(capsule.mode, "recent-turn");
	assert.equal(capsule.lastUserText, "what changed in src/index.ts?");
	assert.equal(capsule.lastAssistantText, "The bug lives in src/index.ts.");
	assert.deepEqual(capsule.toolSummary, ["read: ok - src/index.ts"]);
	const serialized = serializeAsideCapsule(capsule, "why?");
	assert.ok(!serialized.includes("older answer"));
	assert.ok(!serialized.includes("hidden"));
	assert.ok(!serialized.includes("ignored payload"));
	assert.ok(!serialized.includes("very large raw tool output"));
});

test("buildAsideCapsule falls back to minimal when recent turn exceeds budget", async () => {
	const { buildAsideCapsule } = await loadCapsuleModule();
	const hugeText = "A".repeat(4000);
	const branch: SessionEntry[] = [
		messageEntry("1", null, { role: "user", content: hugeText }),
		messageEntry("2", "1", {
			role: "assistant",
			content: [{ type: "text", text: hugeText }],
			stopReason: "stop",
		}),
	];

	const capsule = buildAsideCapsule(
		{
			cwd: "/repo/project",
			editorText: "editor draft",
			branch,
			prompt: "quick question",
		},
		{ tokenCap: 40, maxEditorTokens: 30, maxUserTokens: 500, maxAssistantTokens: 500 },
	);

	assert.equal(capsule.mode, "minimal");
	assert.equal(capsule.lastUserText, undefined);
	assert.equal(capsule.lastAssistantText, undefined);
	assert.equal(capsule.editorDraft, "editor draft");
});

test("buildAsideCapsule uses minimal when there is no completed turn to inherit", async () => {
	const { buildAsideCapsule } = await loadCapsuleModule();
	const capsule = buildAsideCapsule({
		cwd: "/repo/project",
		editorText: "notes",
		branch: [],
		prompt: "what next?",
	});

	assert.equal(capsule.mode, "minimal");
	assert.equal(capsule.editorDraft, "notes");
});

test("resolveAsideModel prefers PI_ASIDE_MODEL override and validates full ids", async () => {
	const { resolveAsideModel } = await loadModelModule();
	const currentModel = { provider: "anthropic", id: "claude-sonnet" } as any;
	const overrideModel = { provider: "openrouter", id: "google/gemini-2.5-flash" } as any;
	const modelRegistry = {
		find(provider: string, modelId: string) {
			if (provider === "openrouter" && modelId === "google/gemini-2.5-flash") return overrideModel;
			return undefined;
		},
	};

	const resolved = resolveAsideModel({
		overrideId: "openrouter/google/gemini-2.5-flash",
		currentModel,
		modelRegistry,
	});
	assert.equal(resolved.ok, true);
	if (resolved.ok) {
		assert.equal(resolved.model, overrideModel);
		assert.equal(resolved.source, "override");
	}

	const invalid = resolveAsideModel({ overrideId: "not-a-full-id", currentModel, modelRegistry });
	assert.equal(invalid.ok, false);
	if (!invalid.ok) {
		assert.match(invalid.error, /full model id/);
	}

	const fallback = resolveAsideModel({ currentModel, modelRegistry });
	assert.equal(fallback.ok, true);
	if (fallback.ok) {
		assert.equal(fallback.model, currentModel);
		assert.equal(fallback.source, "current");
	}
});

test("model helpers expose stable labels", async () => {
	const { describeAsideModelSelection, splitFullModelId } = await loadModelModule();
	assert.deepEqual(splitFullModelId("provider/model/name"), {
		provider: "provider",
		modelId: "model/name",
	});
	assert.equal(describeAsideModelSelection({ currentModel: { id: "x" } as any }), "current");
	assert.equal(describeAsideModelSelection({ overrideId: "provider/model" }), "provider/model");
	assert.equal(describeAsideModelSelection({}), "unavailable");
});

test("aside editor initialization tolerates setText firing onChange during constructor-time setup", async () => {
	const { initializeAsideEditor } = await loadEditorModule();
	let editorText = "";
	const state = {
		draft: "why did that fail?",
		notice: undefined as string | undefined,
		error: undefined as string | undefined,
		refreshed: 0,
		submitted: 0,
	};
	const editor = {
		focused: false,
		onChange: undefined as ((text: string) => void) | undefined,
		onSubmit: undefined as ((...args: any[]) => void) | undefined,
		handleInput() {},
		setText(text: string) {
			editorText = text;
			this.onChange?.(text);
		},
		getExpandedText() {
			return editorText;
		},
		render() {
			return [editorText];
		},
		invalidate() {},
	};

	initializeAsideEditor({
		editor,
		initialDraft: state.draft,
		onDraftChange: (text: string) => {
			state.draft = text;
			state.notice = undefined;
			state.error = undefined;
			state.refreshed += 1;
		},
		onSubmit: () => {
			state.submitted += 1;
		},
	});

	assert.equal(state.draft, "why did that fail?");
	assert.equal(state.error, undefined);
	assert.equal(state.refreshed, 1);
});

test("resolveAsidePreviewPrompt uses expanded text when editor is available and falls back to raw draft otherwise", async () => {
	const { resolveAsidePreviewPrompt } = await loadEditorModule();
	assert.equal(resolveAsidePreviewPrompt(undefined, "raw draft"), "raw draft");
	assert.equal(
		resolveAsidePreviewPrompt({ getExpandedText() { return "expanded from paste markers"; } }, "raw draft"),
		"expanded from paste markers",
	);
});

test("aside editor initialization forwards submitted text even if editor clears its internal state before onSubmit", async () => {
	const { initializeAsideEditor } = await loadEditorModule();
	let submitted = "";
	let editorText = "";
	const editor = {
		focused: false,
		onChange: undefined as ((text: string) => void) | undefined,
		onSubmit: undefined as ((text: string) => void) | undefined,
		handleInput() {},
		setText(text: string) {
			editorText = text;
			this.onChange?.(text);
		},
		getExpandedText() {
			return editorText;
		},
		render() {
			return [editorText];
		},
		invalidate() {},
		simulateSubmit(text: string) {
			editorText = "";
			this.onChange?.("");
			this.onSubmit?.(text);
		},
	};

	initializeAsideEditor({
		editor,
		initialDraft: "",
		onDraftChange: () => {},
		onSubmit: (text: string) => {
			submitted = text;
		},
	});

	editor.simulateSubmit("why did that fail?");
	assert.equal(submitted, "why did that fail?");
});

test("formatAsidePromotion produces editable marked output", async () => {
	const { formatAsidePromotion } = await loadFormatModule();
	const text = formatAsidePromotion({
		question: "Why did that fail?",
		capsule: {
			mode: "recent-turn",
			projectLabel: "/repo/project",
			approxTokens: 123,
		},
		result: {
			answer: "Because the API key was missing.",
			modelId: "openai/gpt-5",
			elapsedMs: 1800,
		},
	});

	assert.match(text, /^Aside result:/);
	assert.match(text, /Question: Why did that fail\?/);
	assert.match(text, /Context: recent-turn/);
	assert.match(text, /Model: openai\/gpt-5/);
	assert.match(text, /Because the API key was missing\./);
});

test("promotion formatting preserves submitted question even if editor is cleared before insert", async () => {
	const { formatAsidePromotion } = await loadFormatModule();
	const submittedQuestion = "Summarize manual tests in a simple bullet list";
	const clearedEditorDraft = "";
	const text = formatAsidePromotion({
		question: submittedQuestion || clearedEditorDraft,
		capsule: {
			mode: "recent-turn",
			projectLabel: "/repo/project",
			approxTokens: 123,
		},
		result: {
			answer: "- Open /aside\n- Type and submit",
			modelId: "gpt-5.4",
			elapsedMs: 8800,
		},
	});

	assert.match(text, /Question: Summarize manual tests in a simple bullet list/);
	assert.doesNotMatch(text, /^Question:\s*$/m);
});
