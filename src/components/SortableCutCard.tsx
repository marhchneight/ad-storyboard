import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import CutCard from './CutCard';
import type { Cut } from '../types';

interface Props {
  cut: Cut;
  index: number;
  onUpdate: (patch: Partial<Cut>) => Promise<void>;
  onGenerate: () => Promise<void>;
  onRemove: () => Promise<void>;
  onAiEdited: () => Promise<void>;
  /** True while a "전체 이미지 생성" batch is running — disables drag reordering so the queue can't shift mid-run. */
  dragDisabled?: boolean;
  /** True while a "전체 이미지 생성" batch is running — disables the individual generate/retry button. */
  generateDisabled?: boolean;
}

export default function SortableCutCard({
  cut, index, onUpdate, onGenerate, onRemove, onAiEdited, dragDisabled, generateDisabled,
}: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: cut.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    boxShadow: isDragging ? 'inset 0 0 0 2px var(--accent)' : undefined,
  };

  return (
    <tr ref={setNodeRef} style={style} className="sortable-cut-card"
      data-cut-id={cut.id} data-cut-dna-applied={cut.applied_creative_dna.length > 0 ? 'true' : undefined}>
      <td className="drag-handle-cell">
        <span className="drag-handle" {...(dragDisabled ? {} : attributes)} {...(dragDisabled ? {} : listeners)}>⠿</span>
      </td>
      <CutCard cut={cut} index={index} onUpdate={onUpdate} onGenerate={onGenerate} onRemove={onRemove}
        onAiEdited={onAiEdited} generateDisabled={generateDisabled} />
    </tr>
  );
}
