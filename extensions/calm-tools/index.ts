import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	createBashTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createReadTool,
	type ExtensionAPI,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";

const SETTINGS_KEY = "calmTools";
const STATUS_KEY = "35-calm-tools";
const DEFAULT_COMPACT_TOOLS = ["read", "grep", "find", "ls"] as const;
const MUTATION_TOOLS = new Set(["edit", "write"]);
const SUPPORTED_TOOLS = new Set(["read", "grep", "find", "ls", "bash"]);

interface CalmToolsConfig {
	enabled?: boolean;
	statusLine?: boolean;
	compactTools?: string[];
	compactBash?: boolean;
}

interface ToolState {
	name: string;
	status: "running" | "success" | "error";
}

type BuiltInTool = Record<string, any>;

type ToolFactory = (cwd: string) => BuiltInTool;

function readConfig(): CalmToolsConfig {
	const settingsPath = join(homedir(), ".pi", "agent", "settings.json");
	if (!existsSync(settingsPath)) return {};
	try {
		const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
		const config = settings[SETTINGS_KEY];
		if (!config || typeof config !== "object" || Array.isArray(config)) return {};
		return config as CalmToolsConfig;
	} catch {
		return {};
	}
}

function getCompactTools(config: CalmToolsConfig): string[] {
	const configured = Array.isArray(config.compactTools) ? config.compactTools : [...DEFAULT_COMPACT_TOOLS];
	const compact = new Set<string>();
	for (const tool of configured) {
		if (typeof tool !== "string") continue;
		if (MUTATION_TOOLS.has(tool)) continue;
		if (tool === "bash" && config.compactBash === false) continue;
		if (SUPPORTED_TOOLS.has(tool)) compact.add(tool);
	}
	if (config.compactBash === true) compact.add("bash");
	return [...compact];
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function firstLine(value: string, max = 96): string {
	const line = value.replace(/\s+/g, " ").trim();
	if (line.length <= max) return line;
	return `${line.slice(0, max - 3)}...`;
}

function summarizeArgs(toolName: string, args: unknown): string {
	const record = asRecord(args);
	switch (toolName) {
		case "read": {
			const path = stringValue(record.path) ?? "file";
			const offset = numberValue(record.offset);
			const limit = numberValue(record.limit);
			const range = offset || limit ? ` ${offset ?? 1}${limit ? `+${limit}` : ""}` : "";
			return `${path}${range}`;
		}
		case "grep": {
			const pattern = stringValue(record.pattern) ?? "pattern";
			const path = stringValue(record.path) ?? ".";
			const glob = stringValue(record.glob);
			return `${JSON.stringify(pattern)} in ${glob ?? path}`;
		}
		case "find": {
			const pattern = stringValue(record.pattern) ?? "pattern";
			const path = stringValue(record.path) ?? ".";
			return `${pattern} in ${path}`;
		}
		case "ls": {
			return stringValue(record.path) ?? ".";
		}
		case "bash": {
			return firstLine(stringValue(record.command) ?? "command");
		}
		default:
			return "";
	}
}

function resultText(result: { content?: Array<{ type?: string; text?: string; mimeType?: string }> }): string {
	const parts: string[] = [];
	for (const block of result.content ?? []) {
		if (block.type === "text") {
			parts.push(block.text ?? "");
		} else if (block.type === "image") {
			parts.push(`[image: ${block.mimeType ?? "unknown"}]`);
		}
	}
	const text = parts.join("\n").trimEnd();
	return text || "(no output)";
}

function statusMark(isError: boolean | undefined, isPartial: boolean, theme: Theme): string {
	if (isPartial) return theme.fg("warning", "…");
	if (isError) return theme.fg("error", "✗");
	return theme.fg("success", "✓");
}

function renderToolCall(toolName: string, args: unknown, theme: Theme): Text {
	const title = theme.fg("toolTitle", theme.bold(`${toolName} `));
	return new Text(title + theme.fg("muted", summarizeArgs(toolName, args)), 0, 0);
}

function renderToolResult(
	toolName: string,
	result: { content?: Array<{ type?: string; text?: string; mimeType?: string }> },
	options: { expanded: boolean; isPartial: boolean },
	theme: Theme,
	context: { args?: unknown; isError?: boolean },
): Text {
	const mark = statusMark(context.isError, options.isPartial, theme);
	const summary = summarizeArgs(toolName, context.args);
	if (!options.expanded) {
		const text = `${theme.fg("toolTitle", toolName)} ${theme.fg("muted", summary)} ${mark}`;
		return new Text(text, 0, 0);
	}

	const header = `${theme.fg("toolTitle", theme.bold(`${toolName} `))}${theme.fg("muted", summary)} ${mark}`;
	return new Text(`${header}\n${theme.fg("toolOutput", resultText(result))}`, 0, 0);
}

function copyToolWithRenderers(factory: ToolFactory, cwd: string) {
	const original = factory(cwd) as BuiltInTool & Record<string, unknown>;
	return {
		...original,
		renderCall(args: unknown, theme: Theme) {
			return renderToolCall(original.name, args, theme);
		},
		renderResult(
			result: { content?: Array<{ type?: string; text?: string; mimeType?: string }> },
			options: { expanded: boolean; isPartial: boolean },
			theme: Theme,
			context: { args?: unknown; isError?: boolean },
		) {
			return renderToolResult(original.name, result, options, theme, context);
		},
	};
}

function updateStatus(ctx: { hasUI: boolean; ui: { setStatus: (key: string, value?: string) => void; theme: Theme } }, states: Map<string, ToolState>) {
	if (!ctx.hasUI) return;
	if (states.size === 0) {
		ctx.ui.setStatus(STATUS_KEY, undefined);
		return;
	}

	const counts = new Map<string, number>();
	let running: string | undefined;
	let errors = 0;
	for (const state of states.values()) {
		counts.set(state.name, (counts.get(state.name) ?? 0) + 1);
		if (state.status === "running") running = state.name;
		if (state.status === "error") errors++;
	}

	const countText = [...counts.entries()].map(([name, count]) => `${name} ${count}`).join(" · ");
	const tail = running ? ` · running ${running}` : errors ? ` · ${errors} error${errors === 1 ? "" : "s"}` : "";
	ctx.ui.setStatus(STATUS_KEY, truncateToWidth(`tools: ${countText}${tail}`, 80));
}

export default function calmTools(pi: ExtensionAPI) {
	const config = readConfig();
	if (config.enabled !== true) return;

	const states = new Map<string, ToolState>();
	const compactTools = getCompactTools(config);
	const factories: Record<string, ToolFactory> = {
		read: createReadTool,
		grep: createGrepTool,
		find: createFindTool,
		ls: createLsTool,
		bash: createBashTool,
	};

	for (const toolName of compactTools) {
		const factory = factories[toolName];
		if (!factory) continue;
		pi.registerTool(copyToolWithRenderers(factory, process.cwd()) as any);
	}

	if (config.statusLine !== false) {
		pi.on("tool_execution_start", async (event, ctx) => {
			states.set(event.toolCallId, { name: event.toolName, status: "running" });
			updateStatus(ctx, states);
		});

		pi.on("tool_execution_update", async (_event, ctx) => {
			updateStatus(ctx, states);
		});

		pi.on("tool_execution_end", async (event, ctx) => {
			states.set(event.toolCallId, { name: event.toolName, status: event.isError ? "error" : "success" });
			updateStatus(ctx, states);
		});

		pi.on("agent_settled", async (_event, ctx) => {
			states.clear();
			updateStatus(ctx, states);
		});

		pi.on("session_shutdown", async (_event, ctx) => {
			states.clear();
			updateStatus(ctx, states);
		});
	}
}
