import { useEffect, useState } from 'react';
import { analyzeCreativeDna, applyCreativeDna, fileToDataUrl, hasKoreanDna, localizeCreativeDna } from '../../lib/creativeDnaApi';
import { scrollToAndHighlightAppliedCuts } from '../../lib/dnaHighlight';
import { supabase } from '../../lib/supabaseClient';
import type { Project } from '../../types';

interface Props {
  project: Project;
  onBeforeApply: () => void;
  onApplied: (changes: string[], updatedProject: Project) => void;
}

type ReferenceMode = 'image_upload' | 'image_url' | 'text';

interface ApplyStatus {
  appliedCount: number;
  totalCount: number;
  firstAppliedCutId: string | null;
}

export default function CreativeDnaPanel({ project, onBeforeApply, onApplied }: Props) {
  const [mode, setMode] = useState<ReferenceMode>('image_upload');
  const [imageUrlInput, setImageUrlInput] = useState('');
  const [textInput, setTextInput] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applyStatus, setApplyStatus] = useState<ApplyStatus | null>(null);

  const dna = project.creative_dna;

  async function refreshProject() {
    const { data } = await supabase.from('projects').select('*').eq('id', project.id).single();
    return data as Project | null;
  }

  // Projects analyzed before Korean display fields existed only have the
  // English Creative DNA. Backfill the Korean mirrors once, lazily, the
  // first time the project is opened — this only adds "...Ko" fields and
  // never touches the English data used for storyboard generation.
  useEffect(() => {
    if (!dna || hasKoreanDna(dna)) return;
    let cancelled = false;
    localizeCreativeDna(project.id)
      .then(async () => {
        if (cancelled) return;
        const updated = await refreshProject();
        if (updated && !cancelled) onApplied([], updated);
      })
      .catch((err) => {
        console.warn('Failed to localize Creative DNA:', err);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, dna]);

  async function handleImageFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setApplyStatus(null);
    setAnalyzing(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      await analyzeCreativeDna(project.id, { imageUrl: dataUrl });
      const updated = await refreshProject();
      if (updated) onApplied([], updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleImageUrlSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!imageUrlInput.trim()) return;
    setError(null);
    setApplyStatus(null);
    setAnalyzing(true);
    try {
      await analyzeCreativeDna(project.id, { imageUrl: imageUrlInput.trim() });
      const updated = await refreshProject();
      if (updated) onApplied([], updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleTextSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!textInput.trim()) return;
    setError(null);
    setApplyStatus(null);
    setAnalyzing(true);
    try {
      await analyzeCreativeDna(project.id, { textDescription: textInput.trim() });
      const updated = await refreshProject();
      if (updated) onApplied([], updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleApplyDna() {
    if (!dna) return;
    setError(null);
    setApplyStatus(null);
    onBeforeApply();
    setApplying(true);
    try {
      const result = await applyCreativeDna(project.id, dna);
      const updated = await refreshProject();
      if (updated) onApplied(result.changes, updated);
      setApplyStatus({
        appliedCount: result.appliedCount,
        totalCount: result.totalCount,
        firstAppliedCutId: result.firstAppliedCutId,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  }

  function handleViewAppliedCuts() {
    if (applyStatus?.firstAppliedCutId) scrollToAndHighlightAppliedCuts(applyStatus.firstAppliedCutId);
  }

  return (
    <div className="card prompt-card creative-dna-card">
      <span className="field-label">Creative DNA</span>
      <p>레퍼런스 이미지나 설명을 분석해서, 그 연출 언어를 스토리보드에 적용해요. (제품/메시지는 그대로 유지)</p>

      <div className="dna-mode-tabs">
        <button type="button" className={`btn-text${mode === 'image_upload' ? ' dna-mode-active' : ''}`}
          onClick={() => setMode('image_upload')}>이미지 업로드</button>
        <button type="button" className={`btn-text${mode === 'image_url' ? ' dna-mode-active' : ''}`}
          onClick={() => setMode('image_url')}>이미지 URL</button>
        <button type="button" className={`btn-text${mode === 'text' ? ' dna-mode-active' : ''}`}
          onClick={() => setMode('text')}>텍스트 설명</button>
      </div>

      {mode === 'image_upload' && (
        <input type="file" accept="image/*" onChange={handleImageFileChange} disabled={analyzing} />
      )}

      {mode === 'image_url' && (
        <form onSubmit={handleImageUrlSubmit} className="ask-director-form">
          <input value={imageUrlInput} onChange={(e) => setImageUrlInput(e.target.value)}
            placeholder="https://…" disabled={analyzing} />
          <button type="submit" className="btn-secondary btn-small" disabled={analyzing || !imageUrlInput.trim()}>
            {analyzing ? '분석 중...' : '분석하기'}
          </button>
        </form>
      )}

      {mode === 'text' && (
        <form onSubmit={handleTextSubmit} className="ask-director-form">
          <textarea value={textInput} onChange={(e) => setTextInput(e.target.value)}
            placeholder="예: 흑백에 강한 대비, 클로즈업 위주의 미니멀한 패션 필름" disabled={analyzing} />
          <button type="submit" className="btn-secondary btn-small" disabled={analyzing || !textInput.trim()}>
            {analyzing ? '분석 중...' : '분석하기'}
          </button>
        </form>
      )}

      {analyzing && <p className="director-loading">Creative DNA를 분석하는 중...</p>}
      {error && <p className="error">{error}</p>}

      {dna && (
        <div className="dna-result">
          <span className="field-label">비주얼 톤</span>
          <div className="dna-scores">
            {dna.visualLanguage.map((v) => (
              <div className="dna-score-row" key={v.label}>
                <span className="dna-score-label">{v.labelKo ?? v.label}</span>
                <div className="dna-score-bar">
                  <div className="dna-score-fill" style={{ width: `${Math.max(0, Math.min(100, v.score))}%` }} />
                </div>
                <span className="dna-score-value">{v.score}%</span>
              </div>
            ))}
          </div>

          <DnaList title="카메라 연출" items={dna.cameraDna} itemsKo={dna.cameraDnaKo} />
          <DnaList title="조명" items={dna.lightingDna} itemsKo={dna.lightingDnaKo} />
          <DnaList title="화면 구성" items={dna.compositionDna} itemsKo={dna.compositionDnaKo} />
          <DnaList title="편집 / 리듬" items={dna.editRhythmDna} itemsKo={dna.editRhythmDnaKo} />
          <DnaList title="컬러 / 무드" items={dna.colorMood} itemsKo={dna.colorMoodKo} />
          <DnaList title="크리에이티브 방향" items={dna.creativePrinciples} itemsKo={dna.creativePrinciplesKo} />

          <button type="button" className="btn-primary btn-block" onClick={handleApplyDna} disabled={applying}>
            {applying ? 'DNA를 적용하는 중...' : '스토리보드에 DNA 적용'}
          </button>

          {applyStatus && (
            <div className="dna-apply-status">
              <span className="dna-apply-status-title">✓ Creative DNA 적용됨</span>
              <p>
                {applyStatus.totalCount}개 컷 중 {applyStatus.appliedCount}개 컷에 레퍼런스 연출 요소가
                반영되었습니다.
              </p>
              {applyStatus.firstAppliedCutId && (
                <button type="button" className="btn-text" onClick={handleViewAppliedCuts}>
                  적용된 컷 보기 →
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DnaList({ title, items, itemsKo }: { title: string; items: string[]; itemsKo?: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="dna-list">
      <span className="dna-list-title">{title}</span>
      <ul>
        {items.map((item, i) => <li key={i}>{itemsKo?.[i] ?? item}</li>)}
      </ul>
    </div>
  );
}
