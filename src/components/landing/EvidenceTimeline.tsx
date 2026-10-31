'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { gsap } from 'gsap';

interface Stage {
  id: string;
  tab: string;
  title: string;
  figure: string;
  figureNote: string;
  points: { text: string; struck?: boolean }[];
  letter: string;
  basis: string;
}

/** Figures are the published Nigerian Shippers’ Council example, as computed by Counterbill’s deterministic arithmetic. */
const STAGES: Stage[] = [
  {
    id: 'records',
    tab: 'Initial records',
    title: 'The invoice and the packing list',
    figure: '₦298,100',
    figureNote: 'against the packing-list estimate',
    points: [
      { text: 'Invoice: 1.10 CBM billed at ₦542,000 per CBM = ₦596,200.' },
      { text: 'Packing list: 0.55 CBM, an estimate rather than a measurement.' },
      { text: '(1.10 − 0.55) × ₦542,000 = ₦298,100. Provisional: an estimate cannot settle the question.' },
    ],
    letter: 'Asks the carrier how 1.10 CBM was determined. Names no refund and makes no allegation.',
    basis: 'Contractual basis: not yet shown.',
  },
  {
    id: 'measurement',
    tab: 'New measurement',
    title: 'A joint survey is added',
    figure: '0.757348 CBM',
    figureNote: 'six surveyed dimension sets, before rounding',
    points: [
      { text: 'The survey measures the six packages. The regulator’s report rounds the total to 0.75 CBM.' },
      { text: 'Each dimension is recorded with the passage it came from, so you can open the source.' },
      { text: 'Counterbill sums the packages itself; the model never does the arithmetic.' },
    ],
    letter: 'Not yet changed: the new fact is recorded and the comparison is being recalculated.',
    basis: 'Contractual basis: still not shown.',
  },
  {
    id: 'comparison',
    tab: 'Updated comparison',
    title: 'The comparison is recalculated',
    figure: '₦189,700',
    figureNote: 'billed ₦596,200 less ₦406,500 at the surveyed 0.75 CBM',
    points: [
      { text: '(1.10 − 0.75) × ₦542,000 = ₦189,700, the difference between the bill and the measurement.' },
      { text: 'The earlier ₦298,100 reading is kept, marked superseded, with the reason it changed.', struck: true },
      { text: 'A difference between a bill and a measurement is not automatically money you are owed.' },
    ],
    letter: 'Drafting is told what changed and why.',
    basis: 'Contractual basis: unresolved. The carrier’s terms were not published.',
  },
  {
    id: 'letter',
    tab: 'Revised complaint',
    title: 'The complaint is revised',
    figure: 'v2',
    figureNote: 'with a plain-language summary of what changed',
    points: [
      { text: 'The draft now cites the survey and the recalculated difference.' },
      { text: 'It asks the carrier for its rating basis and any minimum or rounding rule that applies.' },
      { text: 'If a rate sheet stated a 1.00 CBM minimum, ₦54,200 of the difference would remain unexplained, and the letter would ask rather than allege.' },
    ],
    letter: 'You edit it. Your edits are marked unverified. Counterbill never sends it.',
    basis: 'Arithmetic is settled. Entitlement is not: that depends on terms only the documents can show.',
  },
];

export function EvidenceTimeline({ exampleHref }: { exampleHref: string }) {
  const [i, setI] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const s = STAGES[i];

  function go(n: number, focus = false) {
    setI(n);
    if (focus) tabs.current[n]?.focus();
    if (panel.current && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      gsap.fromTo(panel.current, { opacity: 0.35, y: 8 }, { opacity: 1, y: 0, duration: 0.28, ease: 'power2.out', clearProps: 'opacity,transform' });
    }
  }
  function onKey(e: React.KeyboardEvent, n: number) {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      go((n + 1) % STAGES.length, true);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      go((n - 1 + STAGES.length) % STAGES.length, true);
    } else if (e.key === 'Home') {
      e.preventDefault();
      go(0, true);
    } else if (e.key === 'End') {
      e.preventDefault();
      go(STAGES.length - 1, true);
    }
  }

  return (
    <div className="evidence">
      <div className="evidence-tabs" role="tablist" aria-label="How one new document changes the case">
        {STAGES.map((st, n) => (
          <button
            key={st.id}
            ref={(el) => {
              tabs.current[n] = el;
            }}
            type="button"
            role="tab"
            id={`ev-tab-${st.id}`}
            aria-selected={i === n}
            aria-controls="ev-panel"
            tabIndex={i === n ? 0 : -1}
            onClick={() => go(n)}
            onKeyDown={(e) => onKey(e, n)}
          >
            <span className="n">{n + 1}</span>
            {st.tab}
          </button>
        ))}
      </div>
      <div id="ev-panel" role="tabpanel" aria-labelledby={`ev-tab-${s.id}`} className="evidence-panel" ref={panel}>
        <div className="evidence-main">
          <h3>{s.title}</h3>
          <p className="big">{s.figure}</p>
          <p className="note">{s.figureNote}</p>
          <ul>
            {s.points.map((p) => (
              <li key={p.text} className={p.struck ? 'struck' : undefined}>
                {p.text}
              </li>
            ))}
          </ul>
        </div>
        <div className="evidence-side">
          <div>
            <span className="eyebrow">The complaint</span>
            <p>{s.letter}</p>
          </div>
          <div>
            <span className="eyebrow accent">Arithmetic is not entitlement</span>
            <p>{s.basis}</p>
          </div>
        </div>
      </div>
      <p className="evidence-foot">
        Figures are from a published Nigerian Shippers’ Council report. The invoice and packing list are reconstructed for the example. <Link href={exampleHref}>Explore this example</Link>.
      </p>
    </div>
  );
}
