import type { Model } from "@mariozechner/pi-ai";

export interface AsideModelRegistry {
	find(provider: string, modelId: string): Model<any> | undefined;
}

export type ResolveAsideModelResult =
	| { ok: true; model: Model<any>; source: "override" | "current" }
	| { ok: false; error: string };

export function resolveAsideModel(input: {
	overrideId?: string;
	currentModel?: Model<any>;
	modelRegistry: AsideModelRegistry;
}): ResolveAsideModelResult {
	const overrideId = input.overrideId?.trim();
	if (overrideId) {
		const parsed = splitFullModelId(overrideId);
		if (!parsed) {
			return {
				ok: false,
				error: `PI_ASIDE_MODEL must be a full model id like provider/model-name. Received: ${overrideId}`,
			};
		}
		const model = input.modelRegistry.find(parsed.provider, parsed.modelId);
		if (!model) {
			return {
				ok: false,
				error: `PI_ASIDE_MODEL is set to ${overrideId}, but that model is not available in the current registry.`,
			};
		}
		return { ok: true, model, source: "override" };
	}

	if (input.currentModel) {
		return { ok: true, model: input.currentModel, source: "current" };
	}

	return {
		ok: false,
		error: "No active model is selected and PI_ASIDE_MODEL is not configured.",
	};
}

export function describeAsideModelSelection(input: {
	overrideId?: string;
	currentModel?: Model<any>;
}): string {
	const overrideId = input.overrideId?.trim();
	if (overrideId) return overrideId;
	if (input.currentModel) return "current";
	return "unavailable";
}

export function splitFullModelId(modelId: string): { provider: string; modelId: string } | undefined {
	const trimmed = modelId.trim();
	const slash = trimmed.indexOf("/");
	if (slash <= 0 || slash === trimmed.length - 1) {
		return undefined;
	}
	return {
		provider: trimmed.slice(0, slash),
		modelId: trimmed.slice(slash + 1),
	};
}
