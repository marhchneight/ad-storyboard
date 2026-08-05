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
}

export default function SortableCutCard({ cut, index, onUpdate, onGenerate, onRemove }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: cut.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="sortable-cut-card">
      <div className="drag-handle" {...attributes} {...listeners}>
        ⠿ 드래그하여 순서 변경
      </div>
      <CutCard cut={cut} index={index} onUpdate={onUpdate} onGenerate={onGenerate} onRemove={onRemove} />
    </div>
  );
}
