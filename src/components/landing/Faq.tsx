'use client';

import { useId, useState } from 'react';

export interface FaqItem {
  q: string;
  a: React.ReactNode;
}

/** Accordion: each question is a real button with aria-expanded; the answer height animates with CSS grid rows. */
export function Faq({ items }: { items: FaqItem[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const base = useId();
  return (
    <div className="faq">
      {items.map((it, i) => {
        const isOpen = open === i;
        return (
          <div key={it.q} className="faq-item" data-open={isOpen}>
            <h3>
              <button type="button" id={`${base}-q${i}`} aria-expanded={isOpen} aria-controls={`${base}-a${i}`} onClick={() => setOpen(isOpen ? null : i)}>
                {it.q}
                <span className="chev" aria-hidden="true" />
              </button>
            </h3>
            <div id={`${base}-a${i}`} role="region" aria-labelledby={`${base}-q${i}`} className="faq-panel">
              <div className="faq-inner">
                <div className="answer">{it.a}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
