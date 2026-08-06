import { describe, it, expect } from 'vitest';
import { extractTextFromDocxXml, extractTextFromPptxSlideXml } from './copyFileParser';

describe('extractTextFromDocxXml', () => {
  it('joins runs within a paragraph and separates paragraphs by newline', () => {
    const xml = `
      <w:body>
        <w:p><w:r><w:t>안녕하세요, </w:t></w:r><w:r><w:t>반갑습니다.</w:t></w:r></w:p>
        <w:p><w:r><w:t>두 번째 문단입니다.</w:t></w:r></w:p>
      </w:body>
    `;
    expect(extractTextFromDocxXml(xml)).toBe('안녕하세요, 반갑습니다.\n두 번째 문단입니다.');
  });

  it('decodes XML entities and skips empty paragraphs', () => {
    const xml = `
      <w:p><w:r><w:t>A &amp; B &lt;test&gt;</w:t></w:r></w:p>
      <w:p></w:p>
      <w:p><w:r><w:t>다음 줄</w:t></w:r></w:p>
    `;
    expect(extractTextFromDocxXml(xml)).toBe('A & B <test>\n다음 줄');
  });
});

describe('extractTextFromPptxSlideXml', () => {
  it('extracts text runs from a slide, one per line', () => {
    const xml = `
      <p:sld>
        <a:t>슬라이드 제목</a:t>
        <a:t>본문 텍스트</a:t>
      </p:sld>
    `;
    expect(extractTextFromPptxSlideXml(xml)).toBe('슬라이드 제목\n본문 텍스트');
  });

  it('returns empty string when slide has no text runs', () => {
    const xml = '<p:sld><p:spTree></p:spTree></p:sld>';
    expect(extractTextFromPptxSlideXml(xml)).toBe('');
  });
});
