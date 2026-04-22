/**
 * Zellij diagnostics for screenshots-picker.
 *
 * Provides a small command-driven lab to isolate which rendering path breaks
 * inside Zellij: text-only baseline, Image component rendering, manual inline
 * image sequences, and cursor-up placement without images.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import {
	Image,
	Key,
	calculateImageRows,
	deleteKittyImage,
	encodeITerm2,
	encodeKitty,
	getCapabilities,
	getCellDimensions,
	getImageDimensions,
	matchesKey,
	truncateToWidth,
	visibleWidth,
} from "@mariozechner/pi-tui";
import { globSync } from "glob";

interface ScreenshotInfo {
	path: string;
	name: string;
	mtime: Date;
	size: number;
}

interface Config {
	sources?: string[];
}

const SCREENSHOT_PATTERNS = [
	/^Screenshot\s/i,
	/^CleanShot\s/i,
	/^Capture\s/i,
	/^Scherm/i,
	/^Bildschirmfoto/i,
	/^Captura\s/i,
	/^Istantanea/i,
	/^screenshot/i,
	/^\d{4}-\d{2}-\d{2}[_-]\d{2}[_-]\d{2}/i,
	/^flameshot/i,
	/^spectacle/i,
	/^scrot/i,
	/^maim/i,
	/^grim/i,
];

const IMAGE_ID = 424242;

function expandPath(path: string): string {
	if (path.startsWith("~/")) {
		return join(homedir(), path.slice(2));
	}
	return path;
}

function isGlobPattern(pattern: string): boolean {
	return /[*?[\]{}!]/.test(pattern);
}

function isScreenshotName(name: string): boolean {
	return SCREENSHOT_PATTERNS.some((pattern) => pattern.test(name));
}

function getDefaultScreenshotDir(): string {
	if (process.platform === "darwin") {
		try {
			const result = execSync("defaults read com.apple.screencapture location 2>/dev/null", {
				encoding: "utf-8",
			}).trim();
			if (result && existsSync(result)) return result;
		} catch {
			// Ignore and fall back.
		}
		return join(homedir(), "Desktop");
	}

	return join(homedir(), "Desktop");
}

function loadConfig(): Config {
	const settingsPath = join(homedir(), ".pi", "agent", "settings.json");
	if (!existsSync(settingsPath)) return {};

	try {
		const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
		return settings["pi-screenshots"] || {};
	} catch {
		return {};
	}
}

function getScreenshotsFromDirectory(directory: string): ScreenshotInfo[] {
	if (!existsSync(directory)) return [];

	return readdirSync(directory)
		.filter((name) => name.toLowerCase().endsWith(".png") && isScreenshotName(name))
		.map((name) => {
			const path = join(directory, name);
			try {
				const stats = statSync(path);
				return { path, name, mtime: stats.mtime, size: stats.size };
			} catch {
				return null;
			}
		})
		.filter((file): file is ScreenshotInfo => file !== null);
}

function getScreenshotsFromGlob(pattern: string): ScreenshotInfo[] {
	try {
		return globSync(expandPath(pattern), { nodir: true })
			.filter((path) => /\.(png|jpe?g|webp)$/i.test(path))
			.map((path) => {
				try {
					const stats = statSync(path);
					return { path: resolve(path), name: basename(path), mtime: stats.mtime, size: stats.size };
				} catch {
					return null;
				}
			})
			.filter((file): file is ScreenshotInfo => file !== null);
	} catch {
		return [];
	}
}

function getScreenshotsFromSource(source: string): ScreenshotInfo[] {
	const expanded = expandPath(source);
	return isGlobPattern(expanded) ? getScreenshotsFromGlob(expanded) : getScreenshotsFromDirectory(expanded);
}

function getLatestScreenshots(limit = 6): ScreenshotInfo[] {
	const config = loadConfig();
	const sources = config.sources && config.sources.length > 0
		? [...config.sources]
		: [process.env.PI_SCREENSHOTS_DIR || getDefaultScreenshotDir()];

	const all = sources.flatMap((source) => getScreenshotsFromSource(source));
	all.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
	return all.slice(0, limit);
}

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRelativeTime(date: Date): string {
	const diffMs = Date.now() - date.getTime();
	const mins = Math.floor(diffMs / 60000);
	const hours = Math.floor(mins / 60);
	const days = Math.floor(hours / 24);
	if (days > 0) return days === 1 ? "1 day ago" : `${days} days ago`;
	if (hours > 0) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
	if (mins > 0) return mins === 1 ? "1 minute ago" : `${mins} minutes ago`;
	return "just now";
}

function loadImageBase64(path: string): { data: string; mimeType: string } {
	const buffer = readFileSync(path);
	const lower = path.toLowerCase();
	let mimeType = "image/png";
	if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) mimeType = "image/jpeg";
	else if (lower.endsWith(".webp")) mimeType = "image/webp";
	return { data: buffer.toString("base64"), mimeType };
}

function safeVisibleWidth(str: string): number {
	return Math.max(0, visibleWidth(str));
}

function padToWidth(str: string, width: number): string {
	const pad = Math.max(0, width - safeVisibleWidth(str));
	return str + " ".repeat(pad);
}

function buildEnvSummary(): string[] {
	const caps = getCapabilities();
	const dims = getCellDimensions();
	return [
		`TERM=${process.env.TERM || ""}`,
		`TERM_PROGRAM=${process.env.TERM_PROGRAM || ""}`,
		`COLORTERM=${process.env.COLORTERM || ""}`,
		`ZELLIJ=${process.env.ZELLIJ ? "1" : ""}`,
		`TMUX=${process.env.TMUX ? "1" : ""}`,
		`caps.images=${caps.images || "null"}`,
		`cell=${dims.widthPx}x${dims.heightPx}`,
	];
}

function getSourceHint(screenshot: ScreenshotInfo | null): string {
	if (!screenshot) return "No screenshot loaded";
	return dirname(screenshot.path).slice(-70);
}

function renderManualImage(
	image: { data: string; mimeType: string },
	theme: Theme,
	width: number,
	maxRows: number,
): string[] {
	const caps = getCapabilities();
	const dims = getCellDimensions();
	const imageComponent = new Image(image.data, image.mimeType, { fallbackColor: (s) => theme.fg("dim", s) });
	const imageId = IMAGE_ID;

	if (!caps.images) {
		const fallback = imageComponent.render(width);
		return [theme.fg("dim", "No inline image capability detected."), ...fallback].slice(0, maxRows);
	}

	const imageDims = getImageDimensions(image.data, image.mimeType) || { widthPx: 800, heightPx: 600 };
	const maxWidthCells = Math.max(8, Math.min(60, width - 4));
	const rows = Math.max(1, Math.min(maxRows, calculateImageRows(imageDims, maxWidthCells, dims)));
	let sequence = "";

	if (caps.images === "kitty") {
		sequence = encodeKitty(image.data, { columns: maxWidthCells, rows, imageId });
	} else if (caps.images === "iterm2") {
		sequence = encodeITerm2(image.data, { width: maxWidthCells, height: rows, preserveAspectRatio: true });
	}

	if (!sequence) {
		return [theme.fg("dim", "Inline image sequence unavailable."), ...Array(Math.max(0, maxRows - 1)).fill("")];
	}

	const moveUp = rows > 1 ? `\x1b[${rows - 1}A` : "";
	const lines: string[] = [];
	for (let i = 0; i < rows - 1; i++) lines.push("");
	lines.push(moveUp + sequence);
	for (let i = rows; i < maxRows; i++) lines.push("");
	return lines;
}

function renderCursorUpMarker(theme: Theme, maxRows: number): string[] {
	const rows = Math.max(3, Math.min(maxRows, 8));
	const moveUp = rows > 1 ? `\x1b[${rows - 1}A` : "";
	const lines: string[] = [];
	for (let i = 0; i < rows - 1; i++) lines.push("");
	lines.push(moveUp + theme.fg("accent", "[cursor-up marker landed here]"));
	for (let i = rows; i < maxRows; i++) lines.push("");
	return lines;
}

export default function screenshotsPickerZellijLab(pi: ExtensionAPI) {
	pi.registerCommand("ss-zellij-lab", {
		description: "Open the screenshots-picker Zellij diagnostics lab",
		handler: async (_args, ctx) => {
			const screenshots = getLatestScreenshots(6);
			const activeScreenshot = screenshots[0] || null;

			if (!activeScreenshot) {
				ctx.ui.notify("No screenshots found for diagnostics", "warning");
				return;
			}

			const image = loadImageBase64(activeScreenshot.path);
			const envLines = buildEnvSummary();
			const diagnostics = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
				let mode = 1;
				let renderTick = 0;
				let lastWidth = 100;
				let deleteCount = 0;

				const imageTheme = {
					fallbackColor: (s: string) => theme.fg("dim", s),
				};

				function footerText(): string {
					return "1 baseline • 2 Image • 3 manual inline • 4 cursor-up • r rerender • d delete kitty image • esc close";
				}

				function modeLabel(): string {
					if (mode === 1) return "baseline text-only";
					if (mode === 2) return "Image component";
					if (mode === 3) return "manual inline sequence";
					return "cursor-up marker";
				}

				return {
					render(width: number) {
						lastWidth = width;
						const lines: string[] = [];
						const border = theme.fg("accent", "─".repeat(width));
						const previewRows = Math.max(8, Math.min(16, (process.stdout.rows || 40) - 16));
						const listWidth = Math.max(36, Math.min(52, Math.floor(width * 0.42)));
						const previewWidth = Math.max(12, width - listWidth - 3);

						lines.push(border);
						lines.push(truncateToWidth(` ${theme.fg("accent", theme.bold("Zellij Screenshot Lab"))} ${theme.fg("dim", `mode=${modeLabel()} tick=${renderTick} deletes=${deleteCount}`)}`, width));
						lines.push(truncateToWidth(` ${theme.fg("dim", getSourceHint(activeScreenshot))}`, width));
						lines.push(border);
						lines.push(truncateToWidth(` ${theme.fg("warning", "Environment")}`, width));
						lines.push(truncateToWidth(` ${theme.fg("dim", envLines.join("  •  "))}`, width));
						lines.push("");

						const listHeader = padToWidth(` ${theme.fg("warning", "Recent screenshots")}`, listWidth);
						lines.push(listHeader + "│ " + theme.fg("warning", "Preview pane"));

						let previewLines: string[] = [];
						if (mode === 1) {
							previewLines = [
								theme.fg("dim", "Text baseline only. If this breaks, images are not the cause."),
								theme.fg("dim", "Use this to compare against the image modes below."),
							];
						} else if (mode === 2) {
							const img = new Image(image.data, image.mimeType, imageTheme, {
								maxWidthCells: Math.max(8, Math.min(60, previewWidth - 2)),
								imageId: IMAGE_ID,
							});
							previewLines = img.render(previewWidth);
						} else if (mode === 3) {
							previewLines = renderManualImage(image, theme, previewWidth, previewRows);
						} else {
							previewLines = renderCursorUpMarker(theme, previewRows);
						}

						for (let i = 0; i < previewRows; i++) {
							const shot = screenshots[i];
							let left = "";
							if (shot) {
								const marker = i === 0 ? theme.fg("accent", "▸") : theme.fg("dim", " ");
								left = `${marker} ${shot.name} (${formatRelativeTime(shot.mtime)}, ${formatSize(shot.size)})`;
								left = i === 0 ? theme.fg("accent", left) : theme.fg("text", left);
							}
							const padded = padToWidth(truncateToWidth(left, listWidth), listWidth);
							const right = previewLines[i] || "";
							lines.push(padded + "│ " + right);
						}

						lines.push("");
						if (mode === 2) {
							lines.push(truncateToWidth(` ${theme.fg("dim", "Mode 2 uses pi-tui Image.render() which itself reserves rows and emits cursor-up + image sequence.")}`, width));
						} else if (mode === 3) {
							lines.push(truncateToWidth(` ${theme.fg("dim", "Mode 3 manually emits the inline image protocol with the same blank-lines + cursor-up pattern.")}`, width));
						} else if (mode === 4) {
							lines.push(truncateToWidth(` ${theme.fg("dim", "Mode 4 isolates cursor-up placement without any image protocol.")}`, width));
						} else {
							lines.push(truncateToWidth(` ${theme.fg("dim", "Mode 1 is a pure text baseline. It should remain stable everywhere.")}`, width));
						}
						lines.push(truncateToWidth(` ${theme.fg("dim", footerText())}`, width));
						lines.push(border);
						return lines;
					},
					invalidate() {
						// Stateless renderer.
					},
					handleInput(data: string) {
						if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
							if (getCapabilities().images === "kitty") {
								process.stdout.write(deleteKittyImage(IMAGE_ID));
							}
							done(JSON.stringify({ mode, renderTick, deleteCount, width: lastWidth }));
							return;
						}

						if (data === "1") mode = 1;
						else if (data === "2") mode = 2;
						else if (data === "3") mode = 3;
						else if (data === "4") mode = 4;
						else if (data === "r" || data === "R") renderTick += 1;
						else if ((data === "d" || data === "D") && getCapabilities().images === "kitty") {
							process.stdout.write(deleteKittyImage(IMAGE_ID));
							deleteCount += 1;
						}

						tui.requestRender();
					},
				};
			});

			if (diagnostics) {
				ctx.ui.notify(`Zellij lab closed: ${diagnostics}`, "info");
			}
		},
	});

	pi.registerCommand("ss-zellij-report", {
		description: "Insert a screenshots-picker terminal capability report into the editor",
		handler: async (_args, ctx) => {
			const screenshots = getLatestScreenshots(3);
			const caps = getCapabilities();
			const dims = getCellDimensions();
			const report = [
				"# screenshots-picker Zellij report",
				"",
				`- TERM: ${process.env.TERM || ""}`,
				`- TERM_PROGRAM: ${process.env.TERM_PROGRAM || ""}`,
				`- COLORTERM: ${process.env.COLORTERM || ""}`,
				`- ZELLIJ: ${process.env.ZELLIJ ? "1" : ""}`,
				`- TMUX: ${process.env.TMUX ? "1" : ""}`,
				`- pi-tui images capability: ${caps.images || "null"}`,
				`- cell dimensions: ${dims.widthPx}x${dims.heightPx}`,
				"",
				"## latest screenshots",
				...(screenshots.length > 0
					? screenshots.map((shot) => `- ${shot.name} (${formatRelativeTime(shot.mtime)}, ${formatSize(shot.size)})`)
					: ["- none found"]),
				"",
				"## intended interpretation",
				"- If raw Terminal or Terminal-inside-Zellij is stable, the text fallback path is healthy.",
				"- If Ghostty/iTerm2-inside-Zellij breaks only in image modes, the image branch is the likely fault line.",
				"- Compare lab mode 2 vs 3 vs 4 to isolate Image component vs manual protocol vs cursor-up only.",
			].join("\n");
			ctx.ui.setEditorText(report);
			ctx.ui.notify("Inserted screenshots-picker Zellij report", "info");
		},
	});
}
