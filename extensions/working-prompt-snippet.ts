import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MAX_SNIPPET_LENGTH = 48;
const REDACTION_TOKEN = "[REDACTED]";
const SENSITIVE_PREFIXES = ["/login", "/auth", "/oauth", "/password", "/secret", "/token", "/key"];
const HIDE_IF_CONTAINS = ["-----begin", "aws_secret_access_key", "private key"];

function scrubSnippet(text: string): string {
	return text
		.replace(/\b(bearer)\s+[a-z0-9._\-+/=]+/gi, `$1 ${REDACTION_TOKEN}`)
		.replace(/\b(api[ _-]?key|access[ _-]?token|refresh[ _-]?token|client[ _-]?secret|password|passwd|pwd|secret|token)\b\s*[:=]\s*("[^"]*"|'[^']*'|\S+)/gi, (_match, label: string) => `${label}=${REDACTION_TOKEN}`)
		.replace(/\b(sk-ant-[a-z0-9_-]+|sk-proj-[a-z0-9_-]+|sk-[a-z0-9_-]{12,}|ghp_[a-z0-9]{20,}|github_pat_[a-z0-9_]+|xox[baprs]-[a-z0-9-]+|akia[0-9a-z]{16}|asia[0-9a-z]{16})\b/gi, REDACTION_TOKEN);
}

function buildSnippet(prompt: string): string | undefined {
	const oneLine = prompt.replace(/\s+/g, " ").trim();
	if (!oneLine) return undefined;
	const lower = oneLine.toLowerCase();
	if (SENSITIVE_PREFIXES.some((prefix) => lower.startsWith(prefix))) return undefined;
	if (HIDE_IF_CONTAINS.some((marker) => lower.includes(marker))) return undefined;
	const scrubbed = scrubSnippet(oneLine);
	if (scrubbed.length <= MAX_SNIPPET_LENGTH) return scrubbed;
	return `${scrubbed.slice(0, MAX_SNIPPET_LENGTH)}...`;
}

export default function workingPromptSnippet(pi: ExtensionAPI) {
	pi.on("before_agent_start", async (event, ctx) => {
		if (!ctx.hasUI) return;
		const snippet = buildSnippet(event.prompt);
		if (!snippet) {
			ctx.ui.setWorkingMessage();
			return;
		}
		ctx.ui.setWorkingMessage(`Working... ${snippet}`);
	});

	pi.on("agent_settled", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		ctx.ui.setWorkingMessage();
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		ctx.ui.setWorkingMessage();
	});
}
