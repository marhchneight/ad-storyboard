import type { ReactElement } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import NewProjectPage from './pages/NewProjectPage';
import EditorPage from './pages/EditorPage';
import { useAuth } from './hooks/useAuth';

function RequireAuth({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth();
  if (loading) return <div>로딩 중...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function Placeholder({ label }: { label: string }) {
  return <div>{label}</div>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<RequireAuth><Placeholder label="projects" /></RequireAuth>} />
        <Route path="/projects/new" element={<RequireAuth><NewProjectPage /></RequireAuth>} />
        <Route path="/projects/:id" element={<RequireAuth><EditorPage /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
