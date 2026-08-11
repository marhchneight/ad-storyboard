import { useEffect, useRef, useState, type ReactNode } from 'react';
import { generateCreativeDirection, type SceneCountParams } from '../../lib/creativeDirectionApi';
import { extractTextFromFile } from '../../lib/copyFileParser';
import type { CreativeBrief, CreativeTreatment } from '../../types';

const EXAMPLE_PROMPTS = [
  '15초짜리 여름 향수 광고. 새벽 서울의 차갑고 몽환적인 분위기.',
  '새로운 러닝화를 위한 거친 TikTok 광고, Gen-Z 타깃.',
  '제품을 마지막에만 보여주는 커피 광고.',
  '사람 없이 만드는 자동차 광고.',
];

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
        <span className="field-label">예시로 시작하기</span>
        <div className="hero-examples">
          {EXAMPLE_PROMPTS.map((ex) => (
            <button type="button" key={ex} className="hero-example-chip" onClick={() => setIdea(ex)} disabled={busy}>
              {ex}
            </button>
          ))}
        </div>
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
        <button type="submit" className="btn-primary btn-block" disabled={!idea.trim() || copyStatus === 'reading'}>
          콘티 만들기 →
        </button>
      )}
    </form>
  );
}
