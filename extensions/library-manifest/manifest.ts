import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type LibraryRefType = "skill" | "agent" | "prompt";

export interface LibraryManifestRef {
	type: LibraryRefType;
	name: string;
	raw: string;
}

export interface ManifestIssue {
	kind: "manifest-error";
	message: string;
	line?: number;
}

export interface ParsedManifest {
	manifestPath: string;
	refs: LibraryManifestRef[];
	issues: ManifestIssue[];
}

export function findLibraryManifest(cwd: string): string | null {
	const manifestPath = join(cwd, ".pi", "library-manifest.yaml");
	return existsSync(manifestPath) ? manifestPath : null;
}

export function loadLibraryManifest(cwd: string): ParsedManifest | null {
	const manifestPath = findLibraryManifest(cwd);
	if (!manifestPath) return null;
	const text = readFileSync(manifestPath, "utf-8");
	return parseLibraryManifest(text, manifestPath);
}

export function parseLibraryManifest(text: string, manifestPath = ".pi/library-manifest.yaml"): ParsedManifest {
	const issues: ManifestIssue[] = [];
	const refs: LibraryManifestRef[] = [];
	const seen = new Set<string>();
	const lines = text.split(/\r?\n/);
	let inRequired = false;
	let sawRequired = false;

	for (let index = 0; index < lines.length; index += 1) {
		const rawLine = lines[index] ?? "";
		const lineNumber = index + 1;
		const trimmed = rawLine.trim();

		if (!trimmed || trimmed.startsWith("#")) continue;

		if (!rawLine.startsWith(" ") && !rawLine.startsWith("\t") && trimmed.endsWith(":")) {
			const key = trimmed.slice(0, -1).trim();
			inRequired = key === "required";
			if (inRequired) sawRequired = true;
			continue;
		}

		if (!inRequired) continue;

		const itemMatch = rawLine.match(/^\s+-\s+(.+)$/);
		if (!itemMatch) {
			issues.push({
				kind: "manifest-error",
				message: `unsupported manifest entry under required: ${trimmed}`,
				line: lineNumber,
			});
			continue;
		}

		const refText = stripWrappingQuotes(itemMatch[1].trim());
		const parsed = parseManifestRef(refText, lineNumber);
		if ("issue" in parsed) {
			issues.push(parsed.issue);
			continue;
		}
		const dedupeKey = `${parsed.ref.type}:${parsed.ref.name}`;
		if (seen.has(dedupeKey)) continue;
		seen.add(dedupeKey);
		refs.push(parsed.ref);
	}

	if (!sawRequired) {
		issues.push({
			kind: "manifest-error",
			message: "manifest must contain a top-level required: list",
		});
	}

	return { manifestPath, refs, issues };
}

function stripWrappingQuotes(value: string): string {
	if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
		return value.slice(1, -1);
	}
	return value;
}

function parseManifestRef(raw: string, line: number): { ref: LibraryManifestRef } | { issue: ManifestIssue } {
	const parts = raw.split(":");
	if (parts.length < 2) {
		return {
			issue: {
				kind: "manifest-error",
				message: `invalid ref ${JSON.stringify(raw)}. Use type:name such as skill:wrapup`,
				line,
			},
		};
	}

	const type = parts.shift()?.trim();
	const name = parts.join(":").trim();
	if (!type || !name) {
		return {
			issue: {
				kind: "manifest-error",
				message: `invalid ref ${JSON.stringify(raw)}. Use type:name such as skill:wrapup`,
				line,
			},
		};
	}
	if (type !== "skill" && type !== "agent" && type !== "prompt") {
		return {
			issue: {
				kind: "manifest-error",
				message: `unknown ref type ${JSON.stringify(type)} in ${JSON.stringify(raw)}. Valid types: skill, agent, prompt`,
				line,
			},
		};
	}

	return {
		ref: {
			type,
			name,
			raw: `${type}:${name}`,
		},
	};
}
