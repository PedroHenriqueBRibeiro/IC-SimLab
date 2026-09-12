/**
 * quantum.worker.ts
 *
 * Web Worker for off-thread quantum walk simulation.
 *
 * Message protocol:
 *   INPUT  (main → worker): WorkerInput
 *   OUTPUT (worker → main): WorkerMessage
 *
 * The history is transferred as a Transferable ArrayBuffer so the main thread
 * receives it without a memory copy (zero-copy transfer).
 */

import { QuantumSystem } from "./quantum";
import type { QuantumWalkConfig, EvolutionOrder } from "./quantum";

// ── Message types ─────────────────────────────────────────────────────────────

export interface WorkerInput {
  config: QuantumWalkConfig & { evolutionOrder?: EvolutionOrder };
  tMax: number;
  initialArc: number;
  initialState?: "localized" | "uniform";
}

export type WorkerMessage =
  | { type: "progress"; pct: number }
  | { type: "done"; historyBuffer: ArrayBuffer; arcCount: number; tMax: number }
  | { type: "error"; message: string };

// ── Worker handler ────────────────────────────────────────────────────────────

self.onmessage = (e: MessageEvent<WorkerInput>) => {
  try {
    const { config, tMax, initialArc, initialState } = e.data;

    const system = new QuantumSystem(config);
    const n = system.arcs.length;
    
    // Agora delegamos a criação do histórico inicial para a classe
    const history = system.createHistoryFlat(tMax, initialArc, initialState || "localized");

    // Evolve step by step, reporting progress every 5%
    const reportEvery = Math.max(1, Math.floor(tMax / 20));

    for (let t = 0; t < tMax; t++) {
      // Read current step from flat buffer
      const current = history.subarray(t * n, (t + 1) * n);

      // Evolve one step
      const next = system.evolve(new Float64Array(current));

      // Write into flat buffer
      history.set(next, (t + 1) * n);

      // Report progress
      if ((t + 1) % reportEvery === 0) {
        const pct = Math.round(((t + 1) / tMax) * 100);
        self.postMessage({ type: "progress", pct } satisfies WorkerMessage);
      }
    }

    // Transfer the buffer (zero-copy) to the main thread
    self.postMessage(
      {
        type: "done",
        historyBuffer: history.buffer,
        arcCount: n,
        tMax,
      } satisfies WorkerMessage,
      [history.buffer]   // Transferable: ownership moves to main thread
    );
  } catch (err) {
    self.postMessage({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    } satisfies WorkerMessage);
  }
};
