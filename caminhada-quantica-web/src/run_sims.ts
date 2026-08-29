import { QuantumSystem } from "./quantum";

function printState(system: QuantumSystem, state: number[], step: number) {
  let dirac = `t = ${step}\n`;
  const P: Record<string, number> = {};
  
  // Calculate probabilities per vertex
  for (let i = 0; i < state.length; i++) {
    const val = state[i];
    if (Math.abs(val) > 1e-9) {
      const arc = system.arcs[i];
      const v = arc[0]; // (row, col)
      const key = `(${v[0]},${v[1]})`;
      P[key] = (P[key] || 0) + val * val;
    }
  }

  // Print non-zero probabilities
  let maxP = 0;
  let maxV = "";
  for (const [v, p] of Object.entries(P)) {
    if (p > maxP) {
      maxP = p;
      maxV = v;
    }
    dirac += `P${v} = ${p.toFixed(4)}\n`;
  }
  dirac += `Max: ${maxV} com P=${maxP.toFixed(4)}\n`;
  console.log(dirac);
}

function runExperiment(name: string, config: any, tMax: number, initialRow: number, initialCol: number, initialDirRow: number, initialDirCol: number) {
  console.log(`\n========================================`);
  console.log(`EXPERIMENTO: ${name}`);
  console.log(`========================================`);
  
  const system = new QuantumSystem(config);
  let initArc = -1;
  try {
    initArc = system.getInitialArcIndex(initialRow, initialCol, initialDirRow, initialDirCol);
  } catch (e) {
    console.log("Fallback initial direction");
    initArc = system.arcs.findIndex(a => a[0][0] === initialRow && a[0][1] === initialCol);
  }

  const history = system.createHistory(tMax, initArc);
  
  for (let t = 0; t <= tMax; t++) {
    printState(system, history[t], t);
  }
}

// Exp 1: Grover 3x3
runExperiment("Grover 3x3 (Aberto)", { rows: 3, cols: 3, boundary: "open", defaultCoin: "grover" }, 5, 1, 1, 1, 2);

// Exp 2: Hadamard 3x3
runExperiment("Hadamard 3x3 (Aberto)", { rows: 3, cols: 3, boundary: "open", defaultCoin: "hadamard" }, 5, 1, 1, 1, 2);

// Exp 3: Misto 3x3
runExperiment("Misto 3x3 (Aberto)", { rows: 3, cols: 3, boundary: "open", defaultCoin: "mixed" }, 5, 1, 1, 1, 2);
