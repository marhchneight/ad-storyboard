import { Link } from 'react-router-dom';
import type { Project } from '../../types';

interface Props {
  projects: Project[];
}

const styleLabel: Record<string, string> = {
  sketch: '스케치형',
  animation: '애니메이션형',
  live_action: '실사형',
};

export default function RecentProjects({ projects }: Props) {
  if (projects.length === 0) {
    return (
      <div className="empty-state">
        <p>아직 만든 스토리보드가 없어요. 첫 연출이 여기에 표시됩니다.</p>
      </div>
    );
  }

  return (
    <div className="recent-projects-grid">
      {projects.map((p) => {
        const tags = p.creative_treatment?.visualLanguage ?? [];
        const approach = p.creative_treatment?.approach;
        const metaParts = [
          approach?.duration ? `${approach.duration}초` : (p.brief?.duration ?? null),
          p.brief?.platform ?? null,
        ].filter(Boolean);

        const updatedLabel = p.updated_at
          ? new Date(p.updated_at).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' })
          : null;

        return (
          <Link to={`/projects/${p.id}`} key={p.id} className="recent-project-card">
            <span className="field-label">{styleLabel[p.style] ?? p.style}</span>
            <h3>{p.title}</h3>
            {p.brief?.product && <p className="recent-project-product">{p.brief.product}</p>}
            {metaParts.length > 0 && <p className="recent-project-meta">{metaParts.join(' · ')}</p>}
            {tags.length > 0 && (
              <div className="cd-tags">
                {tags.slice(0, 4).map((tag) => <span key={tag} className="cd-tag cd-tag-small">{tag}</span>)}
              </div>
            )}
            <div className="recent-project-footer">
              {updatedLabel && <span className="recent-project-updated">{updatedLabel} 업데이트</span>}
              <span className="recent-project-continue">이어서 작업하기 →</span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
