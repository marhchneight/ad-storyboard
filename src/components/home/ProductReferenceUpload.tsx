import { useState } from 'react';
import {
  deleteProductReference, isAcceptableProductReferenceFile, uploadProductReference,
  type ProductReferenceUploadResult,
} from '../../lib/productReferenceApi';

interface Props {
  value: ProductReferenceUploadResult | null;
  onChange: (value: ProductReferenceUploadResult | null) => void;
  disabled?: boolean;
}

export default function ProductReferenceUpload({ value, onChange, disabled }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    const clientError = isAcceptableProductReferenceFile(file);
    if (clientError) {
      setError(clientError);
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const previous = value;
      const result = await uploadProductReference(file);
      onChange(result);
      if (previous) deleteProductReference(previous.path);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    handleFile(file);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    handleFile(file);
  }

  function handleRemove() {
    if (value) deleteProductReference(value.path);
    onChange(null);
    setError(null);
  }

  return (
    <div className="field">
      <span className="field-label">제품 이미지 (선택)</span>
      <p className="product-ref-desc">제품 이미지가 있으면 생성되는 콘티 이미지에 자동으로 반영됩니다.</p>
      {!value ? (
        <div
          className={`product-ref-dropzone${dragOver ? ' product-ref-dropzone-active' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
        >
          <label className="btn-secondary btn-small product-ref-choose-btn">
            {uploading ? '업로드 중...' : '이미지 선택'}
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleInputChange}
              disabled={disabled || uploading} hidden />
          </label>
          <span className="product-ref-dropzone-hint">PNG, JPG, WEBP</span>
        </div>
      ) : (
        <div className="product-ref-preview">
          <img src={value.url} alt="제품 이미지 미리보기" className="product-ref-thumb" />
          <span className="product-ref-check" aria-hidden="true">✓</span>
          <label className="btn-text product-ref-replace-btn">
            교체
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleInputChange}
              disabled={disabled || uploading} hidden />
          </label>
          <button type="button" className="btn-text" onClick={handleRemove} disabled={disabled || uploading}>삭제</button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
