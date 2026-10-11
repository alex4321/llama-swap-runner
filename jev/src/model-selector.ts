import { BackendUnavailableError } from "../../localjev/src/engine";

export interface RunningModel { model: string; state: string }
export type Selection = { kind: "selected"; model: string } | { kind: "wait" };

// No config-file parsing or assumptions about model naming/backend architecture.
export function selectModel(running: RunningModel[], fallback: string, preferred: string[], supported: string[]): Selection {
  const eligible = running.filter((entry) => supported.includes(entry.model));
  const ready = eligible.filter((entry) => entry.state === "ready").map((entry) => entry.model);
  if (ready.length) {
    const ordered = [...new Set([...preferred, ...ready.toSorted()])];
    return { kind: "selected", model: ordered.find((id) => ready.includes(id))! };
  }
  if (eligible.some((entry) => entry.state === "starting")) return { kind: "wait" };
  if (running.length) throw new BackendUnavailableError("Resident models are not ready; refusing to load a competing model");
  return { kind: "selected", model: fallback };
}
