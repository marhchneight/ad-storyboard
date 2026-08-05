import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { useCuts } from '../hooks/useCuts';
import CutCard from '../components/CutCard';
import type { Project } from '../types';

export default function EditorPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [overallPrompt, setOverallPrompt] = useState('');
  const { cuts, updateCut, generateImage } = useCuts(id!);

  useEffect(() => {
    supabase.from('projects').select('*').eq('id', id).single().then(({ data }) => {
      if (data) {
        setProject(data as Project);
        setOverallPrompt((data as Project).overall_prompt);
      }
    });
  }, [id]);

  async function saveOverallPrompt() {
    if (!project) return;
    await supabase.from('projects').update({ overall_prompt: overallPrompt }).eq('id', project.id);
  }

  if (!project) return <div>로딩 중...</div>;

  return (
    <div className="editor-page">
      <h1>{project.title}</h1>
      <label>
        전체 콘셉트 프롬프트
        <textarea value={overallPrompt} onChange={(e) => setOverallPrompt(e.target.value)}
          onBlur={saveOverallPrompt} />
      </label>
      <div className="cut-list">
        {cuts.map((cut, i) => (
          <CutCard
            key={cut.id}
            cut={cut}
            index={i}
            onUpdate={(patch) => updateCut(cut.id, patch)}
            onGenerate={() => generateImage(cut.id)}
          />
        ))}
      </div>
    </div>
  );
}
