export type Vertex = [number, number];
export type Arc = [Vertex, Vertex];

export interface QuantumWalkConfig {
  rows: number;
  cols: number;
  boundary?: "open" | "periodic";
  defaultCoin?: "grover" | "hadamard" | "mixed";
}

export class QuantumSystem {
  rows: number;
  cols: number;
  boundary: "open" | "periodic";
  defaultCoin: "grover" | "hadamard" | "mixed";

  vertices: Vertex[];
  degree: Map<string, number>;
  arcs: Arc[];
  arcIndex: Map<string, number>;
  C: number[][];
  S: number[][];
  U: number[][];

  constructor(config: QuantumWalkConfig) {
    this.rows = config.rows;
    this.cols = config.cols;
    this.boundary = config.boundary || "open";
    this.defaultCoin = config.defaultCoin || "mixed";

    this.vertices = Array.from(
      { length: this.rows * this.cols },
      (_, k) => [Math.floor(k / this.cols), k % this.cols]
    );

    this.arcs = this.vertices.flatMap((v) =>
      this.neighbors(v).map((w) => [v, w] as Arc)
    );

    this.degree = new Map(
      this.vertices.map((v) => [this.key(v), this.neighbors(v).length])
    );

    this.arcIndex = new Map(
      this.arcs.map((arc, i) => [`${this.key(arc[0])}|${this.key(arc[1])}`, i])
    );

    this.C = this.buildCoin();
    this.S = this.buildShift();
    this.U = this.matMul(this.S, this.C);
  }

  key(v: Vertex): string {
    return `${v[0]},${v[1]}`;
  }

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
      // Periodic boundary conditions
      return candidates.map(([x, y]) => [
        (x + this.rows) % this.rows,
        (y + this.cols) % this.cols,
      ]);
    }
  }

  grover(d: number): number[][] {
    const value = 2 / d;
    const matrix = Array.from({ length: d }, () => Array(d).fill(value));
    for (let i = 0; i < d; i++) matrix[i][i] -= 1;
    return matrix;
  }

  hadamard(d: number): number[][] {
    if (d === 2) {
      const a = 1 / Math.sqrt(2);
      return [
        [a, a],
        [a, -a],
      ];
    }
    // Fallback if hadamard is requested for d != 2
    return this.grover(d);
  }

  buildCoin(): number[][] {
    const n = this.arcs.length;
    const C = Array.from({ length: n }, () => Array(n).fill(0));

    for (const v of this.vertices) {
      const ns = this.neighbors(v);
      const ids = ns.map((w) => this.arcIndex.get(`${this.key(v)}|${this.key(w)}`)!);
      
      let local: number[][];
      if (this.defaultCoin === "mixed") {
        local = ns.length === 2 ? this.hadamard(2) : this.grover(ns.length);
      } else if (this.defaultCoin === "hadamard") {
        local = this.hadamard(ns.length);
      } else {
        local = this.grover(ns.length);
      }

      ids.forEach((gi, i) =>
        ids.forEach((gj, j) => {
          C[gi][gj] = local[i][j];
        })
      );
    }

    return C;
  }

  buildShift(): number[][] {
    const n = this.arcs.length;
    const S = Array.from({ length: n }, () => Array(n).fill(0));

    this.arcs.forEach(([u, v], i) => {
      const j = this.arcIndex.get(`${this.key(v)}|${this.key(u)}`)!;
      S[j][i] = 1;
    });

    return S;
  }

  matMul(A: number[][], B: number[][]): number[][] {
    return A.map((row) =>
      B[0].map((_, j) =>
        row.reduce((sum, value, k) => sum + value * B[k][j], 0)
      )
    );
  }

  evolve(state: number[]): number[] {
    return this.U.map((row) =>
      row.reduce((sum, value, i) => sum + value * state[i], 0)
    );
  }

  probabilities(state: number[]): number[][] {
    const grid = Array.from({ length: this.rows }, () => Array(this.cols).fill(0));
    this.arcs.forEach(([v], i) => {
      grid[v[0]][v[1]] += state[i] ** 2;
    });
    return grid;
  }

  createHistory(tMax: number, initialArc: number): number[][] {
    const initial = Array(this.arcs.length).fill(0);
    if (initialArc >= 0 && initialArc < this.arcs.length) {
      initial[initialArc] = 1;
    } else {
      initial[0] = 1; // Fallback
    }

    const history = [initial];
    for (let t = 0; t < tMax; t++) {
      history.push(this.evolve(history[history.length - 1]));
    }
    return history;
  }

  diracTerms(state: number[]): DiracTerm[] {
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

  getInitialArcIndex(startRow: number, startCol: number, dirRow: number, dirCol: number): number {
    const idx = this.arcIndex.get(`${startRow},${startCol}|${dirRow},${dirCol}`);
    if (idx !== undefined) return idx;
    
    // fallback to first valid neighbor
    const neighbors = this.neighbors([startRow, startCol]);
    if (neighbors.length > 0) {
      return this.arcIndex.get(`${startRow},${startCol}|${neighbors[0][0]},${neighbors[0][1]}`) || 0;
    }
    return 0;
  }
}

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

export function norm(state: number[]): number {
  return Math.sqrt(state.reduce((sum, x) => sum + x * x, 0));
}
