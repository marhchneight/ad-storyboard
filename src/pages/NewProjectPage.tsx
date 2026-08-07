import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createProject, directStoryboard } from '../hooks/useProjects';
import type { CreativeBrief, Duration, Platform, StoryboardStyle } from '../types';

const DIRECTOR_LOADING_MESSAGES = [
  'Reading the brief',
  'Finding the visual language',
  'Planning the opening shot',
  'Building the visual rhythm',
  'Designing the hero shot',
  'Finishing the treatment',
];

const PLATFORMS: Platform[] = ['Instagram Reels', 'TikTok', 'YouTube', 'TVC', 'Digital Ad', 'Brand Film'];
const DURATIONS: Duration[] = ['6s', '15s', '30s', '60s', 'Custom'];

export default function NewProjectPage() {
  const [title, setTitle] = useState('');
  const [style, setStyle] = useState<StoryboardStyle>('sketch');
  const [freeformIdea, setFreeformIdea] = useState('');
  const [product, setProduct] = useState('');
  const [objective, setObjective] = useState('');
  const [targetAudience, setTargetAudience] = useState('');
  const [keyMessage, setKeyMessage] = useState('');
  const [platform, setPlatform] = useState<Platform | ''>('');
  const [duration, setDuration] = useState<Duration | ''>('');
  const [mood, setMood] = useState('');
  const [visualKeywords, setVisualKeywords] = useState('');
  const [reference, setReference] = useState('');
  const [showDetails, setShowDetails] = useState(false);

  const [manualMode, setManualMode] = useState(false);
  const [cutCount, setCutCount] = useState(4);

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState(DIRECTOR_LOADING_MESSAGES[0]);
  const messageIndexRef = useRef(0);
  const navigate = useNavigate();

  useEffect(() => {
    if (!submitting) return;
    messageIndexRef.current = 0;
    setLoadingMessage(DIRECTOR_LOADING_MESSAGES[0]);
    const interval = setInterval(() => {
      messageIndexRef.current = (messageIndexRef.current + 1) % DIRECTOR_LOADING_MESSAGES.length;
      setLoadingMessage(DIRECTOR_LOADING_MESSAGES[messageIndexRef.current]);
    }, 1800);
    return () => clearInterval(interval);
  }, [submitting]);

  async function handleDirectorSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const brief: CreativeBrief = {
        product: product.trim() || undefined,
        objective: objective.trim() || undefined,
        targetAudience: targetAudience.trim() || undefined,
        keyMessage: keyMessage.trim() || undefined,
        platform: platform || undefined,
        duration: duration || undefined,
        mood: mood.trim() || undefined,
        visualKeywords: visualKeywords.trim() || undefined,
        reference: reference.trim() || undefined,
        conceptDescription: freeformIdea.trim() || undefined,
      };
      const projectTitle = title.trim() || product.trim() || '새 광고 스토리보드';
      const projectId = await directStoryboard({ title: projectTitle, style, brief, freeformIdea });
      navigate(`/projects/${projectId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const project = await createProject({
        title: title || '새 스토리보드',
        style,
        cutCount,
        overallPrompt: freeformIdea,
      });
      navigate(`/projects/${project.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page-shell page-shell-narrow">
      <p className="eyebrow">Idea</p>
      <h1>{manualMode ? '새 스토리보드' : 'AI 감독에게 브리프 전달하기'}</h1>
      {!manualMode && (
        <p className="idea-subtitle">
          광고 아이디어를 자유롭게 적어주세요. AI 감독이 연출안을 만들어드려요.
        </p>
      )}

      <form onSubmit={manualMode ? handleManualSubmit : handleDirectorSubmit} className="card form-card">
        <div className="field">
          <span className="field-label">프로젝트 제목 (선택)</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 고려은단 비타민C 릴스" />
        </div>
        <div className="field">
          <span className="field-label">스타일</span>
          <select value={style} onChange={(e) => setStyle(e.target.value as StoryboardStyle)}>
            <option value="sketch">스케치형</option>
            <option value="animation">애니메이션형</option>
            <option value="live_action">실사형</option>
          </select>
        </div>

        {!manualMode && (
          <>
            <div className="field">
              <span className="field-label">아이디어 (한두 문장으로 자유롭게)</span>
              <textarea value={freeformIdea} onChange={(e) => setFreeformIdea(e.target.value)}
                placeholder="예: 20대 여성을 타깃으로 한 향수 광고. 새벽 서울의 차갑고 몽환적인 분위기. 15초 인스타그램 릴스."
                required={!showDetails} />
            </div>

            <button type="button" className="btn-text" onClick={() => setShowDetails((v) => !v)}>
              {showDetails ? '세부 브리프 숨기기' : '+ 세부 브리프 항목 펼치기 (선택)'}
            </button>

            {showDetails && (
              <div className="brief-details">
                <div className="field">
                  <span className="field-label">Product / Brand</span>
                  <input value={product} onChange={(e) => setProduct(e.target.value)} />
                </div>
                <div className="field">
                  <span className="field-label">Campaign objective</span>
                  <input value={objective} onChange={(e) => setObjective(e.target.value)} />
                </div>
                <div className="field">
                  <span className="field-label">Target audience</span>
                  <input value={targetAudience} onChange={(e) => setTargetAudience(e.target.value)} />
                </div>
                <div className="field">
                  <span className="field-label">Key message</span>
                  <input value={keyMessage} onChange={(e) => setKeyMessage(e.target.value)} />
                </div>
                <div className="field">
                  <span className="field-label">Platform</span>
                  <select value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}>
                    <option value="">선택 안 함</option>
                    {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div className="field">
                  <span className="field-label">Duration</span>
                  <select value={duration} onChange={(e) => setDuration(e.target.value as Duration)}>
                    <option value="">선택 안 함</option>
                    {DURATIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div className="field">
                  <span className="field-label">Mood / Tone</span>
                  <input value={mood} onChange={(e) => setMood(e.target.value)} />
                </div>
                <div className="field">
                  <span className="field-label">Visual keywords</span>
                  <input value={visualKeywords} onChange={(e) => setVisualKeywords(e.target.value)} />
                </div>
                <div className="field">
                  <span className="field-label">Reference</span>
                  <input value={reference} onChange={(e) => setReference(e.target.value)} />
                </div>
              </div>
            )}
          </>
        )}

        {manualMode && (
          <>
            <div className="field">
              <span className="field-label">컷 개수 (최소 2)</span>
              <input type="number" min={2} value={cutCount}
                onChange={(e) => setCutCount(Number(e.target.value))} required />
            </div>
            <div className="field">
              <span className="field-label">전체 콘셉트 프롬프트</span>
              <textarea value={freeformIdea} onChange={(e) => setFreeformIdea(e.target.value)}
                placeholder="예: 30초 스니커즈 광고, 도시를 배경으로 달리는 청년" required />
            </div>
          </>
        )}

        {error && <p className="error">{error}</p>}

        {submitting && !manualMode ? (
          <p className="director-loading">{loadingMessage}...</p>
        ) : (
          <button type="submit" className="btn-primary btn-block" disabled={submitting}>
            {submitting ? '만드는 중...' : manualMode ? '만들기' : 'Direct My Storyboard'}
          </button>
        )}
      </form>

      <button type="button" className="btn-text" onClick={() => setManualMode((v) => !v)} disabled={submitting}>
        {manualMode ? 'AI 감독에게 맡기기' : 'AI 없이 직접 컷 개수 지정해서 만들기'}
      </button>
    </div>
  );
}
