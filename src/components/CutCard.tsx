import { useState } from 'react';
import type { Cut } from '../types';
import { downloadCutImage } from '../lib/pdfExport';

interface Props {
  cut: Cut;
  index: number;
  onUpdate: (patch: Partial<Cut>) => Promise<void>;
  onGenerate: () => Promise<void>;
  onRemove: () => Promise<void>;
}

export default function CutCard({ cut, index, onUpdate, onGenerate, onRemove }: Props) {
  const [sceneDescription, setSceneDescription] = useState(cut.scene_description);
  const [dialogue, setDialogue] = useState(cut.dialogue);
  const [cameraDirection, setCameraDirection] = useState(cut.camera_direction);
  const [error, setError] = useState<string | null>(null);

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
          <div className="cut-thumb cut-thumb-placeholder">
            {cut.generation_status === 'generating' ? '생성 중...' : '이미지 없음'}
          </div>
        )}
        {cut.image_url && (
          <button type="button" onClick={handleDownload} className="btn-text cut-download-btn">다운로드</button>
        )}
        {cut.generation_status === 'failed' && (
          <p className="error">생성 실패</p>
        )}
        {cut.generation_status !== 'generating' && cut.generation_status !== 'failed' && (
          <button className="btn-secondary btn-small" onClick={handleGenerate}>{cut.image_url ? '다시 생성' : '이미지 생성'}</button>
        )}
        {cut.generation_status === 'failed' && (
          <button className="btn-secondary btn-small" onClick={handleGenerate}>다시 시도</button>
        )}
      </td>
      <td className="cut-cell">
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
      </td>
      <td className="cut-cell cut-cell-actions">
        <button type="button" className="btn-text" onClick={handleRemove}>삭제</button>
        {error && <p className="error">{error}</p>}
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
