import type { LibraryManifestCheckResult, RefCheckResult } from "./check.js";

export function formatStartupWarning(result: LibraryManifestCheckResult): string {
	const missing = filterByStatus(result, "missing");
	const collisions = filterByStatus(result, "repo-authored-collision");
	const legacy = filterByStatus(result, "legacy-present");
	const parts: string[] = [];

	if (missing.length > 0) parts.push(`${missing.length} missing`);
	if (collisions.length > 0) parts.push(`${collisions.length} repo-owned collision${collisions.length === 1 ? "" : "s"}`);
	if (legacy.length > 0) parts.push(`${legacy.length} legacy install${legacy.length === 1 ? "" : "s"}`);
	if (result.issues.length > 0) parts.push(`${result.issues.length} manifest issue${result.issues.length === 1 ? "" : "s"}`);

	return [
		"Library manifest issues for this repo:",
		parts.join(", ") || "issues detected",
		"Run /library-check for details.",
		"Run /library-hydrate to install missing artifacts.",
	].join("\n");
}

export function formatCheckReport(result: LibraryManifestCheckResult, cwd: string): string {
	const sections: string[] = [`Library manifest check: ${result.manifestPath}`];
	appendSection(sections, "Installed locally", filterByStatus(result, "installed-local"), true);
	appendSection(sections, "Installed globally", filterByStatus(result, "installed-global"), true);
	appendSection(sections, "Missing", filterByStatus(result, "missing"), true);
	appendSection(sections, "Repo-authored collisions", filterByStatus(result, "repo-authored-collision"), true);
	appendSection(sections, "Legacy installs", filterByStatus(result, "legacy-present"), true);

	if (result.issues.length > 0) {
		sections.push("", "Manifest issues");
		for (const issue of result.issues) {
			const line = issue.line != null ? ` (line ${issue.line})` : "";
			sections.push(`- ${issue.message}${line}`);
		}
	}

	if (hasActionableIssues(result)) {
		sections.push(
			"",
			"Fix",
			"- /library-hydrate",
			`- or: python3 ~/.agents/skills/library/bin/library.py hydrate --project-root ${JSON.stringify(cwd)}`,
		);
	} else {
		sections.push("", "Status", "- healthy");
	}

	return sections.join("\n");
}

function hasActionableIssues(result: LibraryManifestCheckResult): boolean {
	return result.issues.length > 0 || result.results.some((item) => item.status !== "installed-local" && item.status !== "installed-global");
}

export function formatHydrateResult(stdout: string, stderr: string): string {
	const lines = [stdout.trim(), stderr.trim()].filter(Boolean);
	return lines.length > 0 ? lines.join("\n") : "Hydration completed.";
}

function appendSection(sections: string[], title: string, items: RefCheckResult[], includePath: boolean) {
	if (items.length === 0) return;
	sections.push("", title);
	for (const item of items) {
		const path = includePath && item.path ? ` -> ${item.path}` : "";
		sections.push(`- ${item.ref.raw}${path}`);
	}
}

function filterByStatus(result: LibraryManifestCheckResult, status: RefCheckResult["status"]): RefCheckResult[] {
	return result.results.filter((item) => item.status === status);
}
