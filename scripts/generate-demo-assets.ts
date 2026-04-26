import * as fs from "node:fs";
import * as path from "node:path";
import { chromium } from "playwright";
import { Theme, type ThemeColor } from "@mariozechner/pi-coding-agent";
import { renderSessionNotesPanelSnapshot } from "../extensions/session-notes";
import { SESSION_NOTES_PANEL_WIDTH, sessionNotesPanelFixture } from "../demo-fixtures/session-notes-panel";

type ThemeBg = "selectedBg" | "userMessageBg" | "customMessageBg" | "toolPendingBg" | "toolSuccessBg" | "toolErrorBg";

const OUTPUT_PATH = path.resolve(process.cwd(), "public/session-notes-panel-screenshot.png");
const PAGE_BACKGROUND = "#f8f8f8";
const CARD_BACKGROUND = "#ffffff";
const FONT_STACK = '"SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
const FONT_SIZE = 16;
const LINE_HEIGHT = 1.45;
const OUTER_PADDING = 28;
const INNER_PADDING = 20;
const BORDER_RADIUS = 16;
const BOX_SHADOW = "0 10px 30px rgba(63, 71, 83, 0.12)";

function createLightTheme(): Theme {
	const fgColors: Record<ThemeColor, string | number> = {
		accent: "#5a8080",
		border: "#547da7",
		borderAccent: "#5a8080",
		borderMuted: "#b0b0b0",
		success: "#588458",
		error: "#aa5555",
		warning: "#9a7326",
		muted: "#6c6c6c",
		dim: "#767676",
		text: "",
		thinkingText: "#6c6c6c",
		userMessageText: "",
		customMessageText: "",
		customMessageLabel: "#7e57c2",
		toolTitle: "",
		toolOutput: "#6c6c6c",
		mdHeading: "#9a7326",
		mdLink: "#547da7",
		mdLinkUrl: "#767676",
		mdCode: "#5a8080",
		mdCodeBlock: "#588458",
		mdCodeBlockBorder: "#6c6c6c",
		mdQuote: "#6c6c6c",
		mdQuoteBorder: "#6c6c6c",
		mdHr: "#6c6c6c",
		mdListBullet: "#588458",
		toolDiffAdded: "#588458",
		toolDiffRemoved: "#aa5555",
		toolDiffContext: "#6c6c6c",
		syntaxComment: "#008000",
		syntaxKeyword: "#0000FF",
		syntaxFunction: "#795E26",
		syntaxVariable: "#001080",
		syntaxString: "#A31515",
		syntaxNumber: "#098658",
		syntaxType: "#267F99",
		syntaxOperator: "#000000",
		syntaxPunctuation: "#000000",
		thinkingOff: "#b0b0b0",
		thinkingMinimal: "#767676",
		thinkingLow: "#547da7",
		thinkingMedium: "#5a8080",
		thinkingHigh: "#875f87",
		thinkingXhigh: "#8b008b",
		bashMode: "#588458",
	};

	const bgColors: Record<ThemeBg, string | number> = {
		selectedBg: "#d0d0e0",
		userMessageBg: "#e8e8e8",
		customMessageBg: "#ede7f6",
		toolPendingBg: "#e8e8f0",
		toolSuccessBg: "#e8f0e8",
		toolErrorBg: "#f0e8e8",
	};

	return new Theme(fgColors, bgColors, "truecolor", { name: "light" });
}

type AnsiStyle = {
	fg?: string;
	bg?: string;
	bold?: boolean;
};

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/\"/g, "&quot;")
		.replace(/ /g, "&nbsp;");
}

function cloneStyle(style: AnsiStyle): AnsiStyle {
	return { ...style };
}

function rgbFrom256(code: number): string {
	if (code < 16) {
		const palette = [
			"#000000", "#800000", "#008000", "#808000", "#000080", "#800080", "#008080", "#c0c0c0",
			"#808080", "#ff0000", "#00ff00", "#ffff00", "#0000ff", "#ff00ff", "#00ffff", "#ffffff",
		];
		return palette[code] ?? "#000000";
	}
	if (code >= 232) {
		const value = (code - 232) * 10 + 8;
		return `rgb(${value}, ${value}, ${value})`;
	}
	const n = code - 16;
	const r = Math.floor(n / 36);
	const g = Math.floor((n % 36) / 6);
	const b = n % 6;
	const channel = (value: number) => (value === 0 ? 0 : value * 40 + 55);
	return `rgb(${channel(r)}, ${channel(g)}, ${channel(b)})`;
}

function applySgrCodes(style: AnsiStyle, rawCodes: string): AnsiStyle {
	const next = cloneStyle(style);
	const codes = rawCodes.length === 0 ? [0] : rawCodes.split(";").map((code) => Number(code));

	for (let index = 0; index < codes.length; index++) {
		const code = codes[index];
		if (Number.isNaN(code)) continue;
		switch (code) {
			case 0:
				next.fg = undefined;
				next.bg = undefined;
				next.bold = false;
				break;
			case 1:
				next.bold = true;
				break;
			case 22:
				next.bold = false;
				break;
			case 39:
				next.fg = undefined;
				break;
			case 49:
				next.bg = undefined;
				break;
			default:
				if (code >= 30 && code <= 37) {
					next.fg = rgbFrom256(code - 30);
					break;
				}
				if (code >= 40 && code <= 47) {
					next.bg = rgbFrom256(code - 40);
					break;
				}
				if (code === 38 || code === 48) {
					const target = code === 38 ? "fg" : "bg";
					const mode = codes[index + 1];
					if (mode === 2 && codes.length >= index + 4) {
						const r = codes[index + 2];
						const g = codes[index + 3];
						const b = codes[index + 4];
						next[target] = `rgb(${r}, ${g}, ${b})`;
						index += 4;
						break;
					}
					if (mode === 5 && codes.length >= index + 2) {
						next[target] = rgbFrom256(codes[index + 2] ?? 0);
						index += 2;
					}
				}
		}
	}

	return next;
}

function styleToCss(style: AnsiStyle): string {
	const css: string[] = [];
	if (style.fg) css.push(`color:${style.fg}`);
	if (style.bg) css.push(`background-color:${style.bg}`);
	if (style.bold) css.push("font-weight:700");
		return css.join(";");
}

function ansiLineToHtml(line: string): string {
	const pattern = /\u001b\[([0-9;]*)m/g;
	let cursor = 0;
	let match: RegExpExecArray | null;
	let style: AnsiStyle = {};
	let html = "";

	while ((match = pattern.exec(line)) !== null) {
		const [token, codes] = match;
		const text = line.slice(cursor, match.index);
		if (text) {
			const css = styleToCss(style);
			html += css ? `<span style="${css}">${escapeHtml(text)}</span>` : `<span>${escapeHtml(text)}</span>`;
		}
		style = applySgrCodes(style, codes ?? "");
		cursor = match.index + token.length;
	}

	const tail = line.slice(cursor);
	if (tail) {
		const css = styleToCss(style);
		html += css ? `<span style="${css}">${escapeHtml(tail)}</span>` : `<span>${escapeHtml(tail)}</span>`;
	}

	return html || "&nbsp;";
}

function resolveChromePath(): string | undefined {
	if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;

	for (const candidate of [
		"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		"/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
		"/usr/bin/google-chrome-stable",
		"/usr/bin/google-chrome",
		"/usr/bin/chromium-browser",
		"/usr/bin/chromium",
	]) {
		if (fs.existsSync(candidate)) return candidate;
	}

	return undefined;
}

function buildHtml(lines: string[]): string {
	const lineMarkup = lines
		.map((line) => `<div class="line">${ansiLineToHtml(line)}</div>`)
		.join("\n");

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  :root {
    color-scheme: light;
  }
  * {
    box-sizing: border-box;
  }
  body {
    margin: 0;
    background: ${PAGE_BACKGROUND};
    padding: ${OUTER_PADDING}px;
    font-family: ${FONT_STACK};
  }
  .frame {
    display: inline-block;
    background: ${CARD_BACKGROUND};
    border-radius: ${BORDER_RADIUS}px;
    box-shadow: ${BOX_SHADOW};
    padding: ${INNER_PADDING}px;
  }
  .capture {
    display: inline-block;
    white-space: nowrap;
    font-family: ${FONT_STACK};
    font-size: ${FONT_SIZE}px;
    line-height: ${LINE_HEIGHT};
    font-variant-ligatures: none;
    text-rendering: geometricPrecision;
  }
  .line {
    min-height: ${Math.ceil(FONT_SIZE * LINE_HEIGHT)}px;
  }
</style>
</head>
<body>
  <div class="frame">
    <div id="capture" class="capture">${lineMarkup}</div>
  </div>
</body>
</html>`;
}

async function screenshotHtml(html: string, outputPath: string): Promise<void> {
	const executablePath = resolveChromePath();
	const browser = await chromium.launch({
		headless: true,
		...(executablePath ? { executablePath, args: ["--no-sandbox", "--disable-setuid-sandbox"] } : {}),
	});

	try {
		const context = await browser.newContext({
			viewport: { width: 2200, height: 1400 },
			deviceScaleFactor: 2,
		});
		const page = await context.newPage();
		await page.setContent(html, { waitUntil: "load" });
		const capture = page.locator("#capture");
		await capture.screenshot({ path: outputPath });
		await context.close();
	} finally {
		await browser.close();
	}
}

async function main(): Promise<void> {
	const theme = createLightTheme();
	const lines = renderSessionNotesPanelSnapshot(theme, sessionNotesPanelFixture, SESSION_NOTES_PANEL_WIDTH);
	const html = buildHtml(lines);
	fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
	await screenshotHtml(html, OUTPUT_PATH);
	console.log(`Generated ${path.relative(process.cwd(), OUTPUT_PATH)}`);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
});
