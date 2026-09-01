import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera, Html } from "@react-three/drei";
import { Pause, Play, ChevronLeft, ChevronRight, RotateCcw, Maximize2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, useMemo } from "react";
import * as THREE from "three";
import {
  QuantumSystem,
  norm,
  type Vertex,
} from "./quantum";
import { LabPanel, type SimulationParams } from "./LabPanel";
import type { WorkerMessage, WorkerInput } from "./quantum.worker";

/* ─────────────────────────────────────────────
   Constants
   ───────────────────────────────────────────── */
const HEIGHT_SCALE = 2.0;
const MIN_H = 0.04;

const SPEEDS = [
  { label: "0.5×", ms: 1400 },
  { label: "1×",   ms: 700  },
  { label: "2×",   ms: 300  },
  { label: "4×",   ms: 120  },
];

/* ─────────────────────────────────────────────
   Viridis colormap (9 control points)
   ───────────────────────────────────────────── */
const VIRIDIS_STOPS: Array<[number, number, number]> = [
  [68,  1,   84 ],
  [72,  40,  120],
  [62,  73,  137],
  [49,  104, 142],
  [38,  130, 142],
  [31,  158, 137],
  [53,  183, 121],
  [109, 205, 89 ],
  [253, 231, 37 ],
];

function viridis(t: number): string {
  const c = Math.min(1, Math.max(0, t));
  const scaled = c * (VIRIDIS_STOPS.length - 1);
  const idx = Math.floor(scaled);
  const frac = scaled - idx;
  const a = VIRIDIS_STOPS[idx];
  const b = VIRIDIS_STOPS[Math.min(idx + 1, VIRIDIS_STOPS.length - 1)];
  const r  = Math.round(a[0] + (b[0] - a[0]) * frac);
  const g  = Math.round(a[1] + (b[1] - a[1]) * frac);
  const bl = Math.round(a[2] + (b[2] - a[2]) * frac);
  return `rgb(${r},${g},${bl})`;
}

/* ─────────────────────────────────────────────
   Bar — animated 3D column with hover tooltip
   ───────────────────────────────────────────── */
function Bar({
  row,
  col,
  p,
  maxP,
  degree,
  ox,
  oz,
}: {
  row: number;
  col: number;
  p: number;
  maxP: number;
  degree: number;
  ox: number;
  oz: number;
}) {
  const barRef       = useRef<THREE.Mesh>(null);
  const labelRef     = useRef<THREE.Group>(null);
  const floorRef     = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);

  const targetH  = useRef(Math.max(p * HEIGHT_SCALE, MIN_H));
  const currentH = useRef(targetH.current);

  // Update target height whenever probability changes
  useEffect(() => {
    targetH.current = Math.max(p * HEIGHT_SCALE, MIN_H);
  }, [p]);

  // Initialize mesh imperatively on mount
  useLayoutEffect(() => {
    const h = targetH.current;
    if (barRef.current) {
      barRef.current.scale.y   = h;
      barRef.current.position.y = h / 2;
    }
    if (labelRef.current) {
      labelRef.current.position.y = h + 0.3;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Spring-like lerp animation per frame
  useFrame(() => {
    currentH.current += (targetH.current - currentH.current) * 0.1;
    const h = currentH.current;
    if (barRef.current) {
      barRef.current.scale.y    = h;
      barRef.current.position.y = h / 2;
    }
    if (labelRef.current) {
      labelRef.current.position.y = h + 0.3;
    }
  });

  const color  = viridis(maxP > 0 ? p / maxP : 0);
  const x      = col - ox;
  const z      = row - oz;

  return (
    <group position={[x, 0, z]}>
      {/* Ground tile */}
      <mesh
        ref={floorRef}
        position={[0, -0.001, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
      >
        <planeGeometry args={[0.9, 0.9]} />
        <meshStandardMaterial
          color={hovered ? "#E2E8F0" : "#F1F5F9"}
          roughness={0.95}
          transparent
          opacity={0.9}
        />
      </mesh>

      {/* Animated bar — scale.y is driven by useFrame */}
      <mesh
        ref={barRef}
        castShadow
        receiveShadow
        onPointerEnter={(e) => {
          e.stopPropagation();
          setHovered(true);
          document.body.style.cursor = "pointer";
        }}
        onPointerLeave={() => {
          setHovered(false);
          document.body.style.cursor = "auto";
        }}
      >
        <boxGeometry args={[0.74, 1, 0.74]} />
        <meshStandardMaterial
          color={color}
          metalness={0.1}
          roughness={0.4}
          emissive={color}
          emissiveIntensity={hovered ? 0.3 : Math.min(p * 0.4, 0.15)}
        />
      </mesh>

      {/* Floating probability label — position.y tracked by useFrame */}
      <group ref={labelRef} position={[0, MIN_H + 0.3, 0]}>
        {p > 0.003 && !hovered && (
          <Html center distanceFactor={7.5} occlude={false}>
            <div className="bar-chip">{p.toFixed(3)}</div>
          </Html>
        )}
      </group>

      {/* Hover tooltip */}
      {hovered && (
        <Html
          position={[0, Math.max(p * HEIGHT_SCALE, MIN_H) + 0.72, 0]}
          center
          distanceFactor={6.5}
          occlude={false}
        >
          <div className="vertex-tooltip">
            <div className="vt-coord">({row}, {col})</div>
            <div className="vt-prob">
              P = <strong>{p.toFixed(4)}</strong>
            </div>
            <div className="vt-meta">grau {degree}</div>
          </div>
        </Html>
      )}
    </group>
  );
}

/* ─────────────────────────────────────────────
   Scene — 3D world
   ───────────────────────────────────────────── */
function Scene({ grid, system }: { grid: number[][], system: QuantumSystem }) {
  const maxP = Math.max(...grid.flat(), 1e-6);
  
  const ox = (system.cols - 1) / 2;
  const oz = (system.rows - 1) / 2;
  
  // Make the grid floor and helper large enough
  const floorW = Math.max(7, system.cols * 1.5);
  const floorH = Math.max(7, system.rows * 1.5);

  return (
    <>
      <PerspectiveCamera makeDefault position={[5.3, 4.4, 5.9]} fov={38} />

      {/* Lighting */}
      <ambientLight intensity={1.2} />
      <directionalLight
        position={[4, 7, 4]}
        intensity={1.0}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-floorW/2}
        shadow-camera-right={floorW/2}
        shadow-camera-top={floorH/2}
        shadow-camera-bottom={-floorH/2}
      />
      <directionalLight position={[-4, 2.5, -3]} intensity={0.4} />
      <hemisphereLight args={["#ffffff", "#e2e8f0", 0.6]} />
      {/* Subtle accent fill from below */}
      <pointLight position={[0, -1, 0]} intensity={0.15} color="#4F46E5" />

      {/* Bars */}
      {grid.map((row, i) =>
        row.map((p, j) => (
          <Bar key={`${i}-${j}`} row={i} col={j} p={p} maxP={maxP} degree={system.degree.get(`${i},${j}`) ?? 2} ox={ox} oz={oz} />
        ))
      )}

      {/* Ground plane */}
      <mesh position={[0, -0.014, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[floorW, floorH]} />
        <meshStandardMaterial color="#F8FAFC" roughness={1} />
      </mesh>

      {/* Grid lines */}
      <gridHelper args={[floorW, Math.max(system.rows, system.cols), "#CBD5E1", "#E2E8F0"]} position={[0, -0.006, 0]} />

      {/* Axis labels */}
      {Array.from({ length: system.rows }).map((_, r) => (
        <Html key={`row-${r}`} position={[-ox - 0.85, 0.01, r - oz]} center distanceFactor={9}>
          <span className="axis-tick">{r}</span>
        </Html>
      ))}
      {Array.from({ length: system.cols }).map((_, c) => (
        <Html key={`col-${c}`} position={[c - ox, 0.01, -oz - 0.85]} center distanceFactor={9}>
          <span className="axis-tick">{c}</span>
        </Html>
      ))}

      <OrbitControls enableDamping dampingFactor={0.07} maxPolarAngle={Math.PI / 2.1} />
    </>
  );
}

/* ─────────────────────────────────────────────
   Color Legend
   ───────────────────────────────────────────── */
function ColorLegend() {
  const gradient = `linear-gradient(90deg, ${VIRIDIS_STOPS.map(
    ([r, g, b]) => `rgb(${r},${g},${b})`
  ).join(", ")})`;

  return (
    <div className="legend">
      <span>0</span>
      <div className="legend-bar" style={{ background: gradient }} />
      <span>máx</span>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Probability Matrix — adaptive for any grid size
   Small grids (≤6×6): labeled cells
   Large grids: compact heatmap with tooltips only
   ───────────────────────────────────────────── */
function Matrix({ grid, cols, rows }: { grid: number[][], cols: number, rows: number }) {
  const maxP = Math.max(...grid.flat(), 1e-9);
  const isCompact = cols > 4 || rows > 4;
  const [hoveredCell, setHoveredCell] = useState<[number,number] | null>(null);

  return (
    <div className="matrix-wrap">
      {/* Grid */}
      <div
        className={`matrix${isCompact ? " matrix-compact" : ""}`}
        style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
      >
        {grid.map((row, i) =>
          row.map((value, j) => {
            const intensity = maxP > 0 ? value / maxP : 0;
            const isMax = value > 1e-9 && Math.abs(value - maxP) < 1e-9;
            return (
              <div
                key={`${i}-${j}`}
                className={`cell${isMax ? " cell-max" : ""}${isCompact ? " cell-heatmap" : ""}`}
                style={{
                  background: isCompact
                    ? `rgba(79, 70, 229, ${Math.max(intensity * 0.85, intensity > 0.001 ? 0.06 : 0).toFixed(3)})`
                    : `rgba(79, 70, 229, ${(intensity * 0.15).toFixed(3)})`,
                }}
                title={`(${i},${j}) — P = ${value.toFixed(6)}`}
                onMouseEnter={() => isCompact && setHoveredCell([i, j])}
                onMouseLeave={() => isCompact && setHoveredCell(null)}
              >
                {!isCompact && (
                  <>
                    <span>{value.toFixed(3)}</span>
                    <small>({i},{j})</small>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Floating tooltip for compact mode */}
      {isCompact && hoveredCell && (
        <div className="matrix-tooltip">
          <span className="mt-coord">({hoveredCell[0]},{hoveredCell[1]})</span>
          <span className="mt-val">
            P = {grid[hoveredCell[0]]?.[hoveredCell[1]]?.toFixed(5) ?? "—"}
          </span>
        </div>
      )}

      {/* Legend for compact heatmap */}
      {isCompact && (
        <div className="matrix-legend">
          <span>0</span>
          <div className="matrix-legend-bar" />
          <span>máx ({maxP.toFixed(3)})</span>
        </div>
      )}
    </div>
  );
}


/* ───────────────────────────────────────────
   Dirac Notation — compact sidebar preview
   ─────────────────────────────────────────── */
function DiracPanel({
  state,
  step,
  system,
  onExpand,
}: {
  state: Float64Array;
  step: number;
  system: QuantumSystem;
  onExpand: () => void;
}) {
  const terms = system.diracTerms(state);

  return (
    <>
      <div className="dirac-head">
        |ψ<sub>{step}</sub>⟩ =
      </div>

      {/* Preview — chips overflow and fade out at the bottom */}
      <div className="dirac-preview">
        {terms.length === 0 && <span className="term-chip zero">0</span>}
        {terms.map((term, idx) => (
          <span
            key={idx}
            className={`term-chip ${term.sign === "−" ? "neg" : "pos"}`}
          >
            <span className="term-sign">{term.sign}</span>
            {term.coeff && <span className="term-coeff">{term.coeff}</span>}
            <span className="term-ket">
              |({term.from[0]},{term.from[1]}),({term.to[0]},{term.to[1]})⟩
            </span>
          </span>
        ))}
      </div>

      <button
        className="dirac-expand-btn"
        onClick={onExpand}
        title="Ver estado completo"
        aria-label="Expandir estado quântico completo"
      >
        <Maximize2 size={11} />
        Ver estado completo ({terms.length} termo{terms.length !== 1 ? "s" : ""})
      </button>
    </>
  );
}

/* ───────────────────────────────────────────
   Dirac Modal — full popup with all terms
   ─────────────────────────────────────────── */
function DiracModal({
  state,
  step,
  normVal,
  totalP,
  system,
  onClose,
}: {
  state: Float64Array;
  step: number;
  normVal: number;
  totalP: number;
  system: QuantumSystem;
  onClose: () => void;
}) {
  const terms = system.diracTerms(state);

  // Close on Escape key
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="dirac-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label={`Estado quântico no passo ${step}`}
    >
      <div className="dirac-modal">
        {/* Header */}
        <div className="modal-header">
          <div>
            <div className="modal-title">
              |ψ<sub>{step}</sub>⟩ =
            </div>
            <div className="modal-subtitle">
              Estado quântico completo — passo t = {step} · {terms.length} termo{terms.length !== 1 ? "s" : ""}
            </div>
          </div>
          <button
            className="modal-close"
            onClick={onClose}
            aria-label="Fechar"
            title="Fechar (Esc)"
          >
            ×
          </button>
        </div>

        <div className="modal-divider" />

        {/* All terms */}
        <div className="dirac-modal-terms">
          {terms.length === 0 && <span className="term-chip zero">0</span>}
          {terms.map((term, idx) => (
            <span
              key={idx}
              className={`term-chip ${term.sign === "−" ? "neg" : "pos"}`}
            >
              <span className="term-sign">{term.sign}</span>
              {term.coeff && <span className="term-coeff">{term.coeff}</span>}
              <span className="term-ket">
                |({term.from[0]},{term.from[1]}),({term.to[0]},{term.to[1]})⟩
              </span>
            </span>
          ))}
        </div>

        {/* Footer with norm / total P */}
        <div className="modal-footer">
          <span>‖ψ‖ = <strong>{normVal.toFixed(6)}</strong></span>
          <span>Σ P(v) = <strong>{totalP.toFixed(6)}</strong></span>
          <span style={{ marginLeft: "auto", color: "var(--t3)" }}>Pressione Esc para fechar</span>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Loading overlay — shown while Worker computes
   ───────────────────────────────────────────── */
function LoadingOverlay({ pct }: { pct: number }) {
  return (
    <div className="loading-overlay" role="status" aria-live="polite">
      <div className="loading-card">
        <div className="loading-icon">⟨ψ|</div>
        <div className="loading-title">Calculando simulação…</div>
        <div className="loading-sub">Motor esparso · {pct}% concluído</div>
        <div className="loading-bar-track">
          <div className="loading-bar-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="loading-detail">
          Cada passo usa O(|arcos|) operações, não O(|arcos|²)
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   App
   ───────────────────────────────────────────── */
export default function App() {
  const [activeTab, setActiveTab] = useState<"visual" | "lab">("visual");

  const [params, setParams] = useState<SimulationParams>({
    config: { rows: 3, cols: 3, boundary: "open", defaultCoin: "mixed", evolutionOrder: "SC" },
    tMax: 300,
    initialRow: 1,
    initialCol: 1,
    initialDirRow: 0,
    initialDirCol: 1,
  });

  // ── History state managed via Web Worker ──────────────────────────────────
  const [historyBuffer, setHistoryBuffer] = useState<Float64Array | null>(null);
  const [arcCount, setArcCount]           = useState(0);
  const [workerProgress, setWorkerProgress] = useState<number | null>(null); // null = idle
  const workerRef = useRef<Worker | null>(null);

  const system = useMemo(() => new QuantumSystem(params.config), [params.config]);
  const initialArc = useMemo(
    () => system.getInitialArcIndex(params.initialRow, params.initialCol, params.initialDirRow, params.initialDirCol),
    [system, params]
  );

  // Launch Worker whenever params change
  useEffect(() => {
    // Terminate any existing Worker
    if (workerRef.current) {
      workerRef.current.terminate();
    }

    setHistoryBuffer(null);
    setWorkerProgress(0);

    const worker = new Worker(
      new URL("./quantum.worker.ts", import.meta.url),
      { type: "module" }
    );
    workerRef.current = worker;

    const input: WorkerInput = {
      config: params.config,
      tMax: params.tMax,
      initialArc,
    };
    worker.postMessage(input);

    worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const msg = e.data;
      if (msg.type === "progress") {
        setWorkerProgress(msg.pct);
      } else if (msg.type === "done") {
        const flat = new Float64Array(msg.historyBuffer);
        setHistoryBuffer(flat);
        setArcCount(msg.arcCount);
        setWorkerProgress(null);
      } else if (msg.type === "error") {
        console.error("Worker error:", msg.message);
        setWorkerProgress(null);
      }
    };

    return () => {
      worker.terminate();
    };
  }, [params, initialArc]);

  const [step,       setStep]       = useState(0);
  const [playing,    setPlaying]    = useState(false);
  const [speed,      setSpeed]      = useState(700);
  const [showDirac,  setShowDirac]  = useState(false);

  // Reset step when new history arrives
  useEffect(() => {
    setStep(0);
    setPlaying(false);
  }, [historyBuffer]);

  // Derive current state from flat buffer
  const state: Float64Array = useMemo(() => {
    if (!historyBuffer || arcCount === 0) return new Float64Array(0);
    const start = step * arcCount;
    return historyBuffer.subarray(start, start + arcCount);
  }, [historyBuffer, arcCount, step]);

  const grid  = useMemo(() => {
    if (state.length === 0) return Array.from({ length: system.rows }, () => Array(system.cols).fill(0));
    return system.probabilities(state);
  }, [system, state]);

  /* Auto-play */
  useEffect(() => {
    if (!playing) return;
    if (step >= params.tMax) { setPlaying(false); return; }
    const id = window.setTimeout(() => setStep((s) => s + 1), speed);
    return () => window.clearTimeout(id);
  }, [playing, step, speed]);

  /* Keyboard shortcuts */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          setPlaying(false);
          setStep((s) => Math.max(0, s - 1));
          break;
        case "ArrowRight":
          e.preventDefault();
          setPlaying(false);
          setStep((s) => Math.min(params.tMax, s + 1));
          break;
        case " ":
          e.preventDefault();
          setPlaying((p) => !p);
          break;
        case "Home":
          e.preventDefault();
          setPlaying(false);
          setStep(0);
          break;
        case "End":
          e.preventDefault();
          setPlaying(false);
          setStep(params.tMax);
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* Derived values */
  const total     = grid.flat().reduce((a, b) => a + b, 0);
  const maxValue  = Math.max(...grid.flat());
  const maxIndex  = grid.flat().indexOf(maxValue);
  const maxVertex: Vertex = [Math.floor(maxIndex / system.cols), maxIndex % system.cols];
  const sliderPct = (step / params.tMax) * 100;
  const normVal   = norm(state);

  // Evolution formula label
  const formulaLabel = params.config.evolutionOrder === "CS" ? "U = C · S" : "U = S · C";

  const isLoading = workerProgress !== null;

  return (
    <div className={`app${activeTab === "visual" ? " has-controls" : ""}`}>

      {/* Loading overlay */}
      {isLoading && <LoadingOverlay pct={workerProgress ?? 0} />}

      {/* ── Header ──────────────────────────────────── */}
      <header className="header">
        <div className="header-left">
          <div className="header-logo" aria-hidden="true">ψ</div>
          <div className="header-meta">
            <div className="eyebrow">Quantum Walk Laboratory</div>
            <h1>Simulação Quântica</h1>
          </div>
          <div className="header-tabs">
            <button
              className={`tab-btn ${activeTab === "visual" ? "active" : ""}`}
              onClick={() => setActiveTab("visual")}
            >
              Visualização
            </button>
            <button
              className={`tab-btn ${activeTab === "lab" ? "active" : ""}`}
              onClick={() => setActiveTab("lab")}
            >
              Laboratório
            </button>
          </div>
        </div>
        <div className="header-right">
          <div className="kbd-hint" aria-label="Atalhos de teclado">
            <kbd className="kbd">←</kbd>
            <kbd className="kbd">→</kbd>
            <span>navegar</span>
            <kbd className="kbd">Space</kbd>
            <span>play</span>
            <kbd className="kbd">Home</kbd>
            <kbd className="kbd">End</kbd>
          </div>
          <div className="step-badge" aria-live="polite">t = {step} / {params.tMax}</div>
        </div>
      </header>

      {activeTab === "lab" ? (
        <LabPanel
          params={params}
          onChange={(newParams) => {
            setParams(newParams);
            setStep(0);
            setPlaying(false);
          }}
          onApply={() => setActiveTab("visual")}
        />
      ) : (
        <>
          {/* ── Workspace ───────────────────────────────── */}
          <section className="workspace">

            {/* Left: 3D Visualization */}
            <div className="visual-card">
              <div className="card-title">
                <span>Evolução da Distribuição</span>
                <div className="card-title-right">
                  <ColorLegend />
                  <span className="hint">Arraste · Scroll para zoom · Hover nos vértices</span>
                </div>
              </div>
              <div className="canvas-wrap">
                <Canvas shadows>
                  <Scene grid={grid} system={system} />
                </Canvas>
              </div>
            </div>

            {/* Right: Information Panels */}
            <aside className="side">

              {/* Dirac State — compact fixed height */}
              <section className="panel panel-dirac">
                <div className="panel-label">Estado de Dirac</div>
                <DiracPanel
                  state={state}
                  step={step}
                  system={system}
                  onExpand={() => setShowDirac(true)}
                />
              </section>

              {/* Metrics row — Verificação + Evolução merged into one panel */}
              <section className="panel panel-metrics">
                <div className="panel-label">Métricas &amp; Evolução</div>
                <div className="metrics-body">
                  {/* Stats */}
                  <div className="stats">
                    <div className="stat-card">
                      <div className="stat-label">‖ψ‖</div>
                      <div className="stat-value">{normVal.toFixed(4)}</div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-label">Σ P(v)</div>
                      <div className="stat-value">{total.toFixed(4)}</div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-label">P máx</div>
                      <div className="stat-value accent">{maxValue.toFixed(4)}</div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-label">Vértice</div>
                      <div className="stat-value">({maxVertex[0]},{maxVertex[1]})</div>
                    </div>
                  </div>
                  {/* Evolution formula inline */}
                  <div className="evo-inline">
                    <span className="evo-formula">
                      |ψ<sub>{step + 1}</sub>⟩ = U|ψ<sub>{step}</sub>⟩
                    </span>
                    <span className="evo-sep">·</span>
                    <span className="evo-formula">{formulaLabel}</span>
                  </div>
                </div>
              </section>

              {/* Probability Matrix — takes all remaining space */}
              <section className="panel panel-matrix">
                <div className="panel-label">Distribuição P(v)</div>
                <Matrix grid={grid} cols={system.cols} rows={system.rows} />
              </section>

            </aside>
          </section>

          {/* ── Controls Bar ────────────────────────────── */}
          <div className="controls-bar" role="toolbar" aria-label="Controles de reprodução">

            {/* Playback buttons */}
            <div className="playback">
              <button
                id="btn-reset"
                className="ctrl-btn"
                onClick={() => { setStep(0); setPlaying(false); }}
                disabled={step === 0 || isLoading}
                title="Reiniciar — Home"
                aria-label="Reiniciar"
              >
                <RotateCcw size={13} />
              </button>

              <button
                id="btn-prev"
                className="ctrl-btn"
                onClick={() => { setPlaying(false); setStep((s) => Math.max(0, s - 1)); }}
                disabled={step === 0 || isLoading}
                title="Passo anterior — ←"
                aria-label="Passo anterior"
              >
                <ChevronLeft size={15} />
              </button>

              <button
                id="btn-play"
                className="ctrl-btn play-btn"
                onClick={() => setPlaying((p) => !p)}
                disabled={(step >= params.tMax && !playing) || isLoading}
                title={playing ? "Pausar — Space" : "Reproduzir — Space"}
                aria-label={playing ? "Pausar" : "Reproduzir"}
              >
                {playing ? <Pause size={15} /> : <Play size={15} />}
              </button>

              <button
                id="btn-next"
                className="ctrl-btn"
                onClick={() => { setPlaying(false); setStep((s) => Math.min(params.tMax, s + 1)); }}
                disabled={step >= params.tMax || isLoading}
                title="Próximo passo — →"
                aria-label="Próximo passo"
              >
                <ChevronRight size={15} />
              </button>
            </div>

            <div className="ctrl-divider" aria-hidden="true" />

            {/* Timeline Slider */}
            <div className="timeline-area">
              <span className="timeline-counter" aria-live="polite">
                t = {step} / {params.tMax}
              </span>
              <input
                id="timeline-slider"
                type="range"
                className="timeline-slider"
                min={0}
                max={params.tMax}
                value={step}
                disabled={isLoading}
                style={{ "--pct": sliderPct } as React.CSSProperties}
                onChange={(e) => {
                  setPlaying(false);
                  setStep(Number(e.target.value));
                }}
                aria-label={`Passo temporal: ${step} de ${params.tMax}`}
                aria-valuemin={0}
                aria-valuemax={params.tMax}
                aria-valuenow={step}
              />
            </div>

            <div className="ctrl-divider" aria-hidden="true" />

            {/* Speed chips */}
            <div className="speed-group" role="group" aria-label="Velocidade de reprodução">
              <span className="speed-label">vel.</span>
              {SPEEDS.map((s) => (
                <button
                  key={s.label}
                  className={`speed-chip${speed === s.ms ? " active" : ""}`}
                  onClick={() => setSpeed(s.ms)}
                  aria-pressed={speed === s.ms}
                >
                  {s.label}
                </button>
              ))}
            </div>

          </div>
        </>
      )}



      {/* Dirac Modal */}
      {showDirac && (
        <DiracModal
          state={state}
          step={step}
          normVal={normVal}
          totalP={total}
          system={system}
          onClose={() => setShowDirac(false)}
        />
      )}
    </div>
  );
}
