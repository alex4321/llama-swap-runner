import { BackendUnavailableError } from "../../localjev/src/engine";
import type { RunningModel } from "./model-selector";

export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class LlamaSwapClient {
  constructor(private readonly url: string, private readonly key: string, private readonly fetchImpl: Fetch = fetch) {}

  async running(signal: AbortSignal): Promise<RunningModel[]> {
    try {
      const response = await this.fetchImpl(`${this.url}/running`, {
        signal, headers: this.key ? { authorization: `Bearer ${this.key}` } : {},
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload: unknown = await response.json();
      if (typeof payload !== "object" || payload === null || !("running" in payload) || !Array.isArray(payload.running)) {
        throw new Error("Invalid running-model response");
      }
      const models: RunningModel[] = [];
      for (const entry of payload.running) {
        if (typeof entry !== "object" || entry === null || typeof entry.model !== "string" || !entry.model ||
            !["ready", "starting", "stopping", "stopped", "shutdown"].includes(entry.state)) {
          throw new Error("Invalid running-model entry");
        }
        models.push({ model: entry.model, state: entry.state });
      }
      return models;
    } catch {
      throw new BackendUnavailableError("Cannot discover llama-swap model state");
    }
  }
}
