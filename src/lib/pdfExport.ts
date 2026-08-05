import { jsPDF } from 'jspdf';
import type { Project, Cut } from '../types';

export async function buildStoryboardPdf(project: Project, cuts: Cut[]): Promise<jsPDF> {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });

  for (let i = 0; i < cuts.length; i++) {
    const cut = cuts[i];
    if (i > 0) doc.addPage();
    doc.setFontSize(16);
    doc.text(`${project.title} — 컷 ${i + 1}`, 40, 40);

    if (cut.image_url) {
      try {
        const res = await fetch(cut.image_url);
        const blob = await res.blob();
        const dataUrl: string = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
        doc.addImage(dataUrl, 'PNG', 40, 60, 200, 200);
      } catch (err) {
        console.warn(`Failed to embed image for cut ${i + 1}:`, err);
      }
    }

    doc.setFontSize(11);
    doc.text(`장면 설명: ${cut.scene_description || '-'}`, 40, 280, { maxWidth: 500 });
    doc.text(`대사/내레이션: ${cut.dialogue || '-'}`, 40, 320, { maxWidth: 500 });
    doc.text(`카메라 지시문: ${cut.camera_direction || '-'}`, 40, 360, { maxWidth: 500 });
  }

  return doc;
}

export async function downloadCutImage(cut: Cut, index: number): Promise<void> {
  if (!cut.image_url) return;
  const res = await fetch(cut.image_url);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = `cut-${index + 1}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
