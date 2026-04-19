import type { AsideCapsule } from "./capsule.js";

export interface AsideResult {
	answer: string;
	modelId: string;
	elapsedMs: number;
	outputTokens?: number;
}

export function formatAsidePromotion(input: {
	question: string;
	capsule: AsideCapsule;
	result: AsideResult;
}): string {
	const lines = [
		"Aside result:",
		`Question: ${input.question.trim()}`,
		`Context: ${input.capsule.mode}`,
		`Model: ${input.result.modelId}`,
		`Elapsed: ${formatElapsed(input.result.elapsedMs)}`,
		"",
		input.result.answer.trim(),
		"",
	];

	return lines.join("\n");
}

export function formatElapsed(elapsedMs: number): string {
	if (elapsedMs < 1000) return `${elapsedMs}ms`;
	return `${(elapsedMs / 1000).toFixed(elapsedMs < 10_000 ? 1 : 0)}s`;
}
