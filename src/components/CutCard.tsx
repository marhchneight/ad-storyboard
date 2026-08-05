import { useState } from 'react';
import type { Cut } from '../types';

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

  return (
    <div className="cut-card">
      <div className="cut-card-header">
        <h3>컷 {index + 1}</h3>
        <button type="button" onClick={handleRemove}>삭제</button>
      </div>
      {cut.image_url && <img src={cut.image_url} alt={`컷 ${index + 1}`} width={256} />}
      {cut.generation_status === 'generating' && <p>이미지 생성 중...</p>}
      {cut.generation_status === 'failed' && (
        <div>
          <p className="error">이미지 생성에 실패했습니다.</p>
          <button onClick={handleGenerate}>다시 시도</button>
        </div>
      )}
      <label>
        장면 설명
        <textarea value={sceneDescription} onChange={(e) => setSceneDescription(e.target.value)}
          onBlur={() => onUpdate({ scene_description: sceneDescription })} />
      </label>
      <label>
        대사/내레이션
        <textarea value={dialogue} onChange={(e) => setDialogue(e.target.value)}
          onBlur={() => onUpdate({ dialogue })} />
      </label>
      <label>
        카메라 지시문
        <input value={cameraDirection} onChange={(e) => setCameraDirection(e.target.value)}
          onBlur={() => onUpdate({ camera_direction: cameraDirection })} />
      </label>
      {error && <p className="error">{error}</p>}
      {cut.generation_status !== 'generating' && cut.generation_status !== 'failed' && (
        <button onClick={handleGenerate}>{cut.image_url ? '다시 생성' : '이미지 생성'}</button>
      )}
    </div>
  );
}
