import { useState, type ReactNode } from 'react';
import { analyzeCreativeDna, fileToDataUrl } from '../../lib/creativeDnaApi';
import { generateCreativeDirection, type SceneCountParams } from '../../lib/creativeDirectionApi';
import type { CreativeBrief, CreativeDna, CreativeTreatment } from '../../types';

type ReferenceInputMode = 'image_upload' | 'image_url' | 'text';

interface Props {
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
  onGenerated: (treatment: CreativeTreatment, context: { freeformIdea?: string; brief?: CreativeBrief; dna?: CreativeDna }) => void;
  onError: (message: string) => void;
  styleField: ReactNode;
  aspectRatioField: ReactNode;
  storyboardLengthField: ReactNode;
  sceneCountParams: SceneCountParams;
}

export default function ReferenceMode({
  busy, onBusyChange, onGenerated, onError, styleField, aspectRatioField, storyboardLengthField, sceneCountParams,
}: Props) {
  const [mode, setMode] = useState<ReferenceInputMode>('image_upload');
  const [imageUrlInput, setImageUrlInput] = useState('');
  const [textInput, setTextInput] = useState('');
  const [idea, setIdea] = useState('');
  const [dna, setDna] = useState<CreativeDna | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  async function analyze(input: { imageUrl?: string; textDescription?: string }) {
    setAnalyzing(true);
    try {
      const result = await analyzeCreativeDna(undefined, input);
      setDna(result);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleImageFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const dataUrl = await fileToDataUrl(file);
    await analyze({ imageUrl: dataUrl });
  }

  function handleImageUrlSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!imageUrlInput.trim()) return;
    analyze({ imageUrl: imageUrlInput.trim() });
  }

  function handleTextSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!textInput.trim()) return;
    analyze({ textDescription: textInput.trim() });
  }

  async function handleCreateDirection() {
    if (!dna || busy) return;
    onBusyChange(true);
    try {
      const context = {
        freeformIdea: idea.trim() || undefined,
        brief: idea.trim() ? ({ conceptDescription: idea.trim() } as CreativeBrief) : undefined,
        dna,
      };
      const treatment = await generateCreativeDirection({ ...context, ...sceneCountParams });
      onGenerated(treatment, context);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      onBusyChange(false);
    }
  }

  return (
    <div className="start-mode-panel">
      <p className="start-mode-desc">이런 visual language를 가진 새로운 광고를 만들어보세요.</p>
      <div className="dna-mode-tabs">
        <button type="button" className={`btn-text${mode === 'image_upload' ? ' dna-mode-active' : ''}`}
          onClick={() => setMode('image_upload')}>이미지 업로드</button>
        <button type="button" className={`btn-text${mode === 'image_url' ? ' dna-mode-active' : ''}`}
          onClick={() => setMode('image_url')}>이미지 URL</button>
        <button type="button" className={`btn-text${mode === 'text' ? ' dna-mode-active' : ''}`}
          onClick={() => setMode('text')}>텍스트 설명</button>
      </div>

      {mode === 'image_upload' && (
        <input type="file" accept="image/*" onChange={handleImageFileChange} disabled={analyzing || busy} />
      )}
      {mode === 'image_url' && (
        <form onSubmit={handleImageUrlSubmit} className="ask-director-form">
          <input value={imageUrlInput} onChange={(e) => setImageUrlInput(e.target.value)}
            placeholder="https://…" disabled={analyzing || busy} />
          <button type="submit" className="btn-secondary btn-small" disabled={analyzing || busy || !imageUrlInput.trim()}>
            {analyzing ? '분석 중...' : '분석하기'}
          </button>
        </form>
      )}
      {mode === 'text' && (
        <form onSubmit={handleTextSubmit} className="ask-director-form">
          <textarea value={textInput} onChange={(e) => setTextInput(e.target.value)}
            placeholder="예: 흑백에 강한 대비, 클로즈업 위주의 미니멀한 패션 필름" disabled={analyzing || busy} />
          <button type="submit" className="btn-secondary btn-small" disabled={analyzing || busy || !textInput.trim()}>
            {analyzing ? '분석 중...' : '분석하기'}
          </button>
        </form>
      )}

      {analyzing && <p className="director-loading">Creative DNA를 분석하는 중...</p>}

      {dna && (
        <div className="dna-result">
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
          <div className="field">
            <span className="field-label">어떤 광고를 만들고 싶나요? (선택)</span>
            <input value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="예: 향수 광고, 20대 여성 타깃" />
          </div>
          {styleField}
          {aspectRatioField}
          {storyboardLengthField}
          <button type="button" className="btn-accent btn-block" onClick={handleCreateDirection} disabled={busy}>
            {busy ? '연출 방향을 만드는 중...' : '이 DNA로 연출 방향 만들기 →'}
          </button>
        </div>
      )}
    </div>
  );
}
