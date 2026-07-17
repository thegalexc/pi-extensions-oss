import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

async function loadModule() {
  return import(new URL("./index.ts", import.meta.url).href);
}

test("buildProviderRegistration exposes native model refresh", async () => {
  const { buildProviderRegistration, providerNameFor } = await loadModule();
  const instance = {
    id: "macllm",
    url: "http://macllm:1234",
    apiKey: "local-key",
  };
  const initialModels = [{ id: "initial" }] as any[];
  const refreshedModels = [{ id: "refreshed" }] as any[];
  let refreshCalls = 0;

  const registration = buildProviderRegistration(
    instance,
    initialModels,
    async (context: { allowNetwork: boolean }) => {
      assert.equal(context.allowNetwork, true);
      refreshCalls += 1;
      return refreshedModels;
    },
  );

  assert.equal(providerNameFor(instance), "lmstudio-macllm");
  assert.equal(registration.name, "LM Studio macllm");
  assert.equal(registration.baseUrl, "http://macllm:1234/v1");
  assert.equal(registration.api, "openai-completions");
  assert.equal(registration.apiKey, "local-key");
  assert.equal(registration.models, initialModels);
  assert.equal(await registration.refreshModels({ allowNetwork: true } as any), refreshedModels);
  assert.equal(refreshCalls, 1);
});

test("extension load registers providers for native refresh and removes disabled providers", async () => {
  const { default: extension } = await loadModule();
  const originalExistsSync = fs.existsSync;
  const originalReadFileSync = fs.readFileSync;
  const originalFetch = globalThis.fetch;
  let enabled = true;
  const providerCalls: Array<{ name: string; config: any }> = [];
  const unregistered: string[] = [];
  const commands = new Map<string, any>();
  let fetchCalls = 0;
  const fetchSignals: AbortSignal[] = [];

  fs.existsSync = (() => true) as typeof fs.existsSync;
  fs.readFileSync = (() => JSON.stringify({
    instances: [{ id: "test", url: "http://lmstudio.test:1234", enabled }],
  })) as unknown as typeof fs.readFileSync;
  globalThis.fetch = (async (_input, init) => {
    fetchCalls += 1;
    if (init?.signal) fetchSignals.push(init.signal);
    if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return new Response(JSON.stringify({
      data: [{ id: "model-a", type: "llm", max_context_length: 32768 }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const pi = {
    registerProvider(name: string, config: any) {
      providerCalls.push({ name, config });
    },
    unregisterProvider(name: string) {
      unregistered.push(name);
    },
    registerCommand(name: string, config: any) {
      commands.set(name, config);
    },
    registerTool() {},
    on() {},
  } as any;

  try {
    await extension(pi);
    assert.equal(providerCalls.length, 1);
    assert.equal(providerCalls[0].name, "lmstudio-test");
    assert.deepEqual(providerCalls[0].config.models, []);

    const cached = await providerCalls[0].config.refreshModels({ allowNetwork: false });
    assert.deepEqual(cached, []);
    assert.equal(fetchCalls, 0);

    const controller = new AbortController();
    const refreshed = await providerCalls[0].config.refreshModels({
      allowNetwork: true,
      signal: controller.signal,
    });
    assert.deepEqual(refreshed.map((model: any) => model.id), ["model-a"]);
    assert.equal(fetchCalls, 1);
    assert.equal(fetchSignals.length, 1);

    controller.abort();
    const afterAbort = await providerCalls[0].config.refreshModels({
      allowNetwork: true,
      signal: controller.signal,
    });
    assert.deepEqual(afterAbort.map((model: any) => model.id), ["model-a"]);
    assert.equal(fetchCalls, 2);
    assert.equal(fetchSignals[1].aborted, true);

    enabled = false;
    await commands.get("lmstudio-refresh").handler("", {
      ui: { setStatus() {}, notify() {} },
    });
    assert.deepEqual(unregistered, ["lmstudio-test"]);
  } finally {
    fs.existsSync = originalExistsSync;
    fs.readFileSync = originalReadFileSync;
    globalThis.fetch = originalFetch;
  }
});
