'use client';

import { useEffect, useState } from 'react';

interface Group {
  title: string;
  items: { id: string; label: string }[];
}

/** Section navigation for /docs: sticky list on desktop, a collapsible block on small screens. Highlights the section being read. */
export function DocsNav({ groups }: { groups: Group[] }) {
  const [active, setActive] = useState<string>('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const ids = groups.flatMap((g) => g.items.map((i) => i.id));
    const els = ids.map((id) => document.getElementById(id)).filter((e): e is HTMLElement => !!e);
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: '-96px 0px -65% 0px', threshold: 0 },
    );
    els.forEach((e) => io.observe(e));
    const fromHash = () => setActive(window.location.hash.slice(1));
    window.addEventListener('hashchange', fromHash);
    return () => {
      io.disconnect();
      window.removeEventListener('hashchange', fromHash);
    };
  }, [groups]);

  return (
    <nav className="docs-nav" aria-label="Documentation sections">
      <button type="button" className="docs-nav-toggle" aria-expanded={open} aria-controls="docs-nav-list" onClick={() => setOpen((o) => !o)}>
        On this page
        <span className="chev" aria-hidden="true" />
      </button>
      <div id="docs-nav-list" className={`docs-nav-list${open ? ' open' : ''}`}>
        {groups.map((g) => (
          <div key={g.title}>
            <h2>{g.title}</h2>
            {g.items.map((i) => (
              <a key={i.id} href={`#${i.id}`} aria-current={active === i.id ? 'true' : undefined} onClick={() => setOpen(false)}>
                {i.label}
              </a>
            ))}
          </div>
        ))}
      </div>
    </nav>
  );
}
