import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera, Html } from "@react-three/drei";
import { Pause, Play, ChevronLeft, ChevronRight, RotateCcw, Maximize2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, useMemo } from "react";
import * as THREE from "three";
import {
  ARCS,
  ROWS,
  COLS,
  DEGREE,
  createHistory,
  dirac,
  diracTerms,
  norm,
  probabilities,
  type Vertex,
} from "./quantum";

/* ─────────────────────────────────────────────
   Constants
   ───────────────────────────────────────────── */
const T_MAX = 300;
const INITIAL_ARC = ARCS.findIndex(
  ([u, v]) => u[0] === 1 && u[1] === 1 && v[0] === 0 && v[1] === 1
);
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
}: {
  row: number;
  col: number;
  p: number;
  maxP: number;
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
  const x      = col - 1;
  const z      = row - 1;
  const degree = DEGREE.get(`${row},${col}`) ?? 2;

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
function Scene({ grid }: { grid: number[][] }) {
  const maxP = Math.max(...grid.flat(), 1e-6);

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
        shadow-camera-left={-4}
        shadow-camera-right={4}
        shadow-camera-top={4}
        shadow-camera-bottom={-4}
      />
      <directionalLight position={[-4, 2.5, -3]} intensity={0.4} />
      <hemisphereLight args={["#ffffff", "#e2e8f0", 0.6]} />
      {/* Subtle accent fill from below */}
      <pointLight position={[0, -1, 0]} intensity={0.15} color="#4F46E5" />

      {/* Bars */}
      {grid.map((row, i) =>
        row.map((p, j) => (
          <Bar key={`${i}-${j}`} row={i} col={j} p={p} maxP={maxP} />
        ))
      )}

      {/* Ground plane */}
      <mesh position={[0, -0.014, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[7, 7]} />
        <meshStandardMaterial color="#F8FAFC" roughness={1} />
      </mesh>

      {/* Grid lines */}
      <gridHelper args={[3.3, 3, "#CBD5E1", "#E2E8F0"]} position={[0, -0.006, 0]} />

      {/* Axis labels */}
      {[0, 1, 2].map((r) => (
        <Html key={`row-${r}`} position={[-1.85, 0.01, r - 1]} center distanceFactor={9}>
          <span className="axis-tick">{r}</span>
        </Html>
      ))}
      {[0, 1, 2].map((c) => (
        <Html key={`col-${c}`} position={[c - 1, 0.01, -1.85]} center distanceFactor={9}>
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
   Probability Matrix 3×3
   ───────────────────────────────────────────── */
function Matrix({ grid }: { grid: number[][] }) {
  const maxP = Math.max(...grid.flat(), 1e-9);

  return (
    <div className="matrix">
      {grid.map((row, i) =>
        row.map((value, j) => {
          const intensity = maxP > 0 ? value / maxP : 0;
          const isMax = value > 1e-9 && Math.abs(value - maxP) < 1e-9;
          return (
            <div
              key={`${i}-${j}`}
              className={`cell${isMax ? " cell-max" : ""}`}
              style={{
                background: `rgba(79, 70, 229, ${(intensity * 0.15).toFixed(3)})`,
              }}
              title={`Vértice (${i},${j}) — P = ${value.toFixed(6)}`}
            >
              <span>{value.toFixed(3)}</span>
              <small>({i},{j})</small>
            </div>
          );
        })
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
  onExpand,
}: {
  state: number[];
  step: number;
  onExpand: () => void;
}) {
  const terms = diracTerms(state);

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
  onClose,
}: {
  state: number[];
  step: number;
  normVal: number;
  totalP: number;
  onClose: () => void;
}) {
  const terms = diracTerms(state);

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
   App
   ───────────────────────────────────────────── */
export default function App() {
  const history = useMemo(() => createHistory(T_MAX, INITIAL_ARC), []);
  const [step,       setStep]       = useState(0);
  const [playing,    setPlaying]    = useState(false);
  const [speed,      setSpeed]      = useState(700);
  const [showDirac,  setShowDirac]  = useState(false);

  const state = history[step];
  const grid  = probabilities(state);

  /* Auto-play */
  useEffect(() => {
    if (!playing) return;
    if (step >= T_MAX) { setPlaying(false); return; }
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
          setStep((s) => Math.min(T_MAX, s + 1));
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
          setStep(T_MAX);
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
  const maxVertex: Vertex = [Math.floor(maxIndex / COLS), maxIndex % COLS];
  const sliderPct = (step / T_MAX) * 100;
  const normVal   = norm(state);

  return (
    <div className="app">

      {/* ── Header ──────────────────────────────────── */}
      <header className="header">
        <div className="header-left">
          <div className="header-logo" aria-hidden="true">ψ</div>
          <div className="header-meta">
            <div className="eyebrow">Simulação Quântica</div>
            <h1>Caminhada Quântica</h1>
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
          <div className="step-badge" aria-live="polite">t = {step} / {T_MAX}</div>
        </div>
      </header>

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
              <Scene grid={grid} />
            </Canvas>
          </div>
        </div>

        {/* Right: Information Panels */}
        <aside className="side">

          {/* Dirac State */}
          <section className="panel panel-dirac">
            <div className="panel-label">Estado de Dirac</div>
            <DiracPanel
              state={state}
              step={step}
              onExpand={() => setShowDirac(true)}
            />
          </section>

          {/* Side-by-side Panels */}
          <div className="panel-row">
            {/* Verification Stats */}
            <section className="panel">
              <div className="panel-label">Verificação</div>
              <div className="stats">
                <div className="stat-card">
                  <div className="stat-label">‖ψ‖</div>
                  <div className="stat-value">{normVal.toFixed(6)}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Σ P(v)</div>
                  <div className="stat-value">{total.toFixed(6)}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">P máx</div>
                  <div className="stat-value accent">{maxValue.toFixed(4)}</div>
                </div>
                <div className="stat-card">
                  <div className="stat-label">Vértice</div>
                  <div className="stat-value">
                    ({maxVertex[0]},{maxVertex[1]})
                  </div>
                </div>
              </div>
            </section>

            {/* Evolution Formula */}

          </div>

          {/* Probability Matrix */}
          <section className="panel">
            <div className="panel-label">Distribuição P(v)</div>
            <Matrix grid={grid} />
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
            disabled={step === 0}
            title="Reiniciar — Home"
            aria-label="Reiniciar"
          >
            <RotateCcw size={13} />
          </button>

          <button
            id="btn-prev"
            className="ctrl-btn"
            onClick={() => { setPlaying(false); setStep((s) => Math.max(0, s - 1)); }}
            disabled={step === 0}
            title="Passo anterior — ←"
            aria-label="Passo anterior"
          >
            <ChevronLeft size={15} />
          </button>

          <button
            id="btn-play"
            className="ctrl-btn play-btn"
            onClick={() => setPlaying((p) => !p)}
            disabled={step >= T_MAX && !playing}
            title={playing ? "Pausar — Space" : "Reproduzir — Space"}
            aria-label={playing ? "Pausar" : "Reproduzir"}
          >
            {playing ? <Pause size={15} /> : <Play size={15} />}
          </button>

          <button
            id="btn-next"
            className="ctrl-btn"
            onClick={() => { setPlaying(false); setStep((s) => Math.min(T_MAX, s + 1)); }}
            disabled={step >= T_MAX}
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
            t = {step} / {T_MAX}
          </span>
          <input
            id="timeline-slider"
            type="range"
            className="timeline-slider"
            min={0}
            max={T_MAX}
            value={step}
            style={{ "--pct": sliderPct } as React.CSSProperties}
            onChange={(e) => {
              setPlaying(false);
              setStep(Number(e.target.value));
            }}
            aria-label={`Passo temporal: ${step} de ${T_MAX}`}
            aria-valuemin={0}
            aria-valuemax={T_MAX}
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

      {/* Dirac Modal */}
      {showDirac && (
        <DiracModal
          state={state}
          step={step}
          normVal={normVal}
          totalP={total}
          onClose={() => setShowDirac(false)}
        />
      )}
    </div>
  );
}

// mantém a exportação de "dirac" (string única) disponível para quem
// preferir a formatação em texto corrido em vez dos chips.
export { dirac };
