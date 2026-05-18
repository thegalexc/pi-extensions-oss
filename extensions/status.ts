/**
 * OSS package status indicator
 *
 * Shows the loaded pi-extensions-oss package version in Pi's footer status area.
 */

import { createRequire } from "module";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		ctx.ui.setStatus("40-oss", `oss v${pkg.version}`);
	});
}
