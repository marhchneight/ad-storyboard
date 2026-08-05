import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listProjects } from '../hooks/useProjects';
import { useAuth } from '../hooks/useAuth';
import type { Project } from '../types';

export default function ProjectListPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const { signOut } = useAuth();

  useEffect(() => {
    listProjects().then(setProjects);
  }, []);

  return (
    <div className="project-list-page">
      <div className="header">
        <h1>내 스토리보드</h1>
        <button onClick={() => signOut()}>로그아웃</button>
      </div>
      <Link to="/projects/new">새 프로젝트</Link>
      <ul>
        {projects.map((p) => (
          <li key={p.id}>
            <Link to={`/projects/${p.id}`}>{p.title}</Link>
            <span> ({p.style})</span>
          </li>
        ))}
      </ul>
      {projects.length === 0 && <p>아직 만든 프로젝트가 없어요.</p>}
    </div>
  );
}
