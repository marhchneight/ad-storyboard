import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { directStoryboard, listProjects } from '../hooks/useProjects';
import { regenerateCreativeDirection, reviseCreativeDirection } from '../lib/creativeDirectionApi';
import type { SceneCountParams } from '../lib/creativeDirectionApi';
import { useAuth } from '../hooks/useAuth';
import IdeaMode from '../components/home/IdeaMode';
import ReferenceMode from '../components/home/ReferenceMode';
import ProductMode from '../components/home/ProductMode';
import CreativeDirectionPanel from '../components/home/CreativeDirectionPanel';
import DirectorsRoom from '../components/home/DirectorsRoom';
import RecentProjects from '../components/home/RecentProjects';
import ThemeToggle from '../components/ThemeToggle';
import type {
  AspectRatio, CreativeBrief, CreativeDna, CreativeRisk, CreativeTreatment, DirectingOption, Project,
  SceneCountMode, StoryboardStyle, TargetDurationSeconds,
} from '../types';

const ASPECT_RATIOS: { id: AspectRatio; label: string }[] = [
  { id: '1:1', label: '1:1' },
  { id: '9:16', label: '9:16 세로형' },
  { id: '16:9', label: '16:9' },
];

const MIN_SCENE_COUNT = 2;
const DEFAULT_MANUAL_SCENE_COUNT = 4;
const DURATION_OPTIONS: TargetDurationSeconds[] = [15, 30, 60];

type StartMode = 'idea' | 'reference' | 'product';

interface GenerationContext {
  freeformIdea?: string;
  brief?: CreativeBrief;
  dna?: CreativeDna;
  copyText?: string;
}

export default function HomePage() {
  const [startMode, setStartMode] = useState<StartMode>('idea');
  const [style, setStyle] = useState<StoryboardStyle>('sketch');
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('1:1');
  const [sceneCountMode, setSceneCountMode] = useState<SceneCountMode>('duration');
  const [manualSceneCount, setManualSceneCount] = useState(DEFAULT_MANUAL_SCENE_COUNT);
  const [targetDurationSeconds, setTargetDurationSeconds] = useState<TargetDurationSeconds>(15);
  const [treatment, setTreatment] = useState<CreativeTreatment | null>(null);
  const [context, setContext] = useState<GenerationContext>({});
  const [roomOpen, setRoomOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [treatmentBusy, setTreatmentBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const { signOut } = useAuth();
  const navigate = useNavigate();

  const sceneCountParams: SceneCountParams = sceneCountMode === 'manual'
    ? { sceneCountMode: 'manual', requestedSceneCount: manualSceneCount }
    : { sceneCountMode: 'duration', targetDurationSeconds };

  useEffect(() => {
    listProjects().then(setProjects).catch(() => {});
  }, []);

  function handleGenerated(t: CreativeTreatment, ctx: GenerationContext) {
    setError(null);
    setTreatment(t);
    setContext(ctx);
  }

  function handleStartOver() {
    setTreatment(null);
    setContext({});
    setRoomOpen(false);
    setError(null);
  }

  async function handleTryAnother() {
    if (!treatment || treatmentBusy) return;
    setError(null);
    setTreatmentBusy(true);
    try {
      const next = await regenerateCreativeDirection({ ...context, previousTreatment: treatment, ...sceneCountParams });
      setTreatment(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTreatmentBusy(false);
    }
  }

  async function handleRevise(instruction: string) {
    if (!treatment || treatmentBusy) return;
    setError(null);
    setTreatmentBusy(true);
    try {
      const next = await reviseCreativeDirection({ previousTreatment: treatment, instruction });
      setTreatment(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTreatmentBusy(false);
    }
  }

  async function handleDirect(direction?: DirectingOption, creativeRisk?: CreativeRisk) {
    if (!treatment || treatmentBusy) return;
    setError(null);
    setTreatmentBusy(true);
    try {
      const projectId = await directStoryboard({
        title: direction?.titleKo ? `${treatment.title} · ${direction.titleKo}` : treatment.title,
        style,
        aspectRatio,
        brief: context.brief ?? {},
        freeformIdea: context.freeformIdea ?? treatment.concept,
        creativeDirection: treatment,
        copyText: context.copyText,
        directingDirection: direction,
        creativeRisk,
        creativeDna: context.dna,
        ...sceneCountParams,
      });
      navigate(`/projects/${projectId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setTreatmentBusy(false);
    }
  }

  function handleEnterDirectorsRoom() {
    setError(null);
    setRoomOpen(true);
  }

  function handleBackFromDirectorsRoom() {
    setRoomOpen(false);
  }

  function handleSkipDirectorsRoom() {
    handleDirect();
  }

  const styleField = (
    <div className="field style-field">
      <span className="field-label">비주얼 스타일</span>
      <select value={style} onChange={(e) => setStyle(e.target.value as StoryboardStyle)} disabled={busy}>
        <option value="live_action">실사형</option>
        <option value="sketch">스케치형</option>
        <option value="animation">애니메이션형</option>
      </select>
    </div>
  );

  const aspectRatioField = (
    <div className="field">
      <span className="field-label">화면 비율</span>
      <div className="aspect-ratio-options">
        {ASPECT_RATIOS.map((opt) => (
          <button key={opt.id} type="button"
            className={`aspect-ratio-btn${aspectRatio === opt.id ? ' aspect-ratio-btn-active' : ''}`}
            onClick={() => setAspectRatio(opt.id)} disabled={busy}>
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );

  const storyboardLengthField = (
    <div className="field">
      <span className="field-label">스토리보드 길이</span>
      <div className="aspect-ratio-options">
        <button type="button" className={`aspect-ratio-btn${sceneCountMode === 'manual' ? ' aspect-ratio-btn-active' : ''}`}
          onClick={() => setSceneCountMode('manual')} disabled={busy}>
          컷 수 직접 지정
        </button>
        <button type="button" className={`aspect-ratio-btn${sceneCountMode === 'duration' ? ' aspect-ratio-btn-active' : ''}`}
          onClick={() => setSceneCountMode('duration')} disabled={busy}>
          영상 길이로 추천
        </button>
      </div>

      {sceneCountMode === 'manual' ? (
        <div className="scene-length-sub">
          <div className="scene-count-stepper">
            <button type="button" className="stepper-btn"
              onClick={() => setManualSceneCount((n) => Math.max(MIN_SCENE_COUNT, n - 1))}
              disabled={busy || manualSceneCount <= MIN_SCENE_COUNT}>
              −
            </button>
            <span className="stepper-value">{manualSceneCount}컷</span>
            <button type="button" className="stepper-btn"
              onClick={() => setManualSceneCount((n) => n + 1)} disabled={busy}>
              +
            </button>
          </div>
        </div>
      ) : (
        <div className="scene-length-sub">
          <div className="aspect-ratio-options">
            {DURATION_OPTIONS.map((d) => (
              <button key={d} type="button"
                className={`aspect-ratio-btn${targetDurationSeconds === d ? ' aspect-ratio-btn-active' : ''}`}
                onClick={() => setTargetDurationSeconds(d)} disabled={busy}>
                {d}초
              </button>
            ))}
          </div>
          <p className="field-hint">롱폼(Long-form) 영상은 준비 중입니다.</p>
        </div>
      )}
    </div>
  );

  return (
    <div className="page-shell home-shell">
      <div className="page-header home-header">
        <p className="eyebrow">렛츠기니</p>
        <div className="page-header-actions">
          <Link to="/projects" className="btn-text">프로젝트</Link>
          <button className="btn-text" onClick={() => signOut()}>로그아웃</button>
          <ThemeToggle />
        </div>
      </div>

      {!treatment ? (
        <>
          <div className="hero">
            <div className="hero-inner">
              <h1 className="hero-title">어떤 광고를 만들까요?</h1>
              <p className="hero-subtitle">아이디어를 입력하면 촬영 가능한 콘티로 구성해드려요.</p>

              <div className="start-mode-tabs">
                <button type="button" className={`start-mode-tab${startMode === 'idea' ? ' start-mode-tab-active' : ''}`}
                  onClick={() => setStartMode('idea')} disabled={busy}>아이디어</button>
                <button type="button" className={`start-mode-tab${startMode === 'reference' ? ' start-mode-tab-active' : ''}`}
                  onClick={() => setStartMode('reference')} disabled={busy}>레퍼런스</button>
                <button type="button" className={`start-mode-tab${startMode === 'product' ? ' start-mode-tab-active' : ''}`}
                  onClick={() => setStartMode('product')} disabled={busy}>제품</button>
              </div>

              {startMode === 'idea' && (
                <IdeaMode busy={busy} onBusyChange={setBusy} onGenerated={handleGenerated} onError={setError}
                  styleField={styleField} aspectRatioField={aspectRatioField}
                  storyboardLengthField={storyboardLengthField} sceneCountParams={sceneCountParams} />
              )}
              {startMode === 'reference' && (
                <ReferenceMode busy={busy} onBusyChange={setBusy} onGenerated={handleGenerated} onError={setError}
                  styleField={styleField} aspectRatioField={aspectRatioField}
                  storyboardLengthField={storyboardLengthField} sceneCountParams={sceneCountParams} />
              )}
              {startMode === 'product' && (
                <ProductMode busy={busy} onBusyChange={setBusy} onGenerated={handleGenerated} onError={setError}
                  styleField={styleField} aspectRatioField={aspectRatioField}
                  storyboardLengthField={storyboardLengthField} sceneCountParams={sceneCountParams} />
              )}

              {error && <p className="error">{error}</p>}
            </div>
          </div>

          <div className="recent-projects-section">
            <span className="field-label">최근 프로젝트</span>
            <RecentProjects projects={projects} />
          </div>
        </>
      ) : roomOpen ? (
        <>
          {error && <p className="error">{error}</p>}
          <DirectorsRoom
            treatment={treatment}
            context={context}
            busy={treatmentBusy}
            onSelect={handleDirect}
            onSkip={handleSkipDirectorsRoom}
            onBack={handleBackFromDirectorsRoom}
          />
        </>
      ) : (
        <>
          <button type="button" className="btn-text" onClick={handleStartOver} disabled={treatmentBusy}>
            ← 처음부터 다시
          </button>
          {error && <p className="error">{error}</p>}
          <CreativeDirectionPanel
            treatment={treatment}
            busy={treatmentBusy}
            onEnterDirectorsRoom={handleEnterDirectorsRoom}
            onTryAnother={handleTryAnother}
            onRevise={handleRevise}
          />
        </>
      )}
    </div>
  );
}
