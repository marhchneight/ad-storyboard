import { useState } from 'react';
import type { CreativeTreatment } from '../../types';

interface Props {
  treatment: CreativeTreatment;
  busy: boolean;
  onEnterDirectorsRoom: () => void;
  onTryAnother: () => void;
  onRevise: (instruction: string) => void;
}

export default function CreativeDirectionPanel({ treatment, busy, onEnterDirectorsRoom, onTryAnother, onRevise }: Props) {
  const [instruction, setInstruction] = useState('');

  function handleReviseSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!instruction.trim() || busy) return;
    onRevise(instruction.trim());
    setInstruction('');
  }

  const { approach } = treatment;
  const approachParts = [
    approach.duration ? `${approach.duration}초` : null,
    approach.estimatedShots ? `${approach.estimatedShots}컷` : null,
    approach.dialogueStyle,
    approach.productReveal ? `${approach.productReveal} reveal` : null,
    approach.cameraStyle,
  ].filter(Boolean);

  return (
    <div className="card creative-direction-panel">
      <span className="field-label">Creative Direction</span>
      <h2 className="cd-title">{treatment.title}</h2>
      <p className="cd-concept">{treatment.concept}</p>
      <p className="cd-treatment">{treatment.creativeDirection}</p>

      {treatment.visualLanguage.length > 0 && (
        <div className="cd-tags">
          {treatment.visualLanguage.map((tag) => (
            <span key={tag} className="cd-tag">{tag}</span>
          ))}
        </div>
      )}

      {approachParts.length > 0 && (
        <p className="cd-approach">{approachParts.join(' · ')}</p>
      )}

      {treatment.creativePrinciples.length > 0 && (
        <ul className="cd-principles">
          {treatment.creativePrinciples.map((p, i) => <li key={i}>{p}</li>)}
        </ul>
      )}

      <div className="cd-actions">
        <button type="button" className="btn-primary btn-block" onClick={onEnterDirectorsRoom} disabled={busy}>
          {busy ? '연출 방향을 준비하는 중...' : '연출 방향 정하기 →'}
        </button>
        <button type="button" className="btn-secondary" onClick={onTryAnother} disabled={busy}>
          Try Another Direction
        </button>
      </div>

      <form onSubmit={handleReviseSubmit} className="ask-director-form cd-revise-form">
        <span className="field-label">Tell the Director what to change</span>
        <textarea value={instruction} onChange={(e) => setInstruction(e.target.value)}
          placeholder="예: 조금 더 젊게. 제품을 더 빨리 보여줘." disabled={busy} />
        <button type="submit" className="btn-secondary btn-small" disabled={busy || !instruction.trim()}>
          {busy ? '반영 중...' : '반영하기'}
        </button>
      </form>
    </div>
  );
}
