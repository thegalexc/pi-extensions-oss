import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { runPluckCommand } from "./pluck.js";

export default function pluckExtension(pi: ExtensionAPI) {
	pi.registerCommand("pluck", {
		description: "Browse and import focused context from another persisted Pi session by exact session id from /session",
		handler: async (args, ctx) => {
			await runPluckCommand(pi, ctx, args);
		},
	});
}
