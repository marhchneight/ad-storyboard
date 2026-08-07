import { useState } from 'react';
import { analyzeCreativeDna, applyCreativeDna, fileToDataUrl } from '../../lib/creativeDnaApi';
import { supabase } from '../../lib/supabaseClient';
import type { Project } from '../../types';

interface Props {
  project: Project;
  onBeforeApply: () => void;
  onApplied: (changes: string[], updatedProject: Project) => void;
}

type ReferenceMode = 'image_upload' | 'image_url' | 'text';

export default function CreativeDnaPanel({ project, onBeforeApply, onApplied }: Props) {
  const [mode, setMode] = useState<ReferenceMode>('image_upload');
  const [imageUrlInput, setImageUrlInput] = useState('');
  const [textInput, setTextInput] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dna = project.creative_dna;

  async function refreshProject() {
    const { data } = await supabase.from('projects').select('*').eq('id', project.id).single();
    return data as Project | null;
  }

  async function handleImageFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
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
    onBeforeApply();
    setApplying(true);
    try {
      const changes = await applyCreativeDna(project.id, dna);
      const updated = await refreshProject();
      if (updated) onApplied(changes, updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
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
          <span className="field-label">Visual Language</span>
          <div className="dna-scores">
            {dna.visualLanguage.map((v) => (
              <div className="dna-score-row" key={v.label}>
                <span className="dna-score-label">{v.label}</span>
                <div className="dna-score-bar">
                  <div className="dna-score-fill" style={{ width: `${Math.max(0, Math.min(100, v.score))}%` }} />
                </div>
                <span className="dna-score-value">{v.score}%</span>
              </div>
            ))}
          </div>

          <DnaList title="Camera DNA" items={dna.cameraDna} />
          <DnaList title="Lighting DNA" items={dna.lightingDna} />
          <DnaList title="Composition DNA" items={dna.compositionDna} />
          <DnaList title="Edit / Rhythm DNA" items={dna.editRhythmDna} />
          <DnaList title="Color / Mood" items={dna.colorMood} />
          <DnaList title="Creative Principles" items={dna.creativePrinciples} />

          <button type="button" className="btn-primary btn-block" onClick={handleApplyDna} disabled={applying}>
            {applying ? 'DNA를 적용하는 중...' : 'Apply DNA to Storyboard'}
          </button>
        </div>
      )}
    </div>
  );
}

function DnaList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="dna-list">
      <span className="dna-list-title">{title}</span>
      <ul>
        {items.map((item, i) => <li key={i}>{item}</li>)}
      </ul>
    </div>
  );
}
