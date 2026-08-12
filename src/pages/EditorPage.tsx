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
import { buildImagesZip, buildImagesZipFilename } from '../lib/imageZipExport';
import { downloadBlob } from '../lib/download';
import { scrollToAndHighlightAppliedCuts } from '../lib/dnaHighlight';
import {
  applyDirectorPreset, askTheDirector, applyMakeItCrazy, type DirectorPreset,
} from '../lib/directorApi';
import { pickRandomConstraint } from '../lib/creativeRoulette';
import DirectorControls from '../components/director/DirectorControls';
import CreativeDnaPanel from '../components/creative-dna/CreativeDnaPanel';
import ThemeToggle from '../components/ThemeToggle';
import type { Cut, Project } from '../types';

export default function EditorPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [overallPrompt, setOverallPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [zipProgress, setZipProgress] = useState<{ done: number; total: number } | null>(null);
  const [directing, setDirecting] = useState(false);
  const [directorInstruction, setDirectorInstruction] = useState('');
  const [lastChanges, setLastChanges] = useState<string[] | null>(null);
  const [history, setHistory] = useState<Cut[][]>([]);
  const [rouletteConstraint, setRouletteConstraint] = useState<string | null>(null);
  const [batchGenerating, setBatchGenerating] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ cutNumber: number; completed: number; total: number } | null>(null);
  const [batchSummary, setBatchSummary] = useState<string | null>(null);
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
    if (batchGenerating) return;
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

  async function handleDownloadAllImages() {
    if (!project) return;
    setError(null);
    setZipping(true);
    setZipProgress(null);
    try {
      const { blob, succeededCount, failedSceneNumbers } = await buildImagesZip(
        cuts,
        (done, total) => setZipProgress({ done, total }),
      );
      if (!blob) {
        setError('다운로드할 이미지가 없습니다.');
        return;
      }
      downloadBlob(blob, buildImagesZipFilename(project));
      if (failedSceneNumbers.length > 0) {
        setError(`${succeededCount}개의 이미지를 다운로드했습니다. ${failedSceneNumbers.join(', ')}번 컷 이미지는 불러오지 못했습니다.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setZipping(false);
      setZipProgress(null);
    }
  }

  // Batch generation is a thin sequential orchestration over the same
  // generateImage(cutId) the individual "이미지 생성" button already calls —
  // no separate/simplified generation path. Sequential (not concurrent)
  // because generate-image locks each entity's reference image to the first
  // shot that generates it (see withLockedReferenceImages), so later shots
  // depend on earlier ones having already finished.
  async function handleGenerateAll() {
    if (batchGenerating) return;
    const targets = cuts
      .map((cut, i) => ({ cut, cutNumber: i + 1 }))
      .filter(({ cut }) => !cut.image_url && cut.generation_status !== 'generating');
    if (targets.length === 0) {
      setBatchSummary('모든 컷의 이미지가 이미 생성되어 있습니다.');
      return;
    }
    setError(null);
    setBatchSummary(null);
    setBatchGenerating(true);
    let succeeded = 0;
    const failedNumbers: number[] = [];
    for (let i = 0; i < targets.length; i++) {
      const { cut, cutNumber } = targets[i];
      setBatchProgress({ cutNumber, completed: i, total: targets.length });
      try {
        await generateImage(cut.id);
        succeeded++;
      } catch {
        failedNumbers.push(cutNumber);
      }
    }
    setBatchProgress(null);
    setBatchGenerating(false);
    const parts = [`${succeeded}개의 이미지를 생성했습니다.`];
    if (failedNumbers.length > 0) {
      parts.push(`${failedNumbers.join(', ')}번 컷 생성에 실패했습니다. 다시 시도해주세요.`);
    }
    setBatchSummary(parts.join(' '));
  }

  if (!project) return <div className="page-shell">로딩 중...</div>;

  const pendingImageCount = cuts.filter((c) => !c.image_url && c.generation_status !== 'generating').length;
  const generateAllLabel = batchGenerating && batchProgress
    ? `${batchProgress.cutNumber}번 컷 생성 중... ${batchProgress.completed}/${batchProgress.total} 완료`
    : pendingImageCount > 0 ? `전체 이미지 생성 (${pendingImageCount})` : '전체 이미지 생성';

  const dnaAppliedCount = cuts.filter((c) => c.applied_creative_dna.length > 0).length;
  const firstDnaAppliedCutId = cuts.find((c) => c.applied_creative_dna.length > 0)?.id ?? null;

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <Link to="/" className="btn-text back-link">← Studio</Link>
          <h1>{project.title}</h1>
          {dnaAppliedCount > 0 && (
            <button type="button" className="btn-text dna-summary-link"
              onClick={() => firstDnaAppliedCutId && scrollToAndHighlightAppliedCuts(firstDnaAppliedCutId)}>
              레퍼런스 연출 · {dnaAppliedCount}/{cuts.length}컷 반영
            </button>
          )}
        </div>
        <div className="page-header-actions">
          <button type="button" className="btn-secondary" onClick={handleUndo} disabled={history.length === 0 || directing}>
            Undo
          </button>
          <button type="button" className="btn-secondary" onClick={handleGenerateAll}
            disabled={batchGenerating || pendingImageCount === 0}>
            {generateAllLabel}
          </button>
          <button type="button" className="btn-secondary" onClick={handleDownloadAllImages} disabled={zipping}>
            {zipping
              ? (zipProgress ? `이미지 준비 중... ${zipProgress.done}/${zipProgress.total}` : '이미지 준비 중...')
              : '이미지 전체 다운로드'}
          </button>
          <button type="button" className="btn-primary" onClick={handleExportPdf} disabled={exporting}>
            {exporting ? 'PDF 생성 중...' : 'PDF로 내보내기'}
          </button>
          <ThemeToggle />
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
                    dragDisabled={batchGenerating}
                    generateDisabled={batchGenerating}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </SortableContext>
      </DndContext>
      {batchSummary && <p className="field-hint">{batchSummary}</p>}
      {error && <p className="error">{error}</p>}
      <button type="button" className="btn-secondary" onClick={handleAddCut}>+ 컷 추가</button>
    </div>
  );
}
