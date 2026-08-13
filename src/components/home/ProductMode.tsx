import { useState, type ReactNode } from 'react';
import { analyzeBrand, generateCreativeDirection, suggestConcepts, type SceneCountParams } from '../../lib/creativeDirectionApi';
import type { ProductReferenceUploadResult } from '../../lib/productReferenceApi';
import ProductReferenceUpload from './ProductReferenceUpload';
import type { BrandAnalysis, CreativeBrief, CreativeConcept, CreativeTreatment } from '../../types';

type SuggestStage = 'idle' | 'analyzing' | 'ideating';

interface Props {
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
  onGenerated: (treatment: CreativeTreatment, context: { freeformIdea?: string; brief?: CreativeBrief }) => void;
  onError: (message: string) => void;
  styleField: ReactNode;
  aspectRatioField: ReactNode;
  storyboardLengthField: ReactNode;
  sceneCountParams: SceneCountParams;
}

export default function ProductMode({
  busy, onBusyChange, onGenerated, onError, styleField, aspectRatioField, storyboardLengthField, sceneCountParams,
}: Props) {
  const [product, setProduct] = useState('');
  const [targetAudience, setTargetAudience] = useState('');
  const [mood, setMood] = useState('');
  const [platform, setPlatform] = useState('');
  const [concepts, setConcepts] = useState<CreativeConcept[] | null>(null);
  const [brandAnalysis, setBrandAnalysis] = useState<BrandAnalysis | null>(null);
  const [productReference, setProductReference] = useState<ProductReferenceUploadResult | null>(null);
  const [stage, setStage] = useState<SuggestStage>('idle');
  const suggesting = stage !== 'idle';

  async function handleSuggest(e: React.FormEvent) {
    e.preventDefault();
    if (!product.trim() || suggesting) return;
    setConcepts(null);
    setBrandAnalysis(null);
    try {
      setStage('analyzing');
      const analysis = await analyzeBrand({
        product: product.trim(),
        targetAudience: targetAudience.trim() || undefined,
        mood: mood.trim() || undefined,
        platform: platform.trim() || undefined,
      });
      setBrandAnalysis(analysis);

      setStage('ideating');
      const result = await suggestConcepts({
        product: product.trim(),
        targetAudience: targetAudience.trim() || undefined,
        mood: mood.trim() || undefined,
        platform: platform.trim() || undefined,
        brandContext: analysis,
      });
      setConcepts(result);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setStage('idle');
    }
  }

  async function handleSelectConcept(c: CreativeConcept) {
    if (busy) return;
    onBusyChange(true);
    try {
      const brief: CreativeBrief = {
        product: product.trim() || undefined,
        targetAudience: targetAudience.trim() || undefined,
        mood: mood.trim() || undefined,
        platform: (platform.trim() || undefined) as CreativeBrief['platform'],
        conceptDescription: `${c.title}: ${c.concept}`,
        brandContext: brandAnalysis ?? undefined,
        productReferenceImageUrl: productReference?.url,
      };
      const freeformIdea = `${c.title}. ${c.concept}`;
      const treatment = await generateCreativeDirection({ freeformIdea, brief, ...sceneCountParams });
      onGenerated(treatment, { freeformIdea, brief });
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      onBusyChange(false);
    }
  }

  const suggestLabel = stage === 'analyzing'
    ? '브랜드를 알아보고 있어요...'
    : stage === 'ideating'
      ? '아이디어를 구상하는 중...'
      : '아이디어가 없으신가요? 영감 받기 ✦';

  return (
    <div className="start-mode-panel">
      <p className="start-mode-desc">이 제품을 어떤 광고 아이디어로 풀 수 있을지 AI가 제안해드려요.</p>
      <form onSubmit={handleSuggest} className="ask-director-form">
        <div className="field">
          <span className="field-label">무엇을 광고할까요?</span>
          <input value={product} onChange={(e) => setProduct(e.target.value)} placeholder="제품 / 브랜드" disabled={suggesting || busy} required />
        </div>
        <div className="field">
          <span className="field-label">타깃 고객은? (선택)</span>
          <input value={targetAudience} onChange={(e) => setTargetAudience(e.target.value)} disabled={suggesting || busy} />
        </div>
        <div className="field">
          <span className="field-label">무드는? (선택)</span>
          <input value={mood} onChange={(e) => setMood(e.target.value)} disabled={suggesting || busy} />
        </div>
        <div className="field">
          <span className="field-label">플랫폼은? (선택)</span>
          <input value={platform} onChange={(e) => setPlatform(e.target.value)} disabled={suggesting || busy} />
        </div>
        <ProductReferenceUpload value={productReference} onChange={setProductReference} disabled={suggesting || busy} />
        {styleField}
        {aspectRatioField}
        {storyboardLengthField}
        <button type="submit" className="btn-accent btn-block" disabled={suggesting || busy || !product.trim()}>
          {suggestLabel}
        </button>
      </form>

      {concepts && (
        <div className="concept-cards">
          {concepts.map((c, i) => (
            <button type="button" key={i} className="concept-card" onClick={() => handleSelectConcept(c)} disabled={busy}>
              <span className="concept-card-index">{String(i + 1).padStart(2, '0')}</span>
              <h3>{c.title}</h3>
              <p>{c.concept}</p>
              {c.reason && <p className="concept-card-reason">{c.reason}</p>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
