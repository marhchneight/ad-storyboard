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
import type { Project } from '../types';

export default function EditorPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [overallPrompt, setOverallPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const { cuts, updateCut, generateImage, addCut, removeCut, reorderCuts } = useCuts(id!);
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

      <div className="card prompt-card">
        <span className="field-label">전체 콘셉트 프롬프트</span>
        <textarea value={overallPrompt} onChange={(e) => setOverallPrompt(e.target.value)}
          onBlur={saveOverallPrompt} />
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
                  <th>대사/내레이션</th>
                  <th>카메라 지시문</th>
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
