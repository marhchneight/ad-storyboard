import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { AppliedCreativeDnaTag, Cut, CreativeDnaCategory } from '../types';
import { downloadCutImage } from '../lib/pdfExport';
import { editShot, SHOT_QUICK_ACTIONS, type ShotQuickAction } from '../lib/directorApi';

interface Props {
  cut: Cut;
  index: number;
  onUpdate: (patch: Partial<Cut>) => Promise<void>;
  onGenerate: () => Promise<void>;
  onRemove: () => Promise<void>;
  onAiEdited: () => Promise<void>;
  /** True while a "전체 이미지 생성" batch is running. */
  generateDisabled?: boolean;
}

export default function CutCard({ cut, index, onUpdate, onGenerate, onRemove, onAiEdited, generateDisabled }: Props) {
  const [sceneDescription, setSceneDescription] = useState(cut.scene_description);
  const [dialogue, setDialogue] = useState(cut.dialogue);
  const [cameraDirection, setCameraDirection] = useState(cut.camera_direction);
  const [error, setError] = useState<string | null>(null);
  const [aiInstruction, setAiInstruction] = useState('');
  const [aiEditing, setAiEditing] = useState(false);
  const [showLightbox, setShowLightbox] = useState(false);

  async function handleQuickAction(action: ShotQuickAction) {
    setError(null);
    setAiEditing(true);
    try {
      await editShot(cut.id, { action });
      await onAiEdited();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAiEditing(false);
    }
  }

  async function handleAiInstructionSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!aiInstruction.trim()) return;
    setError(null);
    setAiEditing(true);
    try {
      await editShot(cut.id, { instruction: aiInstruction.trim() });
      await onAiEdited();
      setAiInstruction('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAiEditing(false);
    }
  }

  async function handleGenerate() {
    setError(null);
    try {
      await onUpdate({ scene_description: sceneDescription, dialogue, camera_direction: cameraDirection });
      await onGenerate();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRemove() {
    setError(null);
    try {
      await onRemove();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDownload() {
    setError(null);
    try {
      await downloadCutImage(cut, index);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <>
      <td className="cut-cell cut-cell-index">{index + 1}</td>
      <td className="cut-cell cut-cell-image">
        {cut.image_url ? (
          <img src={cut.image_url} alt={`컷 ${index + 1}`} className="cut-thumb" />
        ) : (
          <div className={`cut-thumb cut-thumb-placeholder${cut.generation_status === 'generating' ? ' is-generating' : ''}`}>
            {cut.generation_status === 'generating'
              ? <><span className="cut-thumb-spinner" aria-hidden="true" />생성 중...</>
              : '이미지 없음'}
          </div>
        )}
        {cut.image_url && (
          <button type="button" onClick={() => setShowLightbox(true)} className="btn-text cut-view-large-btn">크게 보기</button>
        )}
        <AppliedDna cut={cut} />
        {cut.generation_status === 'failed' && (
          <p className="error">생성 실패</p>
        )}
        {cut.generation_status !== 'generating' && cut.generation_status !== 'failed' && (
          <button className="btn-secondary btn-small" onClick={handleGenerate} disabled={generateDisabled}>{cut.image_url ? '다시 생성' : '이미지 생성'}</button>
        )}
        {cut.generation_status === 'failed' && (
          <button className="btn-secondary btn-small" onClick={handleGenerate} disabled={generateDisabled}>다시 시도</button>
        )}
        {showLightbox && cut.image_url && createPortal(
          <div className="image-lightbox-overlay" onClick={() => setShowLightbox(false)}>
            <button type="button" className="image-lightbox-close" onClick={() => setShowLightbox(false)} aria-label="닫기">×</button>
            <img src={cut.image_url} alt={`컷 ${index + 1} 크게 보기`} onClick={(e) => e.stopPropagation()} />
          </div>,
          document.body,
        )}
      </td>
      <td className="cut-cell">
        <SceneRoleIndicator cut={cut} />
        <textarea value={sceneDescription} onChange={(e) => setSceneDescription(e.target.value)}
          onBlur={() => onUpdate({ scene_description: sceneDescription })} />
      </td>
      <td className="cut-cell">
        <textarea value={dialogue} onChange={(e) => setDialogue(e.target.value)}
          onBlur={() => onUpdate({ dialogue })} />
      </td>
      <td className="cut-cell">
        <input value={cameraDirection} onChange={(e) => setCameraDirection(e.target.value)}
          onBlur={() => onUpdate({ camera_direction: cameraDirection })} />
      </td>
      <td className="cut-cell cut-cell-details">
        <ShotDetails cut={cut} />
        <details className="shot-ai-edit">
          <summary>AI 수정</summary>
          <div className="shot-ai-quick-actions">
            {SHOT_QUICK_ACTIONS.map((qa) => (
              <button key={qa.id} type="button" className="btn-secondary btn-small"
                onClick={() => handleQuickAction(qa.id)} disabled={aiEditing}>
                {qa.label}
              </button>
            ))}
          </div>
          <form onSubmit={handleAiInstructionSubmit} className="shot-ai-instruction-form">
            <input value={aiInstruction} onChange={(e) => setAiInstruction(e.target.value)}
              placeholder="예: 카메라를 좀 더 낮춰줘" disabled={aiEditing} />
            <button type="submit" className="btn-secondary btn-small" disabled={aiEditing || !aiInstruction.trim()}>
              {aiEditing ? '수정 중...' : '적용'}
            </button>
          </form>
        </details>
        {error && <p className="error">{error}</p>}
      </td>
      <td className="cut-cell cut-cell-actions">
        <div className="cut-actions-group">
          <button type="button" className="btn-text" onClick={handleRemove}>삭제</button>
          {cut.image_url && (
            <button type="button" onClick={handleDownload} className="btn-text cut-download-btn">다운로드</button>
          )}
        </div>
      </td>
    </>
  );
}

const DETAIL_FIELDS: { key: keyof Cut; label: string }[] = [
  { key: 'duration_seconds', label: 'Duration' },
  { key: 'shot_size', label: 'Shot Size' },
  { key: 'lens', label: 'Lens' },
  { key: 'angle', label: 'Angle' },
  { key: 'movement', label: 'Movement' },
  { key: 'composition', label: 'Composition' },
  { key: 'action', label: 'Action' },
  { key: 'lighting', label: 'Lighting' },
  { key: 'mood', label: 'Mood' },
  { key: 'location', label: 'Location' },
  { key: 'props', label: 'Props' },
  { key: 'sfx', label: 'SFX' },
  { key: 'transition', label: 'Transition' },
  { key: 'purpose', label: 'Purpose' },
];

const DNA_CATEGORY_ORDER: CreativeDnaCategory[] = [
  'camera', 'lighting', 'composition', 'editRhythm', 'colorMood', 'creativePrinciple',
];

const DNA_CATEGORY_LABELS: Record<CreativeDnaCategory, string> = {
  camera: '카메라',
  lighting: '조명',
  composition: '화면 구성',
  editRhythm: '편집 / 리듬',
  colorMood: '컬러 / 무드',
  creativePrinciple: '크리에이티브 방향',
};

function groupByCategory(tags: AppliedCreativeDnaTag[]): { category: CreativeDnaCategory; labels: string[] }[] {
  return DNA_CATEGORY_ORDER
    .map((category) => ({ category, labels: tags.filter((t) => t.category === category).map((t) => t.labelKo) }))
    .filter((g) => g.labels.length > 0);
}

// Compact secondary indicator — max 3 elements dot-joined + "+N" in the
// summary, click to expand the full breakdown. Not shown at all when this
// scene used none — the label is only ever true when
// cut.applied_creative_dna (the same data storyboard/image generation
// actually used) is non-empty.
function AppliedDna({ cut }: { cut: Cut }) {
  const tags = cut.applied_creative_dna;
  if (tags.length === 0) return null;

  const visible = tags.slice(0, 3);
  const extra = tags.length - visible.length;
  const grouped = groupByCategory(tags);
  const summaryText = visible.map((t) => t.labelKo).join(' · ') + (extra > 0 ? ` · +${extra}` : '');

  return (
    <details className="dna-applied">
      <summary>
        <span className="dna-applied-label">레퍼런스 반영</span>
        <span className="dna-applied-tags">{summaryText}</span>
      </summary>
      <div className="dna-applied-detail">
        <span className="dna-applied-detail-heading">이 컷에 반영된 레퍼런스 요소</span>
        {grouped.map(({ category, labels }) => (
          <div className="dna-applied-category" key={category}>
            <span className="dna-applied-category-label">{DNA_CATEGORY_LABELS[category]}</span>
            <span>{labels.join(' · ')}</span>
          </div>
        ))}
        {cut.creative_dna_application_note && (
          <div className="dna-applied-category">
            <span className="dna-applied-category-label">적용 방식</span>
            <p className="dna-applied-note">{cut.creative_dna_application_note}</p>
          </div>
        )}
      </div>
    </details>
  );
}

// Compact secondary metadata — only ever shown when scene_role is actually
// present (AI-assigned during storyboard generation), same "no guessed data"
// rule as AppliedDna above. A one-line summary, click to see the reason.
function SceneRoleIndicator({ cut }: { cut: Cut }) {
  const role = cut.scene_role;
  if (!role) return null;

  return (
    <details className="scene-role">
      <summary>역할 · {role.labelKo}</summary>
      <p className="scene-role-reason">{role.reasonKo}</p>
    </details>
  );
}

function ShotDetails({ cut }: { cut: Cut }) {
  const filled = DETAIL_FIELDS.filter(({ key }) => {
    const value = cut[key];
    return value !== null && value !== undefined && String(value).trim().length > 0;
  });

  if (filled.length === 0) {
    return <span className="shot-details-empty">-</span>;
  }

  return (
    <details className="shot-details">
      <summary>연출 디테일</summary>
      <dl>
        {filled.map(({ key, label }) => (
          <div className="shot-details-row" key={key}>
            <dt>{label}</dt>
            <dd>{key === 'duration_seconds' ? `${cut[key]}s` : String(cut[key])}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
