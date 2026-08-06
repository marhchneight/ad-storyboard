import JSZip from 'jszip';

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/** Extracts visible text from a Word document.xml body, one line per paragraph. */
export function extractTextFromDocxXml(xml: string): string {
  const paragraphs = xml.split(/<\/w:p>/);
  const lines = paragraphs.map((paragraph) => {
    const runs = [...paragraph.matchAll(/<w:t[^>]*>(.*?)<\/w:t>/gs)].map((m) => decodeXmlEntities(m[1]));
    return runs.join('');
  });
  return lines.filter((line) => line.trim().length > 0).join('\n');
}

/** Extracts visible text from a single PowerPoint slideN.xml, one line per text run. */
export function extractTextFromPptxSlideXml(xml: string): string {
  const runs = [...xml.matchAll(/<a:t>(.*?)<\/a:t>/gs)].map((m) => decodeXmlEntities(m[1]));
  return runs.filter((line) => line.trim().length > 0).join('\n');
}

async function extractTextFromDocx(file: File): Promise<string> {
  const zip = await JSZip.loadAsync(file);
  const documentXml = await zip.file('word/document.xml')?.async('text');
  if (!documentXml) throw new Error('word/document.xml을 찾을 수 없습니다. 올바른 .docx 파일인지 확인해주세요.');
  return extractTextFromDocxXml(documentXml);
}

async function extractTextFromPptx(file: File): Promise<string> {
  const zip = await JSZip.loadAsync(file);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const numA = Number(a.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
      const numB = Number(b.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
      return numA - numB;
    });
  if (slideFiles.length === 0) throw new Error('슬라이드를 찾을 수 없습니다. 올바른 .pptx 파일인지 확인해주세요.');

  const slideTexts: string[] = [];
  for (const name of slideFiles) {
    const xml = await zip.file(name)!.async('text');
    slideTexts.push(extractTextFromPptxSlideXml(xml));
  }
  return slideTexts.filter((text) => text.length > 0).join('\n\n');
}

/** Extracts plain text from a .txt, .docx, or .pptx file for use as ad-copy source material. */
export async function extractTextFromFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.txt')) return file.text();
  if (name.endsWith('.docx')) return extractTextFromDocx(file);
  if (name.endsWith('.pptx')) return extractTextFromPptx(file);
  throw new Error('지원하지 않는 파일 형식입니다. .txt, .docx, .pptx 파일만 업로드할 수 있어요.');
}
