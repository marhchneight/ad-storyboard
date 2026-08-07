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
import { applyDirectorPreset, askTheDirector, DIRECTOR_PRESETS, type DirectorPreset } from '../lib/directorApi';
import type { Cut, Project } from '../types';

export default function EditorPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [overallPrompt, setOverallPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [distributingCopy, setDistributingCopy] = useState(false);
  const [directing, setDirecting] = useState(false);
  const [directorInstruction, setDirectorInstruction] = useState('');
  const [lastChanges, setLastChanges] = useState<string[] | null>(null);
  const [history, setHistory] = useState<Cut[][]>([]);
  const { cuts, updateCut, generateImage, addCut, removeCut, reorderCuts, refresh, restoreSnapshot } = useCuts(id!);
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

  function pushHistory() {
    setHistory((prev) => [...prev, cuts.map((c) => ({ ...c }))]);
  }

  async function handleApplyPreset(preset: DirectorPreset) {
    if (!project) return;
    setError(null);
    setLastChanges(null);
    pushHistory();
    setDirecting(true);
    try {
      const changes = await applyDirectorPreset(project.id, preset);
      await refresh();
      const { data } = await supabase.from('projects').select('*').eq('id', project.id).single();
      if (data) setProject(data as Project);
      setLastChanges(changes);
    } catch (err) {
      setHistory((prev) => prev.slice(0, -1));
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDirecting(false);
    }
  }

  async function handleAskDirector(e: React.FormEvent) {
    e.preventDefault();
    if (!project || !directorInstruction.trim()) return;
    setError(null);
    setLastChanges(null);
    pushHistory();
    setDirecting(true);
    try {
      const changes = await askTheDirector(project.id, directorInstruction.trim());
      await refresh();
      const { data } = await supabase.from('projects').select('*').eq('id', project.id).single();
      if (data) setProject(data as Project);
      setLastChanges(changes);
      setDirectorInstruction('');
    } catch (err) {
      setHistory((prev) => prev.slice(0, -1));
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDirecting(false);
    }
  }

  async function handleUndo() {
    if (history.length === 0) return;
    setError(null);
    setLastChanges(null);
    const snapshot = history[history.length - 1];
    setHistory((prev) => prev.slice(0, -1));
    try {
      await restoreSnapshot(snapshot);
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
        <div className="page-header-actions">
          <button type="button" className="btn-secondary" onClick={handleUndo} disabled={history.length === 0 || directing}>
            Undo
          </button>
          <button type="button" className="btn-primary" onClick={handleExportPdf} disabled={exporting}>
            {exporting ? 'PDF 생성 중...' : 'PDF로 내보내기'}
          </button>
        </div>
      </div>

      {project.creative_direction && (
        <div className="card prompt-card director-note">
          <span className="field-label">Creative Direction</span>
          <p>{project.creative_direction}</p>
        </div>
      )}

      <div className="card prompt-card director-controls">
        <span className="field-label">Director Controls</span>
        <div className="preset-row">
          {DIRECTOR_PRESETS.map((preset) => (
            <button key={preset.id} type="button" className="btn-secondary btn-small preset-btn"
              onClick={() => handleApplyPreset(preset.id)} disabled={directing}
              title={preset.description}>
              {preset.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleAskDirector} className="ask-director-form">
          <span className="field-label">Ask the Director</span>
          <textarea value={directorInstruction} onChange={(e) => setDirectorInstruction(e.target.value)}
            placeholder="Tell the director what to change…" disabled={directing} />
          <button type="submit" className="btn-secondary" disabled={directing || !directorInstruction.trim()}>
            {directing ? '연출 방향을 다시 잡는 중...' : '감독에게 지시하기'}
          </button>
        </form>

        {lastChanges && lastChanges.length > 0 && (
          <div className="changes-summary">
            <span className="field-label">Changed</span>
            <ul>
              {lastChanges.map((change, i) => <li key={i}>{change}</li>)}
            </ul>
          </div>
        )}
      </div>

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
                    onAiEdited={refresh}
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
