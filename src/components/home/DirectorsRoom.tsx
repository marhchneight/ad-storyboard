import { useEffect, useState } from 'react';
import { generateDirectingOptions } from '../../lib/directorsRoomApi';
import type { CreativeBrief, CreativeDna, CreativeRisk, CreativeTreatment, DirectingOption } from '../../types';

interface Props {
  treatment: CreativeTreatment;
  context: { freeformIdea?: string; brief?: CreativeBrief; dna?: CreativeDna };
  busy: boolean;
  onSelect: (direction: DirectingOption, creativeRisk: CreativeRisk) => void;
  onSkip: () => void;
  onBack: () => void;
}

const RISK_OPTIONS: { id: CreativeRisk; label: string }[] = [
  { id: 'safe', label: '안정적' },
  { id: 'balanced', label: '균형' },
  { id: 'creative', label: '크리에이티브' },
  { id: 'bold', label: '과감함' },
];

const DNA_USAGE_LABELS: Record<string, string> = {
  active: '적극 활용',
  partial: '부분 활용',
  reinterpreted: '재해석',
};

export default function DirectorsRoom({ treatment, context, busy, onSelect, onSkip, onBack }: Props) {
  const [creativeRisk, setCreativeRisk] = useState<CreativeRisk>('creative');
  const [options, setOptions] = useState<DirectingOption[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    generateDirectingOptions({ ...context, treatment, creativeRisk })
      .then((result) => { if (!cancelled) setOptions(result); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creativeRisk]);

  return (
    <div className="director-room">
      <button type="button" className="btn-text" onClick={onBack} disabled={busy}>← 이전으로</button>
      <h2 className="director-room-title">어떤 방향으로 연출할까요?</h2>
      <p className="director-room-subtitle">같은 아이디어도 연출에 따라 완전히 다른 광고가 됩니다.</p>

      <div className="field">
        <span className="field-label">연출 강도</span>
        <div className="aspect-ratio-options">
          {RISK_OPTIONS.map((opt) => (
            <button key={opt.id} type="button"
              className={`aspect-ratio-btn${creativeRisk === opt.id ? ' aspect-ratio-btn-active' : ''}`}
              onClick={() => setCreativeRisk(opt.id)} disabled={loading || busy}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="director-loading">연출 방향을 구상하는 중...</p>}
      {error && <p className="error">{error}</p>}

      {options && !loading && (
        <div className="director-room-grid">
          {options.map((opt) => {
            const tagLine = [opt.visualApproach, opt.cameraApproach, opt.editRhythm].filter(Boolean).join(' · ');
            return (
              <div className="director-card" key={opt.id}>
                <h3>{opt.titleKo}</h3>
                <p className="director-card-summary">{opt.summaryKo}</p>
                {tagLine && <p className="director-card-tags">{tagLine}</p>}
                {opt.keyTechniques.length > 0 && (
                  <p className="director-card-techniques">{opt.keyTechniques.join(' · ')}</p>
                )}
                {opt.referenceDnaUsage && (
                  <div className="director-card-secondary">
                    <span className="director-card-secondary-label">
                      레퍼런스 활용 · {DNA_USAGE_LABELS[opt.referenceDnaUsage.level] ?? opt.referenceDnaUsage.level}
                    </span>
                    <p>{opt.referenceDnaUsage.summaryKo}</p>
                  </div>
                )}
                {opt.brandFitReason && (
                  <div className="director-card-secondary">
                    <span className="director-card-secondary-label">브랜드 적합성</span>
                    <p>{opt.brandFitReason}</p>
                  </div>
                )}
                <button type="button" className="btn-accent btn-block" disabled={busy}
                  onClick={() => onSelect(opt, creativeRisk)}>
                  {busy ? '연출 중...' : '이 방향으로 만들기'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      <button type="button" className="btn-text director-room-skip" onClick={onSkip} disabled={busy}>
        추천 없이 바로 만들기 →
      </button>
    </div>
  );
}
