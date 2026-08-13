import { useEffect, useRef, useState, type ReactNode } from 'react';
import { generateCreativeDirection, type SceneCountParams } from '../../lib/creativeDirectionApi';
import { fetchCreativeExamples } from '../../lib/ideaRecommendationsApi';
import { extractTextFromFile } from '../../lib/copyFileParser';
import type { CreativeBrief, CreativeExample, CreativeTreatment } from '../../types';

const LOADING_MESSAGES = [
  '아이디어를 읽는 중', '크리에이티브 앵글을 찾는 중', '비주얼 언어를 정하는 중', '트리트먼트를 구성하는 중',
];

interface Props {
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
  onGenerated: (treatment: CreativeTreatment, context: { freeformIdea?: string; brief?: CreativeBrief; copyText?: string }) => void;
  onError: (message: string) => void;
  styleField: ReactNode;
  aspectRatioField: ReactNode;
  storyboardLengthField: ReactNode;
  sceneCountParams: SceneCountParams;
}

type CopyStatus = 'idle' | 'reading' | 'error';

export default function IdeaMode({
  busy, onBusyChange, onGenerated, onError, styleField, aspectRatioField, storyboardLengthField, sceneCountParams,
}: Props) {
  const [idea, setIdea] = useState('');
  const [loadingMessage, setLoadingMessage] = useState(LOADING_MESSAGES[0]);
  const messageIndexRef = useRef(0);

  const [copyFile, setCopyFile] = useState<File | null>(null);
  const [copyText, setCopyText] = useState<string | undefined>(undefined);
  const [copyStatus, setCopyStatus] = useState<CopyStatus>('idle');
  const [copyError, setCopyError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const [examples, setExamples] = useState<CreativeExample[]>([]);
  const [examplesLoading, setExamplesLoading] = useState(true);
  const [examplesError, setExamplesError] = useState<string | null>(null);

  async function loadExamples(avoid: string[] = []) {
    setExamplesLoading(true);
    setExamplesError(null);
    try {
      const next = await fetchCreativeExamples(avoid);
      setExamples(next);
    } catch (err) {
      // Keep whatever examples were already showing rather than clearing
      // the section on a refresh failure.
      setExamplesError(err instanceof Error ? err.message : String(err));
    } finally {
      setExamplesLoading(false);
    }
  }

  useEffect(() => {
    loadExamples();
  }, []);

  useEffect(() => {
    if (!busy) return;
    messageIndexRef.current = 0;
    setLoadingMessage(LOADING_MESSAGES[0]);
    const interval = setInterval(() => {
      messageIndexRef.current = (messageIndexRef.current + 1) % LOADING_MESSAGES.length;
      setLoadingMessage(LOADING_MESSAGES[messageIndexRef.current]);
    }, 1400);
    return () => clearInterval(interval);
  }, [busy]);

  async function handleCopyFile(file: File) {
    setCopyStatus('reading');
    setCopyError(null);
    try {
      const text = await extractTextFromFile(file);
      setCopyFile(file);
      setCopyText(text);
      setCopyStatus('idle');
    } catch {
      setCopyFile(null);
      setCopyText(undefined);
      setCopyStatus('error');
      setCopyError('파일을 읽을 수 없어요. 다른 파일로 다시 시도해주세요.');
    }
  }

  function handleCopyFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    handleCopyFile(file);
  }

  function handleCopyDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    handleCopyFile(file);
  }

  function handleRemoveCopy() {
    setCopyFile(null);
    setCopyText(undefined);
    setCopyStatus('idle');
    setCopyError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!idea.trim() || busy || copyStatus === 'reading') return;
    onBusyChange(true);
    try {
      const context = {
        freeformIdea: idea.trim(),
        brief: { conceptDescription: idea.trim() } as CreativeBrief,
        copyText,
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
    <form onSubmit={handleSubmit} className="hero-form">
      <div className="field">
        <span className="field-label">광고 아이디어</span>
        <textarea
          className="hero-input"
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          placeholder="예: 새벽 서울의 차갑고 고요한 분위기를 담은 15초 향수 광고"
          rows={3}
          disabled={busy}
        />
      </div>
      <div className="field">
        <div className="idea-examples-header">
          <span className="field-label">요즘 이런 광고는 어때요?</span>
          <button
            type="button"
            className="idea-examples-refresh"
            onClick={() => loadExamples(examples.map((ex) => ex.text))}
            disabled={busy || examplesLoading}
          >
            ↻ 새로 추천
          </button>
        </div>
        {examples.length > 0 && (
          <div className="hero-examples">
            {examples.map((ex) => (
              <button type="button" key={ex.id} className="hero-example-chip" onClick={() => setIdea(ex.text)} disabled={busy}>
                {ex.text}
              </button>
            ))}
          </div>
        )}
        {examplesLoading && <p className="idea-examples-status">새로운 아이디어 찾는 중...</p>}
        {examplesError && !examplesLoading && <p className="error">{examplesError}</p>}
      </div>
      {styleField}
      {aspectRatioField}
      {storyboardLengthField}
      <div className="field">
        <span className="field-label">카피/대본 파일 (선택)</span>
        <p className="copy-upload-desc">카피나 대본 파일을 올리면 각 컷에 맞게 반영해드려요.</p>
        {!copyFile ? (
          <div
            className={`copy-dropzone${dragOver ? ' copy-dropzone-active' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleCopyDrop}
          >
            <label className="btn-secondary btn-small copy-choose-btn">
              파일 선택
              <input type="file" accept=".txt,.docx,.pptx" onChange={handleCopyFileInputChange}
                disabled={busy || copyStatus === 'reading'} hidden />
            </label>
            <span className="copy-dropzone-hint">TXT, DOCX, PPTX</span>
          </div>
        ) : (
          <div className="copy-file-chip">
            <span className="copy-file-name">{copyFile.name}</span>
            <button type="button" className="btn-text" onClick={handleRemoveCopy} disabled={busy}>제거</button>
          </div>
        )}
        {copyStatus === 'reading' && <p className="director-loading">카피를 읽는 중...</p>}
        {copyStatus === 'error' && copyError && <p className="error">{copyError}</p>}
      </div>
      {busy ? (
        <p className="director-loading">{loadingMessage}...</p>
      ) : (
        <button type="submit" className="btn-accent btn-block" disabled={!idea.trim() || copyStatus === 'reading'}>
          콘티 만들기 →
        </button>
      )}
    </form>
  );
}
