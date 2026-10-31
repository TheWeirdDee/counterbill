/**
 * Upload validation and text extraction. Uploaded files are untrusted: only a fixed set of types is accepted,
 * magic bytes must match, and extracted text is stored as data that agents are told never to obey.
 */
import path from 'node:path';

export const ALLOWED_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.eml', '.txt'] as const;
export const MAX_PDF_PAGES = 60;

export interface ParsedPage {
  page: number;
  text: string;
}
export interface ParseResult {
  status: 'ready' | 'needs_manual_review' | 'failed';
  method: string;
  ocr: boolean;
  confidence: number | null;
  pages: ParsedPage[];
  error?: string;
  /** Guidance shown to the user when status isn't `ready`. */
  hint?: string;
}

export class UploadRejected extends Error {
  constructor(
    public readonly code: 'unsupported_type' | 'too_large' | 'empty' | 'type_mismatch' | 'too_many_files' | 'case_too_large',
    message: string,
  ) {
    super(message);
  }
}

export function sanitizeFilename(name: string): string {
  const base = path.basename(name.replace(/\\/g, '/')).normalize('NFKC');
  const cleaned = base.replace(/[^\p{L}\p{N}._ ()+20132014-]/gu, '_').replace(/\.{2,}/g, '.').trim().slice(0, 120);
  return cleaned || 'document';
}

function detectType(buf: Buffer): 'pdf' | 'png' | 'jpg' | 'text' | 'unknown' {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  // text: no NUL bytes in the first 4 KB
  const head = buf.subarray(0, 4096);
  if (!head.includes(0)) return 'text';
  return 'unknown';
}

export function validateUpload(filename: string, buf: Buffer, maxBytes: number): { ext: string; type: 'pdf' | 'png' | 'jpg' | 'text'; mime: string } {
  const ext = path.extname(filename).toLowerCase();
  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new UploadRejected('unsupported_type', `"${filename}" is not supported. Upload a PDF, PNG, JPG, .eml or .txt file.`);
  }
  if (buf.length === 0) throw new UploadRejected('empty', `"${filename}" is empty.`);
  if (buf.length > maxBytes) throw new UploadRejected('too_large', `"${filename}" is larger than ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  const type = detectType(buf);
  const expected = ext === '.pdf' ? 'pdf' : ext === '.png' ? 'png' : ext === '.jpg' || ext === '.jpeg' ? 'jpg' : 'text';
  if (type !== expected) {
    throw new UploadRejected('type_mismatch', `"${filename}" does not look like a real ${ext} file, so it was not accepted.`);
  }
  const mime = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', text: ext === '.eml' ? 'message/rfc822' : 'text/plain' }[expected];
  return { ext, type: expected, mime };
}

export async function parseDocument(buf: Buffer, filename: string): Promise<ParseResult> {
  const ext = path.extname(filename).toLowerCase();
  try {
    if (ext === '.pdf') return await parsePdf(buf);
    if (ext === '.png' || ext === '.jpg' || ext === '.jpeg') {
      return {
        status: 'needs_manual_review',
        method: 'none',
        ocr: false,
        confidence: null,
        pages: [],
        hint: 'This is an image. Text recognition (OCR) is not configured in this deployment, so nothing was read from it. Enter the key figures by hand below, or upload a text-based PDF.',
      };
    }
    if (ext === '.eml') return parseEml(buf);
    return parseText(buf.toString('utf8'), 'plain-text');
  } catch (err) {
    return { status: 'failed', method: 'error', ocr: false, confidence: null, pages: [], error: (err as Error).message, hint: 'The file could not be read. Replace it, or continue with the facts you can enter manually.' };
  }
}

async function parsePdf(buf: Buffer): Promise<ParseResult> {
  const { getDocumentProxy, extractText } = await import('unpdf');
  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(buf), { isEvalSupported: false } as never);
  } catch (e) {
    const msg = (e as Error).message ?? '';
    if (/password/i.test(msg)) {
      return { status: 'failed', method: 'pdf-text', ocr: false, confidence: null, pages: [], error: 'This PDF is password-protected.', hint: 'Remove the password and upload it again.' };
    }
    return { status: 'failed', method: 'pdf-text', ocr: false, confidence: null, pages: [], error: `The PDF is corrupt or unreadable (${msg.slice(0, 120)}).`, hint: 'Export or re-scan the file and upload it again.' };
  }
  if (pdf.numPages > MAX_PDF_PAGES) {
    return { status: 'failed', method: 'pdf-text', ocr: false, confidence: null, pages: [], error: `The PDF has ${pdf.numPages} pages; the limit is ${MAX_PDF_PAGES}.`, hint: 'Upload only the relevant pages.' };
  }
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = (text as string[]).map((t, i) => ({ page: i + 1, text: t.replace(/\u0000/g, '').trim() }));
  const chars = pages.reduce((n, p) => n + p.text.length, 0);
  if (chars < 20 * Math.max(1, pages.length)) {
    return {
      status: 'needs_manual_review',
      method: 'pdf-text',
      ocr: false,
      confidence: 0.1,
      pages: pages.filter((p) => p.text),
      hint: 'This PDF has little or no selectable text (it may be a scan). OCR is not configured here, so enter the key figures by hand or upload a text-based PDF.',
    };
  }
  return { status: 'ready', method: 'pdf-text', ocr: false, confidence: 0.9, pages: pages.filter((p) => p.text) };
}

export function parseEml(buf: Buffer): ParseResult {
  const raw = buf.toString('utf8').replace(/\r\n/g, '\n');
  const split = raw.indexOf('\n\n');
  const headerBlock = split === -1 ? raw : raw.slice(0, split);
  let body = split === -1 ? '' : raw.slice(split + 2);
  const headers: Record<string, string> = {};
  for (const line of headerBlock.replace(/\n[ \t]+/g, ' ').split('\n')) {
    const m = line.match(/^([A-Za-z-]+):\s*(.*)$/);
    if (m) headers[m[1].toLowerCase()] = m[2];
  }
  if (/quoted-printable/i.test(headers['content-transfer-encoding'] ?? '')) {
    body = body.replace(/=\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
  }
  if (/text\/html/i.test(headers['content-type'] ?? '')) body = body.replace(/<[^>]+>/g, ' ');
  const head = ['From', 'To', 'Date', 'Subject'].filter((h) => headers[h.toLowerCase()]).map((h) => `${h}: ${headers[h.toLowerCase()]}`);
  const text = `${head.join('\n')}\n\n${body.trim()}`;
  const res = parseText(text, 'eml');
  return res.pages.length ? res : { ...res, status: 'needs_manual_review', hint: 'No readable message body was found in this .eml file.' };
}

function parseText(text: string, method: string): ParseResult {
  const t = text.replace(/\u0000/g, '').trim();
  if (!t) return { status: 'needs_manual_review', method, ocr: false, confidence: null, pages: [], hint: 'The file contains no text.' };
  // Plain text has no page structure; paginate on form feeds if present, else a single page.
  const pages = t.split('\f').map((p, i) => ({ page: i + 1, text: p.trim() })).filter((p) => p.text);
  return { status: 'ready', method, ocr: false, confidence: 1, pages };
}

/**
 * Split a page into citable spans (paragraphs / short groups of lines) with stable offsets.
 * Offsets refer to the page text exactly as stored for the viewer.
 */
export function splitIntoSpans(pageText: string, maxLen = 320): { text: string; start: number; end: number }[] {
  const spans: { text: string; start: number; end: number }[] = [];
  const lines: { text: string; start: number }[] = [];
  let pos = 0;
  for (const line of pageText.split('\n')) {
    lines.push({ text: line, start: pos });
    pos += line.length + 1;
  }
  let cur: { text: string; start: number; end: number } | null = null;
  const flush = () => {
    if (cur && cur.text.trim()) spans.push(cur);
    cur = null;
  };
  for (const l of lines) {
    const t = l.text.trim();
    if (!t) {
      flush();
      continue;
    }
    const lead = l.text.indexOf(t);
    const start = l.start + lead;
    if (cur && cur.text.length + 1 + t.length <= maxLen) {
      cur = { text: `${cur.text}\n${t}`, start: cur.start, end: start + t.length };
    } else {
      flush();
      if (t.length > maxLen) {
        // Break very long lines on sentence boundaries.
        let offset = 0;
        for (const piece of t.match(/[^.!?]+[.!?]*\s*/g) ?? [t]) {
          const pt = piece.trim();
          if (!pt) {
            offset += piece.length;
            continue;
          }
          const s = start + t.indexOf(pt, offset);
          if (cur && (cur as { text: string }).text.length + pt.length + 1 <= maxLen) {
            cur = { text: `${(cur as { text: string }).text} ${pt}`, start: (cur as { start: number }).start, end: s + pt.length };
          } else {
            flush();
            cur = { text: pt, start: s, end: s + pt.length };
          }
          offset += piece.length;
        }
      } else {
        cur = { text: t, start, end: start + t.length };
      }
    }
  }
  flush();
  return spans;
}
