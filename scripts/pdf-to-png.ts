/** Dev helper: render each page of a PDF to PNG for visual inspection. usage: tsx scripts/pdf-to-png.ts in.pdf outPrefix */
import fs from 'node:fs';
import { getDocumentProxy, renderPageAsImage, extractText } from 'unpdf';

const [, , input, prefix] = process.argv;
const buf = new Uint8Array(fs.readFileSync(input));
const pdf = await getDocumentProxy(buf);
const { text } = await extractText(pdf, { mergePages: false });
fs.writeFileSync(`${prefix}.txt`, (text as string[]).map((t, i) => `--- page ${i + 1} ---\n${t}`).join('\n'));
for (let i = 1; i <= pdf.numPages; i++) {
  const img = await renderPageAsImage(new Uint8Array(fs.readFileSync(input)), i, { canvasImport: () => import('@napi-rs/canvas'), scale: 1.4 });
  fs.writeFileSync(`${prefix}-${i}.png`, Buffer.from(img));
}
console.log(`pages: ${pdf.numPages}`);
