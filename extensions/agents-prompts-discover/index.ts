import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export function discoverAgentsPromptPaths(cwd: string): string[] {
	const paths = [
		resolve(cwd, ".agents", "prompts"),
		join(homedir(), ".agents", "prompts"),
	];
	const seen = new Set<string>();
	const discovered: string[] = [];

	for (const path of paths) {
		if (!existsSync(path)) continue;
		if (seen.has(path)) continue;
		seen.add(path);
		discovered.push(path);
	}

	return discovered;
}

export default function agentsPromptsDiscoverExtension(pi: ExtensionAPI) {
	pi.on("resources_discover", async (event) => {
		const promptPaths = discoverAgentsPromptPaths(event.cwd);
		if (promptPaths.length === 0) {
			return {};
		}
		return { promptPaths };
	});
}
