import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LMStudioClient } from "@lmstudio/sdk";
import type { ExtensionAPI, ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const CONFIG_PATH = path.join(os.homedir(), ".pi", "agent", "lmstudio-instances.json");
const DEFAULT_INSTANCES = [
  { id: "local", url: "http://127.0.0.1:1234", enabled: true },
];

type JsonRecord = Record<string, unknown>;

type InstanceConfig = {
  id: string;
  url: string;
  enabled?: boolean;
  providerName?: string;
  apiKey?: string;
  timeoutMs?: number;
};

type ModelOverride = Partial<Pick<ProviderModelConfig, "name" | "reasoning" | "contextWindow" | "maxTokens" | "input">>;

type LoadProfile = {
  contextLength?: number;
  gpu?: {
    ratio?: number | "off" | "max";
    numCpuExpertLayersRatio?: number | "off" | "max";
    mainGpu?: number;
    splitStrategy?: string;
    disabledGpus?: number[];
  };
  gpuStrictVramCap?: boolean;
  offloadKVCacheToGpu?: boolean;
  evalBatchSize?: number;
  flashAttention?: boolean;
  keepModelInMemory?: boolean;
  seed?: number;
  useFp16ForKVCache?: boolean;
  tryMmap?: boolean;
  numExperts?: number;
  ttl?: number;
};

type Config = {
  instances: InstanceConfig[];
  modelOverrides?: Record<string, ModelOverride>;
  profiles?: Record<string, LoadProfile>;
  modelProfiles?: Record<string, string>;
};

type ApiV0Model = {
  id: string;
  object?: string;
  type?: string;
  publisher?: string;
  arch?: string;
  compatibility_type?: string;
  quantization?: string;
  state?: string;
  max_context_length?: number;
  loaded_context_length?: number;
  capabilities?: string[];
};

type ApiV0ModelsResponse = { data?: ApiV0Model[] };
type OpenAIModelsResponse = { data?: Array<{ id: string }> };

function resolveValue(value: string | undefined): string | undefined {
  if (!value) return value;
  if (value.startsWith("$")) return process.env[value.slice(1)] ?? value;
  return value;
}

function normalizeId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function providerNameFor(instance: InstanceConfig): string {
  return instance.providerName?.trim() || `lmstudio-${normalizeId(instance.id)}`;
}

function normalizeInstance(instance: InstanceConfig): InstanceConfig {
  return {
    ...instance,
    url: resolveValue(instance.url) ?? instance.url,
    apiKey: resolveValue(instance.apiKey),
  };
}

function readConfig(): Config {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      return { instances: DEFAULT_INSTANCES.map(normalizeInstance) };
    }
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as Config;
    const instances = (parsed.instances?.length ? parsed.instances : DEFAULT_INSTANCES)
      .filter((instance): instance is InstanceConfig => Boolean(instance?.id && instance?.url))
      .map(normalizeInstance);
    return {
      instances,
      modelOverrides: parsed.modelOverrides ?? {},
      profiles: parsed.profiles ?? {},
      modelProfiles: parsed.modelProfiles ?? {},
    };
  } catch (error) {
    console.error(`Failed to read LM Studio config at ${CONFIG_PATH}:`, error);
    return { instances: DEFAULT_INSTANCES.map(normalizeInstance) };
  }
}

function joinUrl(baseUrl: string, suffix: string): string {
  return `${baseUrl.replace(/\/$/, "")}${suffix}`;
}

function toWebsocketUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function looksReasoningModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return ["deepseek-r1", "r1", "qwq", "qwq-", "reason", "reasoning"].some((token) => id.includes(token));
}

function looksVisionModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return ["vision", "vl", "llava", "qwen2.5-vl", "gemma-3"].some((token) => id.includes(token));
}

function inferMaxTokens(contextWindow?: number): number {
  if (!contextWindow || contextWindow <= 0) return 16384;
  return Math.max(4096, Math.min(32768, Math.floor(contextWindow / 4)));
}

async function fetchJson(url: string, timeoutMs: number): Promise<JsonRecord> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return (await response.json()) as JsonRecord;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchModelsForInstance(instance: InstanceConfig, config: Config): Promise<ProviderModelConfig[]> {
  const timeoutMs = instance.timeoutMs ?? 5000;
  const v0Url = joinUrl(instance.url, "/api/v0/models");
  const openAiUrl = joinUrl(instance.url, "/v1/models");

  let models: ApiV0Model[] = [];
  try {
    const payload = (await fetchJson(v0Url, timeoutMs)) as ApiV0ModelsResponse;
    models = (payload.data ?? []).filter((model) => (model.type ?? "llm") === "llm");
  } catch {
    const payload = (await fetchJson(openAiUrl, timeoutMs)) as OpenAIModelsResponse;
    models = (payload.data ?? []).map((model) => ({ id: model.id }));
  }

  const overrides = config.modelOverrides ?? {};

  return models.map((model) => {
    const override = overrides[model.id] ?? {};
    const contextWindow = override.contextWindow ?? model.loaded_context_length ?? model.max_context_length ?? 128000;
    const input = override.input ?? (looksVisionModel(model.id) ? (["text", "image"] as const) : (["text"] as const));
    return {
      id: model.id,
      name: override.name ?? `${model.id} - ${instance.id}`,
      reasoning: override.reasoning ?? looksReasoningModel(model.id),
      input: [...input],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow,
      maxTokens: override.maxTokens ?? inferMaxTokens(contextWindow),
      compat: {
        supportsDeveloperRole: false,
        supportsReasoningEffort: false,
      },
    } satisfies ProviderModelConfig;
  });
}

function summarizeModels(models: ProviderModelConfig[]): string {
  if (models.length === 0) return "none";
  return models.map((model) => model.id).join(", ");
}

function getInstance(config: Config, id: string): InstanceConfig {
  const instance = config.instances.find((item) => item.id === id || providerNameFor(item) === id);
  if (!instance) throw new Error(`Unknown LM Studio instance: ${id}`);
  if (instance.enabled === false) throw new Error(`LM Studio instance is disabled: ${id}`);
  return instance;
}

function resolveLoadConfig(config: Config, model: string, profile?: string): { loadConfig?: JsonRecord; ttl?: number; profileName?: string } {
  const profileName = profile || config.modelProfiles?.[model];
  if (!profileName) return {};
  const selected = config.profiles?.[profileName];
  if (!selected) throw new Error(`Unknown LM Studio profile: ${profileName}`);
  const { ttl, ...loadConfig } = selected;
  return {
    loadConfig: Object.keys(loadConfig).length ? (loadConfig as JsonRecord) : undefined,
    ttl,
    profileName,
  };
}

async function withClient<T>(instance: InstanceConfig, fn: (client: LMStudioClient) => Promise<T>): Promise<T> {
  const client = new LMStudioClient({ baseUrl: toWebsocketUrl(instance.url) });
  try {
    return await fn(client);
  } finally {
    await client[Symbol.asyncDispose]().catch(() => undefined);
  }
}

async function listLoadedModels(instance: InstanceConfig): Promise<Array<{ identifier: string; path: string; contextLength?: number }>> {
  return withClient(instance, async (client) => {
    const loaded = await client.llm.listLoaded();
    return await Promise.all(
      loaded.map(async (model: any) => {
        const info = await model.getModelInfo();
        return {
          identifier: info.identifier,
          path: info.path,
          contextLength: info.contextLength,
        };
      }),
    );
  });
}

async function loadModel(instance: InstanceConfig, config: Config, model: string, profile?: string, identifier?: string): Promise<JsonRecord> {
  const resolved = resolveLoadConfig(config, model, profile);
  return withClient(instance, async (client) => {
    const loaded: any = await client.llm.load(model, {
      identifier,
      config: resolved.loadConfig as any,
      ttl: resolved.ttl,
      verbose: false,
    });
    const info = await loaded.getModelInfo();
    return {
      identifier: info.identifier,
      path: info.path,
      contextLength: info.contextLength,
      maxContextLength: info.maxContextLength,
      profile: resolved.profileName ?? null,
      ttl: resolved.ttl ?? null,
    };
  });
}

async function unloadModel(instance: InstanceConfig, identifier: string): Promise<void> {
  return withClient(instance, async (client) => {
    await client.llm.unload(identifier);
  });
}

function desiredContextLength(config: Config, model: string): number | undefined {
  const profileName = config.modelProfiles?.[model];
  if (!profileName) return undefined;
  return config.profiles?.[profileName]?.contextLength;
}

async function ensureDesiredModelState(instance: InstanceConfig, config: Config, model: string): Promise<boolean> {
  const profileName = config.modelProfiles?.[model];
  if (!profileName) return false;
  const wantContextLength = desiredContextLength(config, model);
  const loaded = await listLoadedModels(instance);
  const current = loaded.find((entry) => entry.identifier === model);
  if (current && (!wantContextLength || current.contextLength === wantContextLength)) {
    return false;
  }
  if (current) {
    await unloadModel(instance, current.identifier);
  }
  await loadModel(instance, config, model, profileName, model);
  return true;
}

function parseArgs(rawArgs: string): string[] {
  return rawArgs.trim().split(/\s+/).filter(Boolean);
}

function footerStatus(config: Config): string | undefined {
  const enabledCount = config.instances.filter((item) => item.enabled !== false).length;
  return enabledCount > 0 ? `lms (${enabledCount})` : undefined;
}

export function buildProviderRegistration(
  instance: InstanceConfig,
  models: ProviderModelConfig[],
  refreshModels: () => Promise<ProviderModelConfig[]>,
) {
  return {
    name: `LM Studio ${instance.id}`,
    baseUrl: joinUrl(instance.url, "/v1"),
    api: "openai-completions" as const,
    apiKey: instance.apiKey ?? "lmstudio",
    models,
    refreshModels,
  };
}

export default async function (pi: ExtensionAPI) {
  let config = readConfig();
  const providerModels = new Map<string, ProviderModelConfig[]>();
  const registeredProviders = new Set<string>();
  let refreshInFlight: Promise<string[]> | null = null;

  async function discoverProviderModels(
    instance: InstanceConfig,
    nextConfig: Config,
  ): Promise<ProviderModelConfig[]> {
    const providerName = providerNameFor(instance);
    const models = await fetchModelsForInstance(instance, nextConfig).catch(() => []);
    providerModels.set(providerName, models);
    return models;
  }

  async function refreshProviderModels(providerName: string): Promise<ProviderModelConfig[]> {
    const nextConfig = readConfig();
    config = nextConfig;
    const instance = nextConfig.instances.find(
      (item) => item.enabled !== false && providerNameFor(item) === providerName,
    );
    if (!instance) {
      providerModels.delete(providerName);
      return [];
    }
    return discoverProviderModels(instance, nextConfig);
  }

  function registerInstance(instance: InstanceConfig, models: ProviderModelConfig[]): void {
    const providerName = providerNameFor(instance);
    pi.registerProvider(
      providerName,
      buildProviderRegistration(
        instance,
        models,
        () => refreshProviderModels(providerName),
      ),
    );
    registeredProviders.add(providerName);
  }

  function syncProviderRegistrations(nextConfig: Config): InstanceConfig[] {
    const enabled = nextConfig.instances.filter((item) => item.enabled !== false);
    const desiredProviders = new Set(enabled.map(providerNameFor));
    for (const providerName of registeredProviders) {
      if (desiredProviders.has(providerName)) continue;
      pi.unregisterProvider(providerName);
      providerModels.delete(providerName);
      registeredProviders.delete(providerName);
    }
    for (const instance of enabled) {
      const providerName = providerNameFor(instance);
      registerInstance(instance, providerModels.get(providerName) ?? []);
    }
    config = nextConfig;
    return enabled;
  }

  function refreshInBackground(onComplete?: () => void): void {
    void refreshAll()
      .then(() => {
        onComplete?.();
      })
      .catch(() => undefined);
  }

  async function refreshProvidersOnce(): Promise<string[]> {
    const nextConfig = readConfig();
    const enabled = syncProviderRegistrations(nextConfig);
    await Promise.all(
      enabled.map(async (instance) => {
        const models = await discoverProviderModels(instance, nextConfig);
        registerInstance(instance, models);
      }),
    );
    return enabled.map(providerNameFor);
  }

  async function refreshAll(): Promise<string[]> {
    if (!refreshInFlight) {
      refreshInFlight = refreshProvidersOnce().finally(() => {
        refreshInFlight = null;
      });
    }
    return refreshInFlight;
  }

  // Register configured provider identities during extension load so Pi's
  // native model refresh can discover them even before a session starts.
  syncProviderRegistrations(config);

  pi.on("session_start", async (_event, ctx) => {
    config = readConfig();
    ctx.ui.setStatus("30-lms", footerStatus(config));
    refreshInBackground(() => {
      ctx.ui.setStatus("30-lms", footerStatus(config));
    });
  });

  pi.registerCommand("lmstudio-status", {
    description: "Show configured LM Studio instances and discovered models",
    handler: async (_args, ctx) => {
      try {
        config = readConfig();
        await refreshAll();
        const lines = config.instances.map((instance) => {
          const providerName = providerNameFor(instance);
          const models = providerModels.get(providerName) ?? [];
          return `${instance.id} | ${providerName} | ${instance.url} | models: ${summarizeModels(models)}`;
        });
        ctx.ui.notify(lines.join("\n"), "info");
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });

  pi.registerCommand("lmstudio-refresh", {
    description: "Reload LM Studio instance config and rediscover models",
    handler: async (_args, ctx) => {
      try {
        const registered = await refreshAll();
        ctx.ui.setStatus("30-lms", footerStatus(config));
        ctx.ui.notify(`Refreshed LM Studio providers: ${registered.join(", ")}`, "info");
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });

  pi.registerCommand("lmstudio-load", {
    description: "Load a model on an LM Studio instance: /lmstudio-load <instance> <model> [profile] [identifier]",
    handler: async (args, ctx) => {
      try {
        const [instanceId, model, profile, identifier] = parseArgs(args);
        if (!instanceId || !model) {
          ctx.ui.notify("Usage: /lmstudio-load <instance> <model> [profile] [identifier]", "error");
          return;
        }
        config = readConfig();
        const instance = getInstance(config, instanceId);
        const result = await loadModel(instance, config, model, profile, identifier);
        await refreshAll();
        ctx.ui.setStatus("30-lms", footerStatus(config));
        ctx.ui.notify(`Loaded ${model} on ${instance.id}: ${JSON.stringify(result)}`, "info");
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });

  pi.registerCommand("lmstudio-unload", {
    description: "Unload a model from an LM Studio instance: /lmstudio-unload <instance> <identifier>",
    handler: async (args, ctx) => {
      try {
        const [instanceId, identifier] = parseArgs(args);
        if (!instanceId || !identifier) {
          ctx.ui.notify("Usage: /lmstudio-unload <instance> <identifier>", "error");
          return;
        }
        config = readConfig();
        const instance = getInstance(config, instanceId);
        await unloadModel(instance, identifier);
        await refreshAll();
        ctx.ui.setStatus("30-lms", footerStatus(config));
        ctx.ui.notify(`Unloaded ${identifier} from ${instance.id}`, "info");
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });

  async function maybePrepareModel(provider: string, modelId: string, notify?: (message: string) => void): Promise<void> {
    config = readConfig();
    const instance = config.instances.find((item) => providerNameFor(item) === provider);
    if (!instance) return;
    const changed = await ensureDesiredModelState(instance, config, modelId);
    if (changed) {
      await refreshAll();
      const profileName = config.modelProfiles?.[modelId];
      notify?.(`Prepared ${provider}/${modelId} with profile ${profileName}`);
    }
  }

  pi.on("model_select", async (event, ctx) => {
    try {
      await maybePrepareModel(event.model.provider, event.model.id, (message) => ctx.ui.notify(message, "info"));
      ctx.ui.setStatus("30-lms", footerStatus(config));
    } catch (error) {
      ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
    }
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    if (!ctx.model) return;
    try {
      await maybePrepareModel(ctx.model.provider, ctx.model.id);
    } catch (error) {
      return {
        message: {
          customType: "lmstudio-error",
          content: error instanceof Error ? error.message : String(error),
          display: true,
        },
      };
    }
  });

  pi.registerTool({
    name: "lmstudio_control",
    label: "LM Studio Control",
    description: "Inspect, refresh, load, and unload models across configured LM Studio instances.",
    promptSnippet: "Control configured LM Studio instances: inspect discovered models, refresh provider discovery, and load or unload models.",
    promptGuidelines: [
      "Use lmstudio_control when the user asks to inspect LM Studio instances, refresh discovered models, or load or unload a model on a configured LM Studio host.",
    ],
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("list_instances"),
        Type.Literal("list_loaded"),
        Type.Literal("refresh"),
        Type.Literal("load"),
        Type.Literal("unload"),
      ]),
      instance: Type.Optional(Type.String({ description: "Configured instance id or provider name" })),
      model: Type.Optional(Type.String({ description: "Model id to load" })),
      profile: Type.Optional(Type.String({ description: "Optional load profile name" })),
      identifier: Type.Optional(Type.String({ description: "Optional loaded model identifier, or identifier to unload" })),
    }),
    async execute(_toolCallId, params) {
      config = readConfig();
      if (params.action === "refresh") {
        const registered = await refreshAll();
        return {
          content: [{ type: "text", text: `Refreshed LM Studio providers: ${registered.join(", ")}` }],
          details: { providers: registered },
        };
      }

      if (params.action === "list_instances") {
        const instances = config.instances.filter((item) => item.enabled !== false).map((instance) => {
          const providerName = providerNameFor(instance);
          return {
            id: instance.id,
            providerName,
            url: instance.url,
            models: (providerModels.get(providerName) ?? []).map((model) => model.id),
          };
        });
        return {
          content: [{ type: "text", text: JSON.stringify(instances, null, 2) }],
          details: { instances },
        };
      }

      if (!params.instance) {
        throw new Error("instance is required for this lmstudio_control action");
      }
      const instance = getInstance(config, params.instance);

      if (params.action === "list_loaded") {
        const loaded = await listLoadedModels(instance);
        return {
          content: [{ type: "text", text: JSON.stringify(loaded, null, 2) }],
          details: { loaded },
        };
      }

      if (params.action === "load") {
        if (!params.model) throw new Error("model is required for load");
        const result = await loadModel(instance, config, params.model, params.profile, params.identifier);
        await refreshAll();
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          details: result,
        };
      }

      if (params.action === "unload") {
        if (!params.identifier) throw new Error("identifier is required for unload");
        await unloadModel(instance, params.identifier);
        await refreshAll();
        return {
          content: [{ type: "text", text: `Unloaded ${params.identifier} from ${instance.id}` }],
          details: { instance: instance.id, identifier: params.identifier },
        };
      }

      throw new Error(`Unsupported lmstudio_control action: ${params.action}`);
    },
  });
}
