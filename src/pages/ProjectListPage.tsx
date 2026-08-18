import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listProjects } from '../hooks/useProjects';
import { useAuth } from '../hooks/useAuth';
import ThemeToggle from '../components/ThemeToggle';
import type { Project } from '../types';

export default function ProjectListPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const { signOut } = useAuth();

  useEffect(() => {
    listProjects().then(setProjects);
  }, []);

  const styleLabel: Record<string, string> = {
    sketch: '스케치형',
    animation: '애니메이션형',
    live_action: '실사형',
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <Link to="/" className="btn-text back-link">← Studio</Link>
          <h1>내 스토리보드</h1>
        </div>
        <div className="page-header-actions">
          <button className="btn-text" onClick={() => signOut()}>로그아웃</button>
          <ThemeToggle />
        </div>
      </div>

      {projects.length === 0 ? (
        <div className="empty-state">
          <p>아직 만든 프로젝트가 없어요.</p>
        </div>
      ) : (
        <div className="project-grid">
          {projects.map((p) => (
            <Link to={`/projects/${p.id}`} key={p.id} className="project-card">
              <span className="field-label">{styleLabel[p.style] ?? p.style}</span>
              <h3>{p.title}</h3>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
