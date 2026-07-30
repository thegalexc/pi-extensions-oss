/**
 * browser-screenshot
 *
 * Self-contained Playwright-backed `screenshot` tool for Pi.
 *
 * Includes three behaviors in one extension:
 * - registers the `screenshot` tool
 * - clamps risky captures to avoid oversized image dimensions
 * - sanitizes malformed image blocks in tool results
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentToolResult, AgentToolUpdateCallback } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import { Type, type Static } from "typebox";

const MAX_SAFE_HEIGHT = 7500;
const DEFAULT_VIEWPORT_HEIGHT = 900;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const ParamsSchema = Type.Object({
  url: Type.String({
    description: "URL to screenshot (must include protocol, e.g. https://)",
  }),
  outputPath: Type.String({
    description:
      "File path to save the PNG screenshot (relative paths resolved from cwd)",
  }),
  width: Type.Optional(
    Type.Number({
      description: "Viewport width in pixels. Default: 1280",
      default: 1280,
    }),
  ),
  height: Type.Optional(
    Type.Number({
      description:
        "Viewport height in pixels. Only used when fullPage is false. Default: 900",
      default: 900,
    }),
  ),
  fullPage: Type.Optional(
    Type.Boolean({
      description:
        "Capture full scrollable page (true) or just the viewport (false). Default: true",
      default: true,
    }),
  ),
});

type Params = Static<typeof ParamsSchema>;

function resolveChromePath(): string | undefined {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;

  const macChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  if (fs.existsSync(macChrome)) return macChrome;

  for (const candidate of [
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ]) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return undefined;
}

export default function browserScreenshotExtension(pi: ExtensionAPI) {
  const clamped = new Map<string, number>();

  pi.on("tool_call", async (event) => {
    if (event.toolName !== "screenshot") return;

    const input = event.input as Record<string, unknown>;
    const rawHeight = input.height;
    const numericHeight =
      typeof rawHeight === "number"
        ? rawHeight
        : typeof rawHeight === "string" && rawHeight !== ""
          ? Number(rawHeight)
          : undefined;

    const isFullPageExplicitlyFalse = input.fullPage === false;
    const heightTooTall =
      numericHeight !== undefined &&
      !Number.isNaN(numericHeight) &&
      numericHeight > MAX_SAFE_HEIGHT;

    if (isFullPageExplicitlyFalse && !heightTooTall) return;

    let effectiveHeight: number;
    if (heightTooTall || numericHeight === undefined) {
      effectiveHeight = DEFAULT_VIEWPORT_HEIGHT;
      input.height = DEFAULT_VIEWPORT_HEIGHT;
    } else {
      effectiveHeight = numericHeight;
      input.height = numericHeight;
    }

    if (!isFullPageExplicitlyFalse) {
      input.fullPage = false;
    }

    clamped.set(event.toolCallId, effectiveHeight);
  });

  pi.on("tool_result", async (event) => {
    let sanitizedContent = event.content;
    let modified = false;

    if (Array.isArray(event.content)) {
      sanitizedContent = event.content.map((block) => {
        if (block.type !== "image") return block;

        const img = block as ImageContent & Record<string, unknown>;
        if (typeof img.mimeType === "string" && typeof img.data === "string") {
          return block;
        }

        const source = (img as any).source;
        if (source && typeof source.media_type === "string" && typeof source.data === "string") {
          modified = true;
          return {
            type: "image" as const,
            mimeType: source.media_type,
            data: source.data,
          };
        }

        modified = true;
        return {
          type: "text" as const,
          text: `[Image content block from tool "${event.toolName}" was malformed and has been removed to prevent session corruption. Missing mimeType or data fields.]`,
        };
      });
    }

    if (event.toolName !== "screenshot") {
      return modified ? { content: sanitizedContent as (TextContent | ImageContent)[] } : undefined;
    }

    const effectiveHeight = clamped.get(event.toolCallId);
    if (effectiveHeight === undefined) {
      return modified ? { content: sanitizedContent as (TextContent | ImageContent)[] } : undefined;
    }

    clamped.delete(event.toolCallId);

    const note = [
      "[browser-screenshot] The screenshot call was modified to avoid exceeding common model image dimension limits.",
      `Captured at viewport size (height ${effectiveHeight}px) instead of full-page.`,
      "To capture a specific section, navigate to a URL anchor (#section) or call screenshot with fullPage=false and your desired height.",
    ].join(" ");

    return {
      content: [
        ...(Array.isArray(sanitizedContent) ? sanitizedContent : []),
        { type: "text" as const, text: note },
      ],
    };
  });

  const clearClamped = () => clamped.clear();
  pi.on("session_end" as any, clearClamped);
  pi.on("session_start", async () => clearClamped());
  pi.on("session_tree" as any, clearClamped);

  pi.registerTool({
    name: "screenshot",
    label: "Screenshot",
    description:
      "Capture a web page as a PNG screenshot at a specific viewport width. Returns the image for vision model analysis. Uses headless Chromium via Playwright.",
    promptSnippet:
      "Capture a web page screenshot at a specific viewport width for visual analysis",
    promptGuidelines: [
      "Always include the protocol in URLs (https:// or http://).",
      "Output path should end in .png. Parent directories are created automatically.",
      "Full-page captures may be clamped to viewport-only mode to avoid oversized images.",
      "Width defaults to 1280px. Common breakpoints: 640, 768, 1024, 1280, 1536.",
      "The screenshot is returned as an image attachment when size limits allow; otherwise the file is still saved to disk.",
    ],
    parameters: ParamsSchema,

    async execute(
      _toolCallId: string,
      params: Params,
      signal: AbortSignal | undefined,
      _onUpdate: AgentToolUpdateCallback | undefined,
      ctx: ExtensionContext,
    ): Promise<AgentToolResult<unknown>> {
      const width = params.width ?? 1280;
      const height = params.height ?? DEFAULT_VIEWPORT_HEIGHT;
      const fullPage = params.fullPage ?? true;
      const url = params.url;

      const outputPath = path.isAbsolute(params.outputPath)
        ? params.outputPath
        : path.resolve(ctx.cwd, params.outputPath);

      const outputDir = path.dirname(outputPath);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }

      try {
        const { chromium } = await import("playwright");
        const chromiumPath = resolveChromePath();
        const browser = await chromium.launch({
          headless: true,
          ...(chromiumPath && {
            executablePath: chromiumPath,
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
          }),
        });

        try {
          const context = await browser.newContext({
            viewport: { width, height },
            userAgent:
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          });

          const page = await context.newPage();
          await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 30_000,
          });

          await page.waitForTimeout(1000);

          if (fullPage) {
            await Promise.race([
              page.evaluate(async () => {
                await new Promise<void>((resolve) => {
                  const step = Math.floor(window.innerHeight * 0.8) || 200;
                  let lastHeight = 0;
                  let stalledFor = 0;

                  const tick = setInterval(() => {
                    window.scrollBy(0, step);
                    const currentHeight = document.body.scrollHeight;
                    const atBottom =
                      window.scrollY + window.innerHeight >= currentHeight - 2;

                    if (currentHeight === lastHeight) {
                      stalledFor++;
                    } else {
                      stalledFor = 0;
                      lastHeight = currentHeight;
                    }

                    if (atBottom && stalledFor >= 2) {
                      clearInterval(tick);
                      window.scrollTo(0, 0);
                      resolve();
                    }
                  }, 200);
                });
              }),
              new Promise<void>((_, reject) =>
                setTimeout(() => reject(new Error("scroll-settle timeout")), 15_000),
              ),
            ]).catch(() => {
              // Continue with whatever content rendered.
            });

            await page.waitForTimeout(500);
          } else {
            await page.waitForTimeout(1000);
          }

          await page.screenshot({
            path: outputPath,
            fullPage,
          });

          await context.close();

          const imageBuffer = fs.readFileSync(outputPath);
          const sizeKB = Math.round(imageBuffer.length / 1024);
          const modeLabel = fullPage ? "full-page" : `viewport (${height}px)`;

          if (imageBuffer.length > MAX_IMAGE_BYTES) {
            return {
              content: [
                {
                  type: "text",
                  text: `Screenshot saved: ${outputPath} (${width}x${modeLabel}, ${sizeKB}KB) - image too large to inline (${sizeKB}KB > ${MAX_IMAGE_BYTES / 1024}KB limit). File saved to disk; use the read tool to view it.`,
                },
              ],
              details: {
                outputPath,
                width,
                height,
                fullPage,
                url,
                sizeBytes: imageBuffer.length,
                truncated: true,
              },
            };
          }

          return {
            content: [
              {
                type: "text",
                text: `Screenshot saved: ${outputPath} (${width}x${modeLabel}, ${sizeKB}KB)`,
              },
              {
                type: "image",
                mimeType: "image/png",
                data: imageBuffer.toString("base64"),
              },
            ],
            details: {
              outputPath,
              width,
              height,
              fullPage,
              url,
              sizeBytes: imageBuffer.length,
            },
          };
        } finally {
          await browser.close();
        }
      } catch (err: unknown) {
        if (signal?.aborted) {
          return {
            content: [{ type: "text", text: "Screenshot cancelled" }],
            details: { cancelled: true },
          };
        }

        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text",
              text: `Screenshot failed: ${msg}`,
            },
          ],
          details: { error: msg },
        };
      }
    },
  });
}
