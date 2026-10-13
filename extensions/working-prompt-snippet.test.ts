import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

async function registerBeforeAgentStart() {
	const { default: workingPromptSnippet } = await import(new URL("./working-prompt-snippet.ts", import.meta.url).href);
	let handler: ((event: any, ctx: any) => Promise<void>) | undefined;
	workingPromptSnippet({
		on(name: string, candidate: typeof handler) {
			if (name === "before_agent_start") handler = candidate;
		},
	} as unknown as ExtensionAPI);
	assert.ok(handler);
	return handler;
}

test("shows a scrubbed snippet for user-started runs", async () => {
	const messages: (string | undefined)[] = [];
	await (await registerBeforeAgentStart())(
		{ messageType: "user", prompt: "Review token=secret-value now" },
		{ hasUI: true, ui: { setWorkingMessage: (message?: string) => messages.push(message) } },
	);
	assert.deepEqual(messages, ["Working... Review token=[REDACTED] now"]);
});

test("uses the default working message for custom-started runs", async () => {
	const messages: (string | undefined)[] = [];
	await (await registerBeforeAgentStart())(
		{ messageType: "custom", message: { customType: "test", content: "continue", display: false } },
		{ hasUI: true, ui: { setWorkingMessage: (message?: string) => messages.push(message) } },
	);
	assert.deepEqual(messages, [undefined]);
});
