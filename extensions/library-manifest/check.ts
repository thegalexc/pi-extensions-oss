import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { LibraryManifestRef, ManifestIssue, ParsedManifest } from "./manifest.js";

export type RefStatus = "installed-local" | "installed-global" | "missing" | "repo-authored-collision" | "legacy-present";

export interface RefCheckResult {
	ref: LibraryManifestRef;
	status: RefStatus;
	path?: string;
}

export interface LibraryManifestCheckResult {
	manifestPath: string;
	results: RefCheckResult[];
	issues: ManifestIssue[];
}

export function checkLibraryManifest(cwd: string, manifest: ParsedManifest): LibraryManifestCheckResult {
	const results = manifest.refs.map((ref) => classifyRef(cwd, ref));
	return {
		manifestPath: manifest.manifestPath,
		results,
		issues: manifest.issues,
	};
}

export function classifyRef(cwd: string, ref: LibraryManifestRef): RefCheckResult {
	const repoAuthoredPath = repoAuthoredPathForRef(cwd, ref);
	if (repoAuthoredPath && existsSync(repoAuthoredPath)) {
		return { ref, status: "repo-authored-collision", path: repoAuthoredPath };
	}

	const localPath = localInstalledPath(cwd, ref);
	if (existsSync(localPath)) {
		return { ref, status: "installed-local", path: localPath };
	}

	const globalPath = globalInstalledPath(ref);
	if (existsSync(globalPath)) {
		return { ref, status: "installed-global", path: globalPath };
	}

	const legacyPath = legacyInstalledPath(ref);
	if (legacyPath && existsSync(legacyPath)) {
		return { ref, status: "legacy-present", path: legacyPath };
	}

	return { ref, status: "missing" };
}

export function localInstalledPath(cwd: string, ref: LibraryManifestRef): string {
	switch (ref.type) {
		case "skill":
			return join(cwd, ".agents", "skills", ref.name, "SKILL.md");
		case "agent":
			return join(cwd, ".agents", "agents", ref.name, "AGENT.md");
		case "prompt":
			return join(cwd, ".agents", "prompts", `${ref.name}.md`);
	}
}

export function globalInstalledPath(ref: LibraryManifestRef): string {
	switch (ref.type) {
		case "skill":
			return join(homedir(), ".agents", "skills", ref.name, "SKILL.md");
		case "agent":
			return join(homedir(), ".agents", "agents", ref.name, "AGENT.md");
		case "prompt":
			return join(homedir(), ".agents", "prompts", `${ref.name}.md`);
	}
}

export function repoAuthoredPathForRef(cwd: string, ref: LibraryManifestRef): string | null {
	switch (ref.type) {
		case "skill":
			return join(cwd, ".pi", "skills", ref.name, "SKILL.md");
		case "agent":
			return join(cwd, ".pi", "agents", ref.name, "AGENT.md");
		case "prompt":
			return join(cwd, ".pi", "prompts", `${ref.name}.md`);
	}
}

export function legacyInstalledPath(ref: LibraryManifestRef): string | null {
	if (ref.type !== "agent") return null;
	return join(homedir(), ".pi", "agent", "agents", ref.name, "AGENT.md");
}

export function getIssueCount(result: LibraryManifestCheckResult): number {
	return result.issues.length + result.results.filter((item) => item.status !== "installed-local" && item.status !== "installed-global").length;
}
