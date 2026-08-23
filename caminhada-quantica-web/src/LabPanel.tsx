import { useState } from "react";
import type { QuantumWalkConfig } from "./quantum";

export type SimulationParams = {
  config: QuantumWalkConfig;
  tMax: number;
  initialRow: number;
  initialCol: number;
  initialDirRow: number;
  initialDirCol: number;
};

const DEFAULT_PARAMS: SimulationParams = {
  config: { rows: 3, cols: 3, boundary: "open", defaultCoin: "mixed" },
  tMax: 300,
  initialRow: 1,
  initialCol: 1,
  initialDirRow: 0,
  initialDirCol: 1,
};

function Slider({
  label,
  min,
  max,
  step = 1,
  value,
  onChange,
  unit = "",
}: {
  label: string;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (v: number) => void;
  unit?: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="lab-field">
      <div className="lab-field-header">
        <label>{label}</label>
        <span className="lab-val">{value}{unit}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ "--pct": pct } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

function ToggleGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="lab-field-row">
      <label className="lab-field-label">{label}</label>
      <div className="lab-toggles">
        {options.map((opt) => (
          <button
            key={opt.value}
            className={`lab-toggle ${value === opt.value ? "active" : ""}`}
            onClick={() => onChange(opt.value)}
            title={opt.title}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function LabPanel({
  params,
  onChange,
  onApply,
}: {
  params: SimulationParams;
  onChange: (p: SimulationParams) => void;
  onApply: () => void;
}) {
  const [draft, setDraft] = useState<SimulationParams>(params);

  const update = (partial: Partial<SimulationParams>) => {
    setDraft((d) => ({ ...d, ...partial }));
  };

  const updateConfig = (partial: Partial<QuantumWalkConfig>) => {
    setDraft((d) => ({ ...d, config: { ...d.config, ...partial } }));
  };

  const handleApply = () => {
    onChange(draft);
    onApply();
  };

  const handleReset = () => {
    setDraft(DEFAULT_PARAMS);
    onChange(DEFAULT_PARAMS);
  };

  const centerRow = Math.floor((draft.config.rows - 1) / 2);
  const centerCol = Math.floor((draft.config.cols - 1) / 2);

  return (
    <div className="lab-container">
      <div className="lab-header">
        <div className="lab-header-icon">⚗</div>
        <h2>Laboratório de Experimentação</h2>
        <p>Configure os parâmetros da caminhada quântica para observar diferentes dinâmicas e topologias de grafo.</p>
      </div>

      <div className="lab-grid">

        {/* ── Geometria ─────────────────────────── */}
        <div className="lab-card">
          <div className="lab-card-header">
            <span className="lab-card-icon">▦</span>
            <h3>Geometria do Grafo</h3>
          </div>

          <Slider
            label="Linhas (M)"
            min={3} max={15}
            value={draft.config.rows}
            onChange={(v) => updateConfig({ rows: v })}
          />
          <Slider
            label="Colunas (N)"
            min={3} max={15}
            value={draft.config.cols}
            onChange={(v) => updateConfig({ cols: v })}
          />

          <div
            className="lab-preview-grid"
            style={{ gridTemplateColumns: `repeat(${draft.config.cols}, 1fr)` }}
          >
            {Array.from({ length: draft.config.rows }).map((_, r) =>
              Array.from({ length: draft.config.cols }).map((_, c) => (
                <div
                  key={`${r}-${c}`}
                  className={`lab-preview-cell ${r === centerRow && c === centerCol ? "center" : ""}`}
                />
              ))
            )}
          </div>

          <ToggleGroup
            label="Condição de Contorno"
            value={draft.config.boundary ?? "open"}
            options={[
              { value: "open", label: "Aberto (Malha)" },
              { value: "periodic", label: "Periódico (Toro)" },
            ]}
            onChange={(v) => updateConfig({ boundary: v as "open" | "periodic" })}
          />
        </div>

        {/* ── Sistema Quântico ───────────────────── */}
        <div className="lab-card">
          <div className="lab-card-header">
            <span className="lab-card-icon">⟨ψ|</span>
            <h3>Sistema Quântico</h3>
          </div>

          <Slider
            label="Passos Máximos"
            min={10} max={1000} step={10}
            value={draft.tMax}
            onChange={(v) => update({ tMax: v })}
            unit=" t"
          />

          <ToggleGroup
            label="Operador Moeda"
            value={draft.config.defaultCoin ?? "mixed"}
            options={[
              { value: "mixed", label: "Misto", title: "Hadamard nas bordas (grau 2), Grover no resto" },
              { value: "grover", label: "Grover (G)" },
              { value: "hadamard", label: "Hadamard (H)" },
            ]}
            onChange={(v) => updateConfig({ defaultCoin: v as "grover" | "hadamard" | "mixed" })}
          />

          <div className="lab-info-box">
            <div className="lab-info-row">
              <span>Arcos totais</span>
              <span className="lab-info-val">
                {/* Estimate: interior nodes have 4 neighbors */}
                {draft.config.boundary === "periodic"
                  ? draft.config.rows * draft.config.cols * 4
                  : 2 * (draft.config.rows * draft.config.cols * 4
                    - 2 * (draft.config.rows + draft.config.cols))}
              </span>
            </div>
            <div className="lab-info-row">
              <span>Dimensão de Hilbert</span>
              <span className="lab-info-val">
                ~{draft.config.boundary === "periodic"
                  ? draft.config.rows * draft.config.cols * 4
                  : 2 * (draft.config.rows * draft.config.cols * 4
                    - 2 * (draft.config.rows + draft.config.cols))}
              </span>
            </div>
          </div>
        </div>

        {/* ── Estado Inicial ────────────────────── */}
        <div className="lab-card">
          <div className="lab-card-header">
            <span className="lab-card-icon">|ψ₀⟩</span>
            <h3>Estado Inicial</h3>
          </div>

          <div className="lab-field-group">
            <div className="lab-field">
              <div className="lab-field-header">
                <label>Vértice — Linha</label>
                <span className="lab-val">{draft.initialRow}</span>
              </div>
              <input
                type="number"
                min={0}
                max={draft.config.rows - 1}
                value={draft.initialRow}
                onChange={(e) => update({ initialRow: Math.max(0, Math.min(Number(e.target.value), draft.config.rows - 1)) })}
              />
            </div>
            <div className="lab-field">
              <div className="lab-field-header">
                <label>Vértice — Coluna</label>
                <span className="lab-val">{draft.initialCol}</span>
              </div>
              <input
                type="number"
                min={0}
                max={draft.config.cols - 1}
                value={draft.initialCol}
                onChange={(e) => update({ initialCol: Math.max(0, Math.min(Number(e.target.value), draft.config.cols - 1)) })}
              />
            </div>
          </div>

          <div className="lab-field-group">
            <div className="lab-field">
              <div className="lab-field-header">
                <label>Direção — Linha</label>
                <span className="lab-val">{draft.initialDirRow}</span>
              </div>
              <input
                type="number"
                value={draft.initialDirRow}
                onChange={(e) => update({ initialDirRow: Number(e.target.value) })}
              />
            </div>
            <div className="lab-field">
              <div className="lab-field-header">
                <label>Direção — Coluna</label>
                <span className="lab-val">{draft.initialDirCol}</span>
              </div>
              <input
                type="number"
                value={draft.initialDirCol}
                onChange={(e) => update({ initialDirCol: Number(e.target.value) })}
              />
            </div>
          </div>

          <p className="lab-hint">
            O estado inicial é o arco de ({draft.initialRow},{draft.initialCol}) apontando para ({draft.initialDirRow},{draft.initialDirCol}). Se a direção não for um vizinho válido, usamos o primeiro vizinho como fallback.
          </p>

          <div className="lab-state-preview">
            <span className="lab-state-label">|ψ₀⟩ =</span>
            <span className="lab-state-ket">
              |({draft.initialRow},{draft.initialCol}),({draft.initialDirRow},{draft.initialDirCol})⟩
            </span>
          </div>
        </div>

      </div>

      {/* ── Actions ───────────────────────────── */}
      <div className="lab-actions">
        <button className="lab-btn secondary" onClick={handleReset}>
          Resetar Padrão
        </button>
        <button className="lab-btn primary" onClick={handleApply}>
          ▶ Iniciar Simulação
        </button>
      </div>
    </div>
  );
}
