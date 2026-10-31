/**
 * Counterbill has no seed data: sample investigations are created fresh, per visitor, from the labelled fixtures.
 * This command validates that the fixtures parse into citable spans so a broken fixture is caught before a demo.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseDocument, splitIntoSpans } from '../src/docs/parse';
import { DEMO_CASES } from '../src/server/demo';

let spans = 0;
let docs = 0;
for (const d of DEMO_CASES) {
  for (const f of [...d.initial.map((x) => x.file), d.concernFile, ...d.steps.map((s) => s.doc.file)]) {
    const buf = fs.readFileSync(path.resolve('fixtures', d.folder, f));
    const res = await parseDocument(buf, f);
    if (res.status !== 'ready') throw new Error(`Fixture ${d.folder}/${f} did not parse: ${res.error ?? res.hint}`);
    const n = res.pages.reduce((a, p) => a + splitIntoSpans(p.text).length, 0);
    spans += n;
    docs++;
    console.log(`${d.slug}/${f}: ${n} citable spans`);
  }
}
console.log(`\nOK: ${docs} fixture documents, ${spans} spans. No database rows are seeded; samples are created per visitor.`);
