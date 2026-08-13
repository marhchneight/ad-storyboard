import { useEffect, useState } from 'react';
import { DIRECTOR_PRESETS, type DirectorPreset } from '../../lib/directorApi';

interface Props {
  directing: boolean;
  onApplyPreset: (preset: DirectorPreset) => void;
  directorInstruction: string;
  onDirectorInstructionChange: (value: string) => void;
  onAskDirector: (e: React.FormEvent) => void;
  lastChanges: string[] | null;
  onMakeItCrazy: () => void;
  rouletteConstraint: string | null;
  onOpenRoulette: () => void;
  onShuffleRoulette: () => void;
  onApplyRoulette: () => void;
  onCancelRoulette: () => void;
}

export default function DirectorControls({
  directing, onApplyPreset, directorInstruction, onDirectorInstructionChange, onAskDirector, lastChanges,
  onMakeItCrazy, rouletteConstraint, onOpenRoulette, onShuffleRoulette, onApplyRoulette, onCancelRoulette,
}: Props) {
  // Visual-only "currently applying" indicator (not a persistent selection —
  // presets are one-shot actions, no mode is actually "chosen" server-side).
  // Cleared whenever the in-flight AI request finishes.
  const [activePresetId, setActivePresetId] = useState<DirectorPreset | null>(null);

  useEffect(() => {
    if (!directing) setActivePresetId(null);
  }, [directing]);

  function handlePresetClick(preset: DirectorPreset) {
    setActivePresetId(preset);
    onApplyPreset(preset);
  }

  return (
    <div className="card prompt-card director-controls">
      <span className="field-label">Director Controls</span>
      <div className="preset-row">
        {DIRECTOR_PRESETS.map((preset) => (
          <button key={preset.id} type="button"
            className={`btn-secondary btn-small preset-btn${activePresetId === preset.id ? ' preset-btn-active' : ''}`}
            onClick={() => handlePresetClick(preset.id)} disabled={directing}
            title={preset.description}>
            {preset.label}
          </button>
        ))}
      </div>

      <form onSubmit={onAskDirector} className="ask-director-form">
        <span className="field-label">Ask the Director</span>
        <textarea value={directorInstruction} onChange={(e) => onDirectorInstructionChange(e.target.value)}
          placeholder="Tell the director what to change…" disabled={directing} />
        <button type="submit" className="btn-secondary" disabled={directing || !directorInstruction.trim()}>
          {directing ? '연출 방향을 다시 잡는 중...' : '감독에게 지시하기'}
        </button>
      </form>

      {lastChanges && lastChanges.length > 0 && (
        <div className="changes-summary">
          <span className="field-label">Changed</span>
          <ul>
            {lastChanges.map((change, i) => <li key={i}>{change}</li>)}
          </ul>
        </div>
      )}

      <div className="signature-row">
        <button type="button" className="btn-crazy" onClick={onMakeItCrazy} disabled={directing}>
          MAKE IT CRAZY
        </button>
        <button type="button" className="btn-secondary" onClick={onOpenRoulette} disabled={directing}>
          Creative Roulette
        </button>
      </div>

      {rouletteConstraint && (
        <div className="roulette-card">
          <span className="field-label">Creative Constraint</span>
          <p>{rouletteConstraint}</p>
          <div className="roulette-actions">
            <button type="button" className="btn-primary btn-small" onClick={onApplyRoulette} disabled={directing}>
              Apply
            </button>
            <button type="button" className="btn-secondary btn-small" onClick={onShuffleRoulette} disabled={directing}>
              Shuffle
            </button>
            <button type="button" className="btn-text" onClick={onCancelRoulette} disabled={directing}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
