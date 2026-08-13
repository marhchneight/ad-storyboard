import type { CreativeDna } from '../../types';

interface Props {
  dna: CreativeDna;
}

interface SectionConfig {
  key: string;
  title: string;
  observations: string[];
  application: string[];
  dominantColors?: string[];
}

// Merges English + Korean arrays item-by-item (never swaps the whole array) so a partial/missing
// Ko mirror still shows every English item rather than silently dropping items past the Ko array's
// length — matches the same safety pattern used elsewhere for this data (e.g. ai-director never
// trusts a Ko array's length without checking).
function mergeKo(items: string[], itemsKo?: string[]): string[] {
  return items.map((item, i) => itemsKo?.[i] ?? item);
}

function buildSections(dna: CreativeDna): SectionConfig[] {
  return [
    {
      key: 'camera',
      title: '카메라 연출',
      observations: mergeKo(dna.cameraDna, dna.cameraDnaKo),
      application: mergeKo(dna.cameraApplication ?? [], dna.cameraApplicationKo),
    },
    {
      key: 'lighting',
      title: '조명',
      observations: mergeKo(dna.lightingDna, dna.lightingDnaKo),
      application: mergeKo(dna.lightingApplication ?? [], dna.lightingApplicationKo),
    },
    {
      key: 'composition',
      title: '화면 구성',
      observations: mergeKo(dna.compositionDna, dna.compositionDnaKo),
      application: mergeKo(dna.compositionApplication ?? [], dna.compositionApplicationKo),
    },
    {
      key: 'editRhythm',
      title: dna.editRhythmInferred ? '편집 / 리듬 (제안)' : '편집 / 리듬',
      observations: mergeKo(dna.editRhythmDna, dna.editRhythmDnaKo),
      application: mergeKo(dna.editRhythmApplication ?? [], dna.editRhythmApplicationKo),
    },
    {
      key: 'colorMood',
      title: '컬러 / 무드',
      observations: mergeKo(dna.colorMood, dna.colorMoodKo),
      application: mergeKo(dna.colorMoodApplication ?? [], dna.colorMoodApplicationKo),
      dominantColors: dna.dominantColors,
    },
    {
      key: 'productTreatment',
      title: '제품 다루기',
      observations: mergeKo(dna.productTreatment ?? [], dna.productTreatmentKo),
      application: mergeKo(dna.productTreatmentApplication ?? [], dna.productTreatmentApplicationKo),
    },
    {
      key: 'creativeDirection',
      title: '크리에이티브 방향',
      observations: mergeKo(dna.creativePrinciples, dna.creativePrinciplesKo),
      application: mergeKo(dna.creativePrinciplesApplication ?? [], dna.creativePrinciplesApplicationKo),
    },
  ];
}

/** Renders a full Creative DNA analysis: the compact visual-tone score bars, then one collapsible
 * section per detail category (observations + a "→ 콘티 적용" storyboard-application block), skipping
 * any section with no observations (e.g. "제품 다루기" when no product is visible in the reference).
 * Shared by ReferenceMode.tsx (pre-creation) and CreativeDnaPanel.tsx (post-creation, Editor page) so
 * both surfaces show identically rich results. Every field is read defensively (`?? []`) so older,
 * simpler stored records (visualLanguage + 6 arrays only, no application/color/product fields) render
 * exactly as before instead of erroring. */
export default function CreativeDnaResult({ dna }: Props) {
  const sections = buildSections(dna).filter((s) => s.observations.length > 0);

  return (
    <div className="dna-detail-result">
      <span className="field-label">비주얼 톤</span>
      <div className="dna-scores">
        {dna.visualLanguage.map((v) => (
          <div className="dna-score-row" key={v.label}>
            <span className="dna-score-label">{v.labelKo ?? v.label}</span>
            <div className="dna-score-bar">
              <div className="dna-score-fill" style={{ width: `${Math.max(0, Math.min(100, v.score))}%` }} />
            </div>
            <span className="dna-score-value">{v.score}%</span>
          </div>
        ))}
      </div>

      {sections.map((section) => (
        <details className="dna-section" key={section.key} open>
          <summary>{section.title}</summary>
          <ul>
            {section.observations.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
          {section.dominantColors && section.dominantColors.length > 0 && (
            <div className="dna-colors">
              {section.dominantColors.map((hex, i) => (
                <span key={i} className="dna-color-swatch" style={{ backgroundColor: hex }} title={hex} />
              ))}
            </div>
          )}
          {section.application.length > 0 && (
            <div className="dna-application">
              <span className="dna-application-label">→ 콘티 적용</span>
              <ul>
                {section.application.map((item, i) => <li key={i}>{item}</li>)}
              </ul>
            </div>
          )}
        </details>
      ))}
    </div>
  );
}
