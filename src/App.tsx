import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

function Placeholder({ label }: { label: string }) {
  return <div>{label}</div>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Placeholder label="login" />} />
        <Route path="/" element={<Placeholder label="projects" />} />
        <Route path="/projects/new" element={<Placeholder label="new project" />} />
        <Route path="/projects/:id" element={<Placeholder label="editor" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
