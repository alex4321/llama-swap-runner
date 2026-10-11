import { LocalJevApp } from "../../localjev/src/server";
import { HELP, parseConfig, type Config } from "./config";
import { RoutingEngine, requestSignals } from "./routing-engine";
import type { Fetch } from "./llama-swap-client";
import { selectModel } from "./model-selector";

function unavailable() {
  return Response.json({ detail: { error_type: "api_error", message: "Classification unavailable or deadline exceeded" } }, { status: 503 });
}

export function createHandler(config: Config, fetchImpl: Fetch = fetch, shutdownSignal?: AbortSignal) {
  const engine = new RoutingEngine(config, fetchImpl);
  const app = new LocalJevApp(config.settings, engine);
  return async (request: Request): Promise<Response> => {
    const signal = AbortSignal.any([
      request.signal, AbortSignal.timeout(config.settings.timeoutMs), ...(shutdownSignal ? [shutdownSignal] : []),
    ]);
    let onAbort: () => void = () => {};
    const expired = new Promise<Response>((resolve) => {
      onAbort = () => resolve(unavailable());
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
    const operation = requestSignals.run(signal, async () => {
      if (request.method === "GET" && new URL(request.url).pathname === "/ready") {
        try {
          const running = await engine.client.running(signal);
          if (!running.some((entry) => entry.state === "ready")) return unavailable();
          const selected = selectModel(running, config.fallbackModel, config.preferredModels, config.supportedModels);
          if (selected.kind !== "selected") return unavailable();
          return Response.json({ status: "ready", upstream_model: selected.model });
        } catch { return unavailable(); }
      }
      return app.fetch(request);
    });
    try { return await Promise.race([operation, expired]); }
    finally { signal.removeEventListener("abort", onAbort); }
  };
}

if (import.meta.main) {
  if (process.argv.includes("--help")) {
    console.log(HELP);
  } else {
    try {
      const args = process.argv.slice(2);
      const config = parseConfig(args.filter((arg) => arg !== "--check-config"));
      if (args.includes("--check-config")) process.exit(0);
      const shutdown = new AbortController();
      const server = Bun.serve({
        hostname: config.settings.host, port: config.settings.port,
        maxRequestBodySize: 1024 * 1024, idleTimeout: 255,
        fetch: createHandler(config, fetch, shutdown.signal),
      });
      console.log(`Dynamic LocalJev listening on ${server.url} (fallback ${config.fallbackModel})`);
      let closing = false;
      const close = async () => {
        if (closing) return;
        closing = true;
        shutdown.abort();
        await server.stop(true);
      };
      process.on("SIGINT", close);
      process.on("SIGTERM", close);
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Cannot start wrapper");
      process.exitCode = 1;
    }
  }
}
