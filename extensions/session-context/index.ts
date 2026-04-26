import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { runSessionContextCommand } from "./session-context.js";

export default function sessionContextExtension(pi: ExtensionAPI) {
	pi.registerCommand("session-context", {
		description: "Browse and import focused context from another persisted Pi session by exact session id from /session",
		handler: async (args, ctx) => {
			await runSessionContextCommand(pi, ctx, args);
		},
	});
}
