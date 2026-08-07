import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { supabase } from '../lib/supabaseClient';
import { useCuts } from '../hooks/useCuts';
import SortableCutCard from '../components/SortableCutCard';
import { buildStoryboardPdf } from '../lib/pdfExport';
import { extractTextFromFile } from '../lib/copyFileParser';
import type { Project } from '../types';

export default function EditorPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [overallPrompt, setOverallPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [distributingCopy, setDistributingCopy] = useState(false);
  const { cuts, updateCut, generateImage, addCut, removeCut, reorderCuts, refresh } = useCuts(id!);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

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

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = cuts.findIndex((c) => c.id === active.id);
    const newIndex = cuts.findIndex((c) => c.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const newOrder = arrayMove(cuts, oldIndex, newIndex).map((c) => c.id);
    try {
      await reorderCuts(newOrder);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleAddCut() {
    setError(null);
    try {
      await addCut();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleCopyFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !project) return;

    setError(null);
    setDistributingCopy(true);
    try {
      const copyText = await extractTextFromFile(file);
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/distribute-copy`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: project.id, copyText }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: '카피 반영에 실패했습니다.' }));
        throw new Error(body.error ?? '카피 반영에 실패했습니다.');
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDistributingCopy(false);
    }
  }

  async function handleExportPdf() {
    if (!project) return;
    setError(null);
    setExporting(true);
    try {
      const doc = await buildStoryboardPdf(project, cuts);
      doc.save(`${project.title}.pdf`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  }

  if (!project) return <div className="page-shell">로딩 중...</div>;

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <p className="eyebrow">Storyboard</p>
          <h1>{project.title}</h1>
        </div>
        <button type="button" className="btn-primary" onClick={handleExportPdf} disabled={exporting}>
          {exporting ? 'PDF 생성 중...' : 'PDF로 내보내기'}
        </button>
      </div>

      {project.creative_direction && (
        <div className="card prompt-card director-note">
          <span className="field-label">Creative Direction</span>
          <p>{project.creative_direction}</p>
        </div>
      )}

      <div className="card prompt-card">
        <span className="field-label">전체 콘셉트 프롬프트</span>
        <textarea value={overallPrompt} onChange={(e) => setOverallPrompt(e.target.value)}
          onBlur={saveOverallPrompt} />
      </div>

      <div className="card prompt-card">
        <span className="field-label">카피 파일 업로드 (.txt, .docx, .pptx)</span>
        <p>광고 카피 파일을 올리면 AI가 컷 순서에 맞게 카피/멘트를 자동으로 채워줘요.</p>
        <input type="file" accept=".txt,.docx,.pptx" onChange={handleCopyFileChange} disabled={distributingCopy} />
        {distributingCopy && <p>카피를 분석해서 카피/멘트에 반영하는 중...</p>}
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={cuts.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          <div className="cut-table-wrap">
            <table className="cut-table">
              <thead>
                <tr>
                  <th></th>
                  <th>순서</th>
                  <th>이미지</th>
                  <th>장면 설명</th>
                  <th>카피/멘트</th>
                  <th>카메라 지시문</th>
                  <th>연출 디테일</th>
                  <th>관리</th>
                </tr>
              </thead>
              <tbody>
                {cuts.map((cut, i) => (
                  <SortableCutCard
                    key={cut.id}
                    cut={cut}
                    index={i}
                    onUpdate={(patch) => updateCut(cut.id, patch)}
                    onGenerate={() => generateImage(cut.id)}
                    onRemove={() => removeCut(cut.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </SortableContext>
      </DndContext>
      {error && <p className="error">{error}</p>}
      <button type="button" className="btn-secondary" onClick={handleAddCut}>+ 컷 추가</button>
    </div>
  );
}
