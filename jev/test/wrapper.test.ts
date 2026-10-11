import { describe, expect, test } from "bun:test";
import { parseConfig } from "../src/config";
import { selectModel } from "../src/model-selector";
import { createHandler } from "../src/server";
import type { Fetch } from "../src/llama-swap-client";

const config = () => parseConfig(["--fallback-model", "small", "--timeout-ms", "1000"], {});
const payload = {
  model: "jev-latest", state: "The user requests a directory listing",
  questions: { safe: { type: "noul", instructions: "Is the action read-only?" } },
};
function request(body: unknown = payload, headers: Record<string, string> = {}, signal?: AbortSignal) {
  return new Request("http://localhost/v1/systemone", {
    method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers },
    ...(signal ? { signal } : {}),
  });
}
function completion(content = '{"answers":{"q1":0.9}}') {
  return Response.json({ choices: [{ message: { content } }], usage: { prompt_tokens: 20, completion_tokens: 10 } });
}
const states = (...entries: { model: string; state: string }[]) => Response.json({ running: entries });

describe("configuration", () => {
  test("requires fallback and validates bounds and URL", () => {
    expect(() => parseConfig([], {})).toThrow();
    for (const args of [["--port", "0"], ["--timeout-ms", "NaN"], ["--port", "1.5"], ["--unknown", "x"], ["--llama-swap-url", "file:///tmp/x"]]) {
      expect(() => parseConfig(["--fallback-model", "small", ...args], {})).toThrow();
    }
  });
  test("normalizes /v1 and ignores standalone LocalJev environment", () => {
    const c = parseConfig(["--fallback-model", "small", "--llama-swap-url", "http://localhost:8080/v1/"], {
      LOCALJEV_UPSTREAM_MODEL: "wrong", LOCALJEV_PORT: "bad", JEV_API_KEY: "client", JEV_UPSTREAM_API_KEY: "upstream",
    });
    expect(c.swapUrl).toBe("http://localhost:8080");
    expect(c.settings.apiKey).toBe("client");
    expect(c.settings.upstreamApiKey).toBe("upstream");
    expect(c.settings.port).toBe(8082);
  });
});

describe("selection", () => {
  const choose = (entries: { model: string; state: string }[], preferred: string[] = []) => selectModel(entries, "small", preferred, ["small", "a", "b"]);
  test("fallback only when idle", () => {
    expect(choose([])).toEqual({ kind: "selected", model: "small" });
    expect(() => choose([{ model: "unknown", state: "ready" }])).toThrow();
    expect(() => choose([{ model: "a", state: "stopping" }])).toThrow();
  });
  test("ready models win; preference then stable lexical order", () => {
    const entries = [{ model: "b", state: "ready" }, { model: "a", state: "ready" }];
    expect(choose(entries)).toEqual({ kind: "selected", model: "a" });
    expect(choose(entries, ["b"])).toEqual({ kind: "selected", model: "b" });
    expect(choose([{ model: "a", state: "starting" }, { model: "b", state: "ready" }])).toEqual({ kind: "selected", model: "b" });
  });
  test("waits for supported starting models, not unsupported ones", () => {
    expect(choose([{ model: "a", state: "starting" }])).toEqual({ kind: "wait" });
    expect(() => choose([{ model: "unknown", state: "starting" }])).toThrow();
  });
});

describe("Jev integration with mock llama-swap", () => {
  test("idle requests load fallback through normal completion; preserve protocol", async () => {
    const calls: string[] = [];
    const upstream: Fetch = async (input, init) => {
      const path = new URL(String(input)).pathname;
      calls.push(path);
      if (path === "/running") return states();
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe("small");
      expect(body.chat_template_kwargs.enable_thinking).toBe(false);
      expect(body.response_format.type).toBe("json_schema");
      return completion();
    };
    const response = await createHandler(config(), upstream)(request());
    expect(response.status).toBe(200);
    expect((await response.json()).answers.safe.noul).toBe(0.9);
    expect(response.headers.get("x-typesafe-request-id")).toBeTruthy();
    expect(calls).toEqual(["/running", "/v1/chat/completions"]);
  });
  test("rediscover each decision and route to resident Strata or llama.cpp", async () => {
    let current = "qwen-3.8-27b";
    const used: string[] = [];
    const handler = createHandler(config(), async (input, init) => {
      if (String(input).endsWith("/running")) return states({ model: current, state: "ready" });
      used.push(JSON.parse(String(init?.body)).model);
      return completion();
    });
    expect((await handler(request())).status).toBe(200);
    current = "strata-qwen-3.8-flash-next-coder";
    expect((await handler(request())).status).toBe(200);
    expect(used).toEqual(["qwen-3.8-27b", "strata-qwen-3.8-flash-next-coder"]);
  });
  test("invalid and unauthenticated requests do not discover or load models", async () => {
    let calls = 0;
    const c = config();
    c.settings.apiKey = "secret";
    const handler = createHandler(c, async () => { calls++; return states(); });
    expect((await handler(request())).status).toBe(403);
    expect((await handler(request({}, { authorization: "Bearer secret" }))).status).toBe(422);
    expect((await handler(request({ ...payload, model: "unknown" }, { authorization: "Bearer secret" }))).status).toBe(404);
    expect(calls).toBe(0);
  });
  test("discovery errors and malformed states never fall back", async () => {
    for (const result of [new Response("error", { status: 500 }), Response.json({}), Response.json({ running: [{}] }), states({ model: "other", state: "ready" })]) {
      let calls = 0;
      const response = await createHandler(config(), async () => { calls++; return result; })(request());
      expect(response.status).toBe(503);
      expect(calls).toBe(1);
    }
  });
  test("waits for an existing load without sending a competing completion", async () => {
    let discovery = 0;
    let model = "";
    const response = await createHandler(config(), async (input, init) => {
      if (String(input).endsWith("/running")) return states({ model: "qwen-3.8-27b", state: ++discovery === 1 ? "starting" : "ready" });
      model = JSON.parse(String(init?.body)).model;
      return completion();
    })(request());
    expect(response.status).toBe(200);
    expect(discovery).toBe(2);
    expect(model).toBe("qwen-3.8-27b");
  });
  test("pins selected model across malformed retries", async () => {
    const c = config();
    c.settings.malformedRetries = 1;
    let discoveries = 0;
    const used: string[] = [];
    const response = await createHandler(c, async (input, init) => {
      if (String(input).endsWith("/running")) { discoveries++; return states({ model: "qwen-3.8-27b", state: "ready" }); }
      used.push(JSON.parse(String(init?.body)).model);
      return completion(used.length === 1 ? "invalid" : undefined);
    })(request());
    expect(response.status).toBe(200);
    expect(discoveries).toBe(1);
    expect(used).toEqual(["qwen-3.8-27b", "qwen-3.8-27b"]);
  });
  test("malformed outputs and upstream failures are errors, never answers", async () => {
    for (const result of [completion("invalid"), new Response("offline", { status: 500 })]) {
      const response = await createHandler(config(), async (input) => String(input).endsWith("/running") ? states() : result)(request());
      expect([502, 503]).toContain(response.status);
      expect((await response.json()).answers).toBeUndefined();
    }
  });
  test("all question chunks share one model and deadline", async () => {
    const c = config();
    c.settings.questionsPerCall = 1;
    c.settings.timeoutMs = 50;
    let discoveries = 0;
    const models: string[] = [];
    const handler = createHandler(c, async (input, init) => {
      if (String(input).endsWith("/running")) { discoveries++; return states(); }
      models.push(JSON.parse(String(init?.body)).model);
      await Bun.sleep(30);
      return completion(JSON.stringify({ answers: { [models.length === 1 ? "q1" : "q2"]: 0.9 } }));
    });
    const response = await handler(request({ ...payload, questions: {
      first: { type: "noul", instructions: "First?" },
      second: { type: "noul", instructions: "Second?" },
    } }));
    expect(response.status).toBe(503);
    expect(discoveries).toBe(1);
    expect(models).toEqual(["small", "small"]);
    await Bun.sleep(20);
  });
  test("concurrent requests get 529 and no second load", async () => {
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let calls = 0;
    const handler = createHandler(config(), async (input) => {
      calls++;
      if (String(input).endsWith("/running")) return states();
      entered(); await blocked; return completion();
    });
    const first = handler(request());
    await started;
    expect((await handler(request())).status).toBe(529);
    expect(calls).toBe(2);
    release();
    expect((await first).status).toBe(200);
  });
  test("deadline aborts inference and releases capacity", async () => {
    const c = config();
    c.settings.timeoutMs = 25;
    let aborted = false;
    let block = true;
    const handler = createHandler(c, async (input, init) => {
      if (String(input).endsWith("/running")) return states();
      if (!block) return completion();
      return new Promise<Response>((_, reject) => {
        init!.signal!.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); }, { once: true });
      });
    });
    expect((await handler(request())).status).toBe(503);
    await Bun.sleep(1);
    expect(aborted).toBe(true);
    block = false;
    expect((await handler(request())).status).toBe(200);
  });
  test("client cancellation propagates to discovery", async () => {
    const controller = new AbortController();
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    let aborted = false;
    const handler = createHandler(config(), async (_, init) => new Promise<Response>((_, reject) => {
      entered();
      init!.signal!.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); }, { once: true });
    }));
    const result = handler(request(payload, {}, controller.signal));
    await started;
    controller.abort();
    expect((await result).status).toBe(503);
    expect(aborted).toBe(true);
  });
  test("readiness does not load models or equate availability with residency", async () => {
    let resident = false;
    const handler = createHandler(config(), async (input) => {
      expect(String(input).endsWith("/running")).toBe(true);
      return resident ? states({ model: "qwen-3.8-27b", state: "ready" }) : states();
    });
    expect((await handler(new Request("http://localhost/ready"))).status).toBe(503);
    resident = true;
    const response = await handler(new Request("http://localhost/ready"));
    expect((await response.json()).upstream_model).toBe("qwen-3.8-27b");
  });
});
