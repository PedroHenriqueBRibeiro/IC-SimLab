export type Vertex = [number, number];
export type Arc = [Vertex, Vertex];

export const ROWS = 3;
export const COLS = 3;

export const VERTICES: Vertex[] = Array.from(
  { length: ROWS * COLS },
  (_, k) => [Math.floor(k / COLS), k % COLS]
);

export function key(v: Vertex): string {
  return `${v[0]},${v[1]}`;
}

export function neighbors(v: Vertex): Vertex[] {
  const [i, j] = v;
  const candidates: Vertex[] = [
    [i - 1, j],
    [i + 1, j],
    [i, j - 1],
    [i, j + 1],
  ];
  return candidates.filter(
    ([x, y]) => x >= 0 && x < ROWS && y >= 0 && y < COLS
  );
}

export const DEGREE = new Map(
  VERTICES.map((v) => [key(v), neighbors(v).length])
);

export const ARCS: Arc[] = VERTICES.flatMap((v) =>
  neighbors(v).map((w) => [v, w] as Arc)
);

const arcIndex = new Map(
  ARCS.map((arc, i) => [`${key(arc[0])}|${key(arc[1])}`, i])
);

function grover(d: number): number[][] {
  const value = 2 / d;
  const matrix = Array.from({ length: d }, () => Array(d).fill(value));
  for (let i = 0; i < d; i++) matrix[i][i] -= 1;
  return matrix;
}

function hadamard(): number[][] {
  const a = 1 / Math.sqrt(2);
  return [
    [a, a],
    [a, -a],
  ];
}

function buildCoin(): number[][] {
  const n = ARCS.length;
  const C = Array.from({ length: n }, () => Array(n).fill(0));

  for (const v of VERTICES) {
    const ns = neighbors(v);
    const ids = ns.map((w) => arcIndex.get(`${key(v)}|${key(w)}`)!);
    const local = ns.length === 2 ? hadamard() : grover(ns.length);

    ids.forEach((gi, i) =>
      ids.forEach((gj, j) => {
        C[gi][gj] = local[i][j];
      })
    );
  }

  return C;
}

function buildShift(): number[][] {
  const n = ARCS.length;
  const S = Array.from({ length: n }, () => Array(n).fill(0));

  ARCS.forEach(([u, v], i) => {
    const j = arcIndex.get(`${key(v)}|${key(u)}`)!;
    S[j][i] = 1;
  });

  return S;
}

export const C = buildCoin();
export const S = buildShift();

export function matMul(A: number[][], B: number[][]): number[][] {
  return A.map((row) =>
    B[0].map((_, j) =>
      row.reduce((sum, value, k) => sum + value * B[k][j], 0)
    )
  );
}

export const U = matMul(S, C);

export function evolve(state: number[]): number[] {
  return U.map((row) =>
    row.reduce((sum, value, i) => sum + value * state[i], 0)
  );
}

export function probabilities(state: number[]): number[][] {
  const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(0));

  ARCS.forEach(([v], i) => {
    grid[v[0]][v[1]] += state[i] ** 2;
  });

  return grid;
}

export function norm(state: number[]): number {
  return Math.sqrt(state.reduce((sum, x) => sum + x * x, 0));
}

export function createHistory(tMax: number, initialArc = 0): number[][] {
  const initial = Array(ARCS.length).fill(0);
  initial[initialArc] = 1;

  const history = [initial];
  for (let t = 0; t < tMax; t++) {
    history.push(evolve(history[history.length - 1]));
  }
  return history;
}

function fmt(x: number): string {
  // Sempre devolve a magnitude (sem sinal) -- o sinal é tratado à parte
  // por quem chama, para nunca duplicar o "-" (bug anterior: "− -0.080").
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

/** Versão estruturada (uma entrada por termo), usada pela UI em "chips". */
export function diracTerms(state: number[]): DiracTerm[] {
  const terms: DiracTerm[] = [];
  state.forEach((a, i) => {
    if (Math.abs(a) > 0.0005) {
      const [u, v] = ARCS[i];
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

export function dirac(state: number[], t: number): string {
  const terms = diracTerms(state);
  if (!terms.length) return `|ψ_${t}⟩ = 0`;
  const body = terms
    .map((term, i) => {
      const piece = `${term.coeff}|(${term.from[0]},${term.from[1]}),(${term.to[0]},${term.to[1]})⟩`;
      return i === 0 && term.sign === "+" ? piece : `${term.sign} ${piece}`;
    })
    .join(" ");
  return `|ψ_${t}⟩ = ${body}`;
}

export function transitionFormula(t: number): string {
  return `|ψ_${t + 1}⟩ = U|ψ_${t}⟩`;
}
