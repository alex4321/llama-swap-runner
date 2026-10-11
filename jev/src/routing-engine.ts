import { AsyncLocalStorage } from "node:async_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { BackendUnavailableError, Engine, OverloadedError, type DecisionEngine } from "../../localjev/src/engine";
import type { JsonValue, Question } from "../../localjev/src/types";
import type { Config } from "./config";
import { LlamaSwapClient, type Fetch } from "./llama-swap-client";
import { selectModel } from "./model-selector";

export const requestSignals = new AsyncLocalStorage<AbortSignal>();

export class RoutingEngine implements DecisionEngine {
  private busy = false;
  readonly client: LlamaSwapClient;

  constructor(private readonly config: Config, private readonly fetchImpl: Fetch = fetch) {
    this.client = new LlamaSwapClient(config.swapUrl, config.settings.upstreamApiKey, fetchImpl);
  }

  async decide(questions: Record<string, Question>, state: JsonValue, seed: number) {
    if (this.busy) throw new OverloadedError("A classification is already in progress; retry shortly");
    this.busy = true;
    const signal = requestSignals.getStore() ?? AbortSignal.timeout(this.config.settings.timeoutMs);
    const started = performance.now();
    let model: string | undefined;
    try {
      while (true) {
        signal.throwIfAborted();
        const selection = selectModel(await this.client.running(signal), this.config.fallbackModel, this.config.preferredModels, this.config.supportedModels);
        if (selection.kind === "selected") { model = selection.model; break; }
        await delay(100, undefined, { signal });
      }
      // Fresh immutable settings pin every chunk/retry to this decision's model.
      const engine = new Engine({ ...this.config.settings, upstreamModel: model }, (input, init) => {
        signal.throwIfAborted();
        return this.fetchImpl(input, {
          ...init, signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal,
        });
      });
      const result = await engine.decide(questions, state, seed);
      signal.throwIfAborted();
      console.info(JSON.stringify({ event: "decision", model, elapsedMs: Math.round(performance.now() - started), status: "ok" }));
      return result;
    } catch (error) {
      console.info(JSON.stringify({ event: "decision", model, elapsedMs: Math.round(performance.now() - started), status: "failed" }));
      if (signal.aborted) throw new BackendUnavailableError("Classification deadline exceeded or client disconnected");
      throw error;
    } finally { this.busy = false; }
  }
}
