/** Scrolls to a cut row and briefly flashes every row with applied Creative DNA. */
export function scrollToAndHighlightAppliedCuts(cutId: string): void {
  const row = document.querySelector<HTMLElement>(`[data-cut-id="${cutId}"]`);
  row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  document.querySelectorAll<HTMLElement>('[data-cut-dna-applied="true"]').forEach((el) => {
    el.classList.add('cut-dna-highlight');
    setTimeout(() => el.classList.remove('cut-dna-highlight'), 1600);
  });
}
