import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const LIBRARY_CLI_PATH = join(homedir(), ".agents", "skills", "library", "bin", "library.py");

export interface HydrateRunResult {
	ok: boolean;
	stdout: string;
	stderr: string;
	command: string[];
	error?: string;
}

export function getLibraryCliPath(): string {
	return LIBRARY_CLI_PATH;
}

export function libraryCliExists(): boolean {
	return existsSync(LIBRARY_CLI_PATH);
}

export async function runLibraryHydrate(projectRoot: string): Promise<HydrateRunResult> {
	const command = ["python3", LIBRARY_CLI_PATH, "hydrate", "--project-root", projectRoot];
	if (!libraryCliExists()) {
		return {
			ok: false,
			stdout: "",
			stderr: `Library CLI not found at ${LIBRARY_CLI_PATH}`,
			command,
			error: "missing_cli",
		};
	}

	try {
		const { stdout, stderr } = await execFileAsync(command[0], command.slice(1), {
			cwd: projectRoot,
			maxBuffer: 1024 * 1024,
		});
		return {
			ok: true,
			stdout,
			stderr,
			command,
		};
	} catch (error: any) {
		return {
			ok: false,
			stdout: typeof error?.stdout === "string" ? error.stdout : "",
			stderr: typeof error?.stderr === "string" && error.stderr.trim().length > 0 ? error.stderr : String(error?.message ?? error),
			command,
			error: "hydrate_failed",
		};
	}
}
