export type Vertex = [number, number];
export type Arc = [Vertex, Vertex];

/** Which operators to compose and in what order.
 *  "SC"  → U = S · C  (shift after coin)   — standard DTQW
 *  "CS"  → U = C · S  (coin after shift)    — reversed order
 */
export type EvolutionOrder = "SC" | "CS";

export interface QuantumWalkConfig {
  rows: number;
  cols: number;
  boundary?: "open" | "periodic";
  defaultCoin?: "grover" | "hadamard" | "mixed";
  evolutionOrder?: EvolutionOrder;
}

/* ─────────────────────────────────────────────────────────────────────────────
   QuantumSystem — sparse engine

   State space: one amplitude per directed arc (u → v).
   Memory: O(|arcs|) instead of O(|arcs|²).
   Per-step cost: O(|arcs|) instead of O(|arcs|²).

   Key pre-computed structures (all O(n)):
     arcs[]          — list of all directed arcs, indexed 0..n-1
     arcIndex        — Map "(r1,c1)|(r2,c2)" → arc id
     vertexArcs[]    — for each arc-id, the list of arc-ids that share the
                       same *source* vertex (used by applyCoin)
     reverseArc[]    — for arc-id i = (u→v), reverseArc[i] = arc-id of (v→u)
                       (used by applyShift)
     coinMatrix[]    — flattened local coin matrix per vertex group, stored
                       together with an offset table; avoids re-computing
                       Grover/Hadamard on every step
   ────────────────────────────────────────────────────────────────────────── */
export class QuantumSystem {
  rows: number;
  cols: number;
  boundary: "open" | "periodic";
  defaultCoin: "grover" | "hadamard" | "mixed";
  evolutionOrder: EvolutionOrder;

  vertices: Vertex[];
  degree: Map<string, number>;
  arcs: Arc[];
  arcIndex: Map<string, number>;

  // Sparse structures (replaces dense C, S, U)
  /** For each arc index i, the list of arc indices that share arc[i]'s source vertex */
  private vertexArcGroups: number[][];
  /** reverseArc[i] = index of the arc that is the reverse of arc i */
  private reverseArc: Int32Array;
  /**
   * Flattened local coin coefficients.
   * For the group of arcs [g0, g1, ..., gk] at a vertex of degree d=k+1,
   * coinCoeffs[offset + i*d + j] = C_local[i][j].
   * coinOffsets[arcGroupIndex] = start index in coinCoeffs.
   */
  private coinCoeffs: Float64Array;
  private coinOffsets: Int32Array;
  private coinDegrees: Int32Array;

  constructor(config: QuantumWalkConfig) {
    this.rows = config.rows;
    this.cols = config.cols;
    this.boundary = config.boundary || "open";
    this.defaultCoin = config.defaultCoin || "mixed";
    this.evolutionOrder = config.evolutionOrder || "SC";

    // ── Build vertex list ──────────────────────────────────────────────────
    this.vertices = Array.from(
      { length: this.rows * this.cols },
      (_, k) => [Math.floor(k / this.cols), k % this.cols] as Vertex
    );

    // ── Build arc list ─────────────────────────────────────────────────────
    this.arcs = this.vertices.flatMap((v) =>
      this.neighbors(v).map((w) => [v, w] as Arc)
    );

    // ── Degree map ─────────────────────────────────────────────────────────
    this.degree = new Map(
      this.vertices.map((v) => [this.key(v), this.neighbors(v).length])
    );

    // ── Arc index map ──────────────────────────────────────────────────────
    this.arcIndex = new Map(
      this.arcs.map((arc, i) => [this.arcKey(arc[0], arc[1]), i])
    );

    // ── Pre-compute sparse structures ──────────────────────────────────────
    this.reverseArc = this.buildReverseArc();
    const { groups, offsets, degrees, coeffs } = this.buildCoinStructures();
    this.vertexArcGroups = groups;
    this.coinOffsets = offsets;
    this.coinDegrees = degrees;
    this.coinCoeffs = coeffs;
  }

  // ── Key helpers ────────────────────────────────────────────────────────────
  key(v: Vertex): string {
    return `${v[0]},${v[1]}`;
  }

  private arcKey(u: Vertex, v: Vertex): string {
    return `${u[0]},${u[1]}|${v[0]},${v[1]}`;
  }

  // ── Graph topology ─────────────────────────────────────────────────────────
  neighbors(v: Vertex): Vertex[] {
    const [i, j] = v;
    const candidates: Vertex[] = [
      [i - 1, j],
      [i + 1, j],
      [i, j - 1],
      [i, j + 1],
    ];

    if (this.boundary === "open") {
      return candidates.filter(
        ([x, y]) => x >= 0 && x < this.rows && y >= 0 && y < this.cols
      );
    } else {
      // Periodic (torus)
      return candidates.map(([x, y]) => [
        (x + this.rows) % this.rows,
        (y + this.cols) % this.cols,
      ] as Vertex);
    }
  }

  // ── Local coin matrices ────────────────────────────────────────────────────
  private grover(d: number): number[] {
    // Returns flat row-major d×d Grover matrix
    const v = 2 / d;
    const out: number[] = [];
    for (let i = 0; i < d; i++)
      for (let j = 0; j < d; j++)
        out.push(i === j ? v - 1 : v);
    return out;
  }

  private hadamard2(): number[] {
    const a = 1 / Math.sqrt(2);
    return [a, a, a, -a];
  }

  private localCoin(d: number): number[] {
    if (this.defaultCoin === "hadamard") {
      return d === 2 ? this.hadamard2() : this.grover(d);
    } else if (this.defaultCoin === "mixed") {
      return d === 2 ? this.hadamard2() : this.grover(d);
    } else {
      return this.grover(d);
    }
  }

  // ── Sparse structure builders ──────────────────────────────────────────────

  /** Build reverseArc[i]: for arc i=(u→v), find arc j=(v→u). O(|arcs|). */
  private buildReverseArc(): Int32Array {
    const rev = new Int32Array(this.arcs.length).fill(-1);
    this.arcs.forEach(([u, v], i) => {
      const j = this.arcIndex.get(this.arcKey(v, u));
      if (j !== undefined) rev[i] = j;
    });
    return rev;
  }

  /**
   * Build per-vertex coin group structures.
   * Returns:
   *   groups[g]    — array of arc ids belonging to group g (vertex g)
   *   offsets[g]   — start index in coinCoeffs for group g
   *   degrees[g]   — degree d of the vertex in group g
   *   coeffs       — flat Float64Array of all local coin entries
   */
  private buildCoinStructures(): {
    groups: number[][];
    offsets: Int32Array;
    degrees: Int32Array;
    coeffs: Float64Array;
  } {
    // Group arcs by source vertex (in vertex order)
    const groups: number[][] = this.vertices.map(() => []);
    const vertexIdx = new Map<string, number>(
      this.vertices.map((v, i) => [this.key(v), i])
    );

    this.arcs.forEach(([u], i) => {
      const vi = vertexIdx.get(this.key(u))!;
      groups[vi].push(i);
    });

    // Flatten coin coefficients
    const offsets = new Int32Array(groups.length);
    const degrees = new Int32Array(groups.length);
    let totalCoeffs = 0;

    groups.forEach((g, gi) => {
      offsets[gi] = totalCoeffs;
      degrees[gi] = g.length;
      totalCoeffs += g.length * g.length;
    });

    const coeffs = new Float64Array(totalCoeffs);
    groups.forEach((g, gi) => {
      const d = g.length;
      const local = this.localCoin(d);
      const off = offsets[gi];
      for (let k = 0; k < local.length; k++) {
        coeffs[off + k] = local[k];
      }
    });

    return { groups, offsets, degrees, coeffs };
  }

  // ── Sparse operators ───────────────────────────────────────────────────────

  /**
   * Apply the coin operator in-place on a copy.
   * For each vertex v with arc group [a0, a1, ..., a_{d-1}],
   * newState[ai] = Σ_j C[i][j] * state[aj]
   * Cost: O(Σ_v d_v²) = O(|arcs|) for bounded-degree graphs (d ≤ 4).
   */
  applyCoin(state: Float64Array): Float64Array {
    const next = new Float64Array(state.length);
    const ng = this.vertexArcGroups.length;

    for (let gi = 0; gi < ng; gi++) {
      const g = this.vertexArcGroups[gi];
      const d = this.coinDegrees[gi];
      const off = this.coinOffsets[gi];

      for (let i = 0; i < d; i++) {
        let sum = 0;
        for (let j = 0; j < d; j++) {
          sum += this.coinCoeffs[off + i * d + j] * state[g[j]];
        }
        next[g[i]] = sum;
      }
    }

    return next;
  }

  /**
   * Apply the shift operator in-place on a copy.
   * For each arc i=(u→v), the amplitude moves to reverseArc[i]=(v→u).
   * newState[reverseArc[i]] = state[i]
   * Cost: O(|arcs|).
   */
  applyShift(state: Float64Array): Float64Array {
    const next = new Float64Array(state.length);
    const n = state.length;

    for (let i = 0; i < n; i++) {
      const j = this.reverseArc[i];
      if (j >= 0) next[j] = state[i];
    }

    return next;
  }

  /**
   * One full evolution step: applies operators in the configured order.
   * "SC" → U = S · C  (coin first, then shift)
   * "CS" → U = C · S  (shift first, then coin)
   */
  evolve(state: Float64Array): Float64Array {
    if (this.evolutionOrder === "SC") {
      return this.applyShift(this.applyCoin(state));
    } else {
      return this.applyCoin(this.applyShift(state));
    }
  }

  /**
   * Compute vertex probability distribution from arc amplitudes.
   * P(v) = Σ_{arcs leaving v} |ψ_arc|²
   */
  probabilities(state: Float64Array): number[][] {
    const grid = Array.from({ length: this.rows }, () =>
      Array(this.cols).fill(0)
    );
    this.arcs.forEach(([v], i) => {
      grid[v[0]][v[1]] += state[i] * state[i];
    });
    return grid;
  }

  /**
   * Build the full history array (tMax+1 states) as a flat Float64Array.
   * Layout: history[t * arcCount + i] = amplitude of arc i at step t.
   * This flat layout is cache-friendly and Transferable to a Web Worker.
   */
  createHistoryFlat(tMax: number, initialArc: number): Float64Array {
    const n = this.arcs.length;
    const history = new Float64Array((tMax + 1) * n);

    // Initial state
    if (initialArc >= 0 && initialArc < n) {
      history[initialArc] = 1;
    } else {
      history[0] = 1; // Fallback
    }

    // Evolve
    let current = history.subarray(0, n);
    for (let t = 0; t < tMax; t++) {
      // Evolve using a temporary Float64Array
      const next = this.evolve(new Float64Array(current));
      history.set(next, (t + 1) * n);
      current = history.subarray((t + 1) * n, (t + 2) * n);
    }

    return history;
  }

  /**
   * Extract a single step's state from a flat history buffer.
   */
  getStep(history: Float64Array, step: number): Float64Array {
    const n = this.arcs.length;
    return history.subarray(step * n, (step + 1) * n);
  }

  // ── Dirac notation ─────────────────────────────────────────────────────────
  diracTerms(state: Float64Array): DiracTerm[] {
    const terms: DiracTerm[] = [];
    state.forEach((a, i) => {
      if (Math.abs(a) > 0.0005) {
        const [u, v] = this.arcs[i];
        terms.push({
          sign: a < 0 ? "−" : "+",
          coeff: fmt(a),
          from: u,
          to: v,
        });
      }
    });
    return terms;
  }

  // ── Initial arc lookup ─────────────────────────────────────────────────────
  getInitialArcIndex(
    startRow: number,
    startCol: number,
    dirRow: number,
    dirCol: number
  ): number {
    const key = this.arcKey([startRow, startCol], [dirRow, dirCol]);
    const idx = this.arcIndex.get(key);
    if (idx !== undefined) return idx;

    // Fallback to first valid neighbor
    const neighbors = this.neighbors([startRow, startCol]);
    if (neighbors.length > 0) {
      const fallback = this.arcIndex.get(
        this.arcKey([startRow, startCol], neighbors[0])
      );
      return fallback ?? 0;
    }
    return 0;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(x: number): string {
  const abs = Math.abs(x);
  if (abs < 0.0005) return "";
  if (Math.abs(abs - 1) < 0.0005) return "1";
  return abs.toFixed(3);
}

export type DiracTerm = {
  sign: "+" | "−";
  coeff: string;
  from: Vertex;
  to: Vertex;
};

export function norm(state: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < state.length; i++) sum += state[i] * state[i];
  return Math.sqrt(sum);
}
