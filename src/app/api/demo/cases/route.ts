import { NextResponse } from 'next/server';
import { SOURCE_CLASS_LABEL } from '@/domain/schemas';
import { inferenceReadiness } from '@/server/config';
import { DEMO_CASES } from '@/server/demo';
import { route } from '@/server/http';

export const dynamic = 'force-dynamic';

/** Public, secret-free manifest of the sample cases and their disclosures. */
export const GET = route(async () => {
  const r = inferenceReadiness();
  return NextResponse.json({
    readiness: r.ready ? { ready: true, mode: r.mode } : { ready: false, code: r.code, message: r.message },
    cases: DEMO_CASES.map((d) => ({
      slug: d.slug,
      title: d.title,
      summary: d.summary,
      sampleLabel: d.sampleLabel,
      source: d.source,
      publicFacts: d.publicFacts,
      startingEvidence: d.initial.map((x) => ({ name: x.displayName, kind: x.kind, sourceClass: x.sourceClass, label: x.label || SOURCE_CLASS_LABEL[x.sourceClass] })),
      laterEvidence: d.steps.map((s) => ({ id: s.id, title: s.title, description: s.description, sourceClass: s.doc.sourceClass, label: s.doc.label })),
    })),
  });
});
