/**
 * A small A4 layout engine on pdf-lib. Fonts are embedded (Noto Sans: Latin + Latin Extended subsets) so the naira
 * sign, the multiplication sign and the minus sign are real, selectable text. Each character is drawn from the first
 * font that has a glyph for it.
 */
import fs from 'node:fs';
import path from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, PDFFont, PDFPage, rgb, type RGB } from 'pdf-lib';

const A4: [number, number] = [595.28, 841.89];

function fontBytes(file: string): Uint8Array {
  const p = path.resolve('node_modules/@fontsource/noto-sans/files', file);
  return new Uint8Array(fs.readFileSync(p));
}

interface Face {
  fonts: PDFFont[];
  has: ((cp: number) => boolean)[];
}

export interface Style {
  size: number;
  bold?: boolean;
  color?: RGB;
}

export const COLORS = {
  ink: rgb(0.1, 0.12, 0.17),
  muted: rgb(0.38, 0.42, 0.5),
  rule: rgb(0.8, 0.82, 0.86),
  accent: rgb(0.1, 0.36, 0.55),
  warn: rgb(0.62, 0.38, 0.02),
  warnBg: rgb(1, 0.96, 0.86),
  panel: rgb(0.95, 0.96, 0.98),
};

export class PdfBuilder {
  private page!: PDFPage;
  private y = 0;
  readonly margin = 56;
  private regular!: Face;
  private bold!: Face;
  private footerText = '';
  private headerNote: string | null = null;

  private constructor(private readonly doc: PDFDocument) {}

  static async create(opts: { title: string; author: string; subject: string }): Promise<PdfBuilder> {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    doc.setTitle(opts.title);
    doc.setAuthor(opts.author);
    doc.setSubject(opts.subject);
    doc.setCreator('Counterbill');
    doc.setProducer('Counterbill (pdf-lib)');
    const b = new PdfBuilder(doc);
    const load = async (weight: '400' | '700'): Promise<Face> => {
      const files = [`noto-sans-latin-${weight}-normal.woff`, `noto-sans-latin-ext-${weight}-normal.woff`];
      const fonts: PDFFont[] = [];
      const has: ((cp: number) => boolean)[] = [];
      for (const f of files) {
        const bytes = fontBytes(f);
        fonts.push(await doc.embedFont(bytes, { subset: true }));
        const fk = fontkit.create(Buffer.from(bytes) as never) as unknown as { hasGlyphForCodePoint(cp: number): boolean };
        has.push((cp) => fk.hasGlyphForCodePoint(cp));
      }
      return { fonts, has };
    };
    b.regular = await load('400');
    b.bold = await load('700');
    b.newPage();
    return b;
  }

  setFooter(text: string) {
    this.footerText = text;
  }
  setHeaderNote(text: string | null) {
    this.headerNote = text;
  }

  private face(bold?: boolean): Face {
    return bold ? this.bold : this.regular;
  }

  private runs(text: string, bold?: boolean): { font: PDFFont; text: string }[] {
    const face = this.face(bold);
    const out: { font: PDFFont; text: string }[] = [];
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      let idx = face.has.findIndex((h) => h(cp));
      if (idx < 0) idx = 0;
      const last = out[out.length - 1];
      if (last && last.font === face.fonts[idx]) last.text += ch;
      else out.push({ font: face.fonts[idx], text: ch });
    }
    return out;
  }

  width(text: string, size: number, bold?: boolean): number {
    return this.runs(text, bold).reduce((w, r) => w + r.font.widthOfTextAtSize(r.text, size), 0);
  }

  get contentWidth(): number {
    return A4[0] - this.margin * 2;
  }

  newPage() {
    this.page = this.doc.addPage(A4);
    this.y = A4[1] - this.margin;
    if (this.headerNote && this.doc.getPageCount() >= 1) {
      this.note(this.headerNote);
    }
  }

  ensure(h: number) {
    if (this.y - h < this.margin + 24) this.newPage();
  }

  space(h: number) {
    this.y -= h;
  }

  private drawLine(text: string, x: number, style: Style) {
    let cx = x;
    for (const r of this.runs(text, style.bold)) {
      this.page.drawText(r.text, { x: cx, y: this.y - style.size, size: style.size, font: r.font, color: style.color ?? COLORS.ink });
      cx += r.font.widthOfTextAtSize(r.text, style.size);
    }
  }

  wrap(text: string, size: number, width: number, bold?: boolean): string[] {
    const lines: string[] = [];
    for (const para of text.split('\n')) {
      if (!para.trim()) {
        lines.push('');
        continue;
      }
      let cur = '';
      for (const word of para.split(/\s+/)) {
        let w = word;
        while (this.width(w, size, bold) > width) {
          // break an over-long token (hashes, URLs)
          let n = w.length;
          while (n > 1 && this.width(w.slice(0, n), size, bold) > width) n--;
          if (cur) {
            lines.push(cur);
            cur = '';
          }
          lines.push(w.slice(0, n));
          w = w.slice(n);
        }
        const trial = cur ? `${cur} ${w}` : w;
        if (this.width(trial, size, bold) <= width) cur = trial;
        else {
          if (cur) lines.push(cur);
          cur = w;
        }
      }
      if (cur) lines.push(cur);
    }
    return lines;
  }

  text(text: string, style: Style, opts: { indent?: number; gap?: number; width?: number } = {}) {
    const x = this.margin + (opts.indent ?? 0);
    const width = (opts.width ?? this.contentWidth) - (opts.indent ?? 0);
    const lh = style.size * 1.42;
    for (const line of this.wrap(text, style.size, width, style.bold)) {
      this.ensure(lh);
      if (line) this.drawLine(line, x, style);
      this.y -= lh;
    }
    this.y -= opts.gap ?? 0;
  }

  heading(text: string, level: 1 | 2 | 3 = 2) {
    const size = level === 1 ? 20 : level === 2 ? 13.5 : 11;
    this.ensure(size * 2.4);
    this.y -= level === 1 ? 0 : 8;
    this.text(text, { size, bold: true, color: level === 3 ? COLORS.ink : COLORS.accent }, { gap: level === 1 ? 4 : 2 });
  }

  rule() {
    this.ensure(10);
    this.page.drawLine({ start: { x: this.margin, y: this.y - 3 }, end: { x: A4[0] - this.margin, y: this.y - 3 }, thickness: 0.6, color: COLORS.rule });
    this.y -= 10;
  }

  note(text: string) {
    const size = 9;
    const lines = this.wrap(text, size, this.contentWidth - 16);
    const h = lines.length * size * 1.4 + 12;
    this.ensure(h);
    this.page.drawRectangle({ x: this.margin, y: this.y - h, width: this.contentWidth, height: h, color: COLORS.warnBg, borderColor: COLORS.warn, borderWidth: 0.6 });
    this.y -= 6;
    for (const l of lines) {
      this.drawLine(l, this.margin + 8, { size, color: COLORS.ink });
      this.y -= size * 1.4;
    }
    this.y -= 12;
  }

  bullets(items: string[], size = 10) {
    for (const it of items) {
      const lines = this.wrap(it, size, this.contentWidth - 14);
      const lh = size * 1.4;
      this.ensure(lh);
      this.drawLine('•', this.margin + 2, { size });
      for (const [i, l] of lines.entries()) {
        this.ensure(lh);
        this.drawLine(l, this.margin + 14, { size });
        this.y -= lh;
        void i;
      }
      this.y -= 2;
    }
  }

  /** Table with wrapped cells; header row repeats on a new page. */
  table(headers: string[], rows: string[][], widths: number[], size = 8.5) {
    const total = widths.reduce((a, b) => a + b, 0);
    const scale = this.contentWidth / total;
    const w = widths.map((x) => x * scale);
    const pad = 4;
    const lh = size * 1.35;
    const drawRow = (cells: string[], bold: boolean, fill?: RGB) => {
      const wrapped = cells.map((c, i) => this.wrap(c, size, w[i] - pad * 2, bold));
      const h = Math.max(...wrapped.map((l) => l.length)) * lh + pad * 2;
      if (this.y - h < this.margin + 24) {
        this.newPage();
        if (!bold) drawRow(headers, true, COLORS.panel);
      }
      if (fill) this.page.drawRectangle({ x: this.margin, y: this.y - h, width: this.contentWidth, height: h, color: fill });
      let x = this.margin;
      wrapped.forEach((lines, i) => {
        let ly = this.y - pad;
        for (const l of lines) {
          let cx = x + pad;
          for (const r of this.runs(l, bold)) {
            this.page.drawText(r.text, { x: cx, y: ly - size, size, font: r.font, color: COLORS.ink });
            cx += r.font.widthOfTextAtSize(r.text, size);
          }
          ly -= lh;
        }
        x += w[i];
      });
      this.page.drawLine({ start: { x: this.margin, y: this.y - h }, end: { x: this.margin + this.contentWidth, y: this.y - h }, thickness: 0.4, color: COLORS.rule });
      this.y -= h;
    };
    drawRow(headers, true, COLORS.panel);
    for (const r of rows) drawRow(r, false);
    this.y -= 6;
  }

  async finish(): Promise<Uint8Array> {
    const pages = this.doc.getPages();
    pages.forEach((p, i) => {
      const label = `Page ${i + 1} of ${pages.length}`;
      const size = 8;
      p.drawLine({ start: { x: this.margin, y: 44 }, end: { x: A4[0] - this.margin, y: 44 }, thickness: 0.4, color: COLORS.rule });
      let cx = this.margin;
      for (const r of this.runs(this.footerText)) {
        p.drawText(r.text, { x: cx, y: 30, size, font: r.font, color: COLORS.muted });
        cx += r.font.widthOfTextAtSize(r.text, size);
      }
      let lx = A4[0] - this.margin - this.width(label, size);
      for (const r of this.runs(label)) {
        p.drawText(r.text, { x: lx, y: 30, size, font: r.font, color: COLORS.muted });
        lx += r.font.widthOfTextAtSize(r.text, size);
      }
    });
    return this.doc.save();
  }
}
