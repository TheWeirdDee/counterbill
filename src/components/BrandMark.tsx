/**
 * The Counterbill mark: a heavy C (counter) whose opening holds two unequal bars, the billed line and the line it is
 * checked against. Heavy strokes so it holds at 16 to 24 px. Drawn with currentColor plus the accent token, so it follows
 * the theme. The same geometry is used by src/app/icon.svg.
 */
export function BrandMark({ size = 28, title }: { size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title} className="brand-mark">
      <path d="M46.5 14.5A22.5 22.5 0 1 0 46.5 49.5" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
      <path d="M31 27h23" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
      <path d="M31 38.5h12" stroke="var(--accent)" strokeWidth="7" strokeLinecap="round" />
    </svg>
  );
}
