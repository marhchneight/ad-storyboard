import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
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
import {
  applyDirectorPreset, askTheDirector, applyMakeItCrazy, type DirectorPreset,
} from '../lib/directorApi';
import { pickRandomConstraint } from '../lib/creativeRoulette';
import DirectorControls from '../components/director/DirectorControls';
import CreativeDnaPanel from '../components/creative-dna/CreativeDnaPanel';
import type { Cut, Project } from '../types';

export default function EditorPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [overallPrompt, setOverallPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [directing, setDirecting] = useState(false);
  const [directorInstruction, setDirectorInstruction] = useState('');
  const [lastChanges, setLastChanges] = useState<string[] | null>(null);
  const [history, setHistory] = useState<Cut[][]>([]);
  const [rouletteConstraint, setRouletteConstraint] = useState<string | null>(null);
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

  async function handleMakeItCrazy() {
    if (!project) return;
    setError(null);
    setLastChanges(null);
    pushHistory();
    setDirecting(true);
    try {
      const changes = await applyMakeItCrazy(project.id);
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

  function handleOpenRoulette() {
    setRouletteConstraint(pickRandomConstraint());
  }

  function handleShuffleRoulette() {
    setRouletteConstraint((prev) => pickRandomConstraint(prev ?? undefined));
  }

  function handleCancelRoulette() {
    setRouletteConstraint(null);
  }

  async function handleApplyRoulette() {
    if (!project || !rouletteConstraint) return;
    const constraint = rouletteConstraint;
    setError(null);
    setLastChanges(null);
    setRouletteConstraint(null);
    pushHistory();
    setDirecting(true);
    try {
      const changes = await askTheDirector(project.id, constraint);
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
          <Link to="/" className="btn-text back-link">← Studio</Link>
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

      <DirectorControls
        directing={directing}
        onApplyPreset={handleApplyPreset}
        directorInstruction={directorInstruction}
        onDirectorInstructionChange={setDirectorInstruction}
        onAskDirector={handleAskDirector}
        lastChanges={lastChanges}
        onMakeItCrazy={handleMakeItCrazy}
        rouletteConstraint={rouletteConstraint}
        onOpenRoulette={handleOpenRoulette}
        onShuffleRoulette={handleShuffleRoulette}
        onApplyRoulette={handleApplyRoulette}
        onCancelRoulette={handleCancelRoulette}
      />

      <CreativeDnaPanel
        project={project}
        onBeforeApply={pushHistory}
        onApplied={(changes, updatedProject) => {
          setProject(updatedProject);
          if (changes.length > 0) {
            setLastChanges(changes);
            refresh();
          }
        }}
      />

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
