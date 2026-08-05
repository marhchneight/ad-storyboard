import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createProject } from '../hooks/useProjects';
import type { StoryboardStyle } from '../types';

export default function NewProjectPage() {
  const [title, setTitle] = useState('');
  const [style, setStyle] = useState<StoryboardStyle>('sketch');
  const [cutCount, setCutCount] = useState(4);
  const [overallPrompt, setOverallPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const project = await createProject({ title, style, cutCount, overallPrompt });
      navigate(`/projects/${project.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="new-project-page">
      <h1>새 스토리보드</h1>
      <form onSubmit={handleSubmit}>
        <label>
          제목
          <input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <label>
          스타일
          <select value={style} onChange={(e) => setStyle(e.target.value as StoryboardStyle)}>
            <option value="sketch">스케치형</option>
            <option value="animation">애니메이션형</option>
            <option value="live_action">실사형</option>
          </select>
        </label>
        <label>
          컷 개수 (최소 2)
          <input type="number" min={2} value={cutCount}
            onChange={(e) => setCutCount(Number(e.target.value))} required />
        </label>
        <label>
          전체 콘셉트 프롬프트
          <textarea value={overallPrompt} onChange={(e) => setOverallPrompt(e.target.value)}
            placeholder="예: 30초 스니커즈 광고, 도시를 배경으로 달리는 청년" required />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={submitting}>{submitting ? '생성 중...' : '만들기'}</button>
      </form>
    </div>
  );
}
