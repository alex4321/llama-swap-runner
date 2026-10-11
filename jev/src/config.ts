import { parseArgs } from "node:util";
import type { Settings } from "../../localjev/src/config";

export interface Config {
  swapUrl: string;
  fallbackModel: string;
  preferredModels: string[];
  supportedModels: string[];
  settings: Settings;
}

export const HELP = `Usage: bash jev.sh --fallback-model MODEL [options]
  --llama-swap-url URL  Default http://localhost:8080
  --prefer-model MODEL Repeatable; allow model and prioritize it when resident
  --port NUMBER        Default 8082 (8081 may host standalone LocalJev)
  --timeout-ms NUMBER  Whole request deadline, default 3800
  --max-output-tokens N Default 256
  --malformed-retries N Default 0
  --check-config       Validate options without starting a server
Credentials: JEV_API_KEY (clients), JEV_UPSTREAM_API_KEY (llama-swap).
One decision at a time; concurrent decisions return HTTP 529 without queueing.`;

function integer(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`Expected an integer between ${min} and ${max}, got ${JSON.stringify(raw)}`);
  }
  return value;
}

export function parseConfig(args: string[], env: Record<string, string | undefined> = process.env): Config {
  const { values } = parseArgs({ args, strict: true, allowPositionals: false, options: {
    "fallback-model": { type: "string" },
    "llama-swap-url": { type: "string" },
    "prefer-model": { type: "string", multiple: true },
    port: { type: "string" },
    "timeout-ms": { type: "string" },
    "max-output-tokens": { type: "string" },
    "malformed-retries": { type: "string" },
  } });
  const fallbackModel = values["fallback-model"]?.trim();
  if (!fallbackModel) throw new Error("--fallback-model is required");
  const url = new URL(values["llama-swap-url"] ?? "http://localhost:8080");
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("llama-swap URL must be HTTP(S), without credentials, query or fragment");
  }
  url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/v1$/, "");
  const swapUrl = url.toString().replace(/\/+$/, "");
  const preferredModels = values["prefer-model"] ?? [];
  if (preferredModels.some((id) => !id.trim())) throw new Error("Preferred model IDs must not be empty");
  return {
    swapUrl, fallbackModel, preferredModels,
    supportedModels: [...new Set(["qwen-3.8-27b", "strata-qwen-3.8-flash-next-coder", fallbackModel, ...preferredModels])],
    settings: {
      upstream: `${swapUrl}/v1`, upstreamModel: fallbackModel,
      upstreamApiKey: env.JEV_UPSTREAM_API_KEY ?? "", apiKey: env.JEV_API_KEY ?? "",
      host: "127.0.0.1", port: integer(values.port, 8082, 1, 65535),
      timeoutMs: integer(values["timeout-ms"], 3800, 1, 2_147_483_647),
      maxOutputTokens: integer(values["max-output-tokens"], 256, 1, 65536),
      malformedRetries: integer(values["malformed-retries"], 0, 0, 10),
      temperature: 0, maxInflight: 1, maxQueue: 1,
      questionsPerCall: 16, outcomesPerCall: 128,
    },
  };
}
