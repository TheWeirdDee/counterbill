/**
 * The Counterbill mark: two offset document edges (the bill and the records it is compared with) and one deliberate
 * check stroke. Drawn with currentColor for the documents and the accent token for the check, so it follows the theme.
 * The same geometry is used by src/app/icon.svg and public/brand/*.svg.
 */
export function BrandMark({ size = 30, title }: { size?: number; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title} className="brand-mark">
      <path d="M24 9h25a6 6 0 0 1 6 6v33" stroke="currentColor" strokeWidth="4" strokeLinecap="round" opacity="0.5" />
      <path d="M17 17h24a6 6 0 0 1 6 6v28a6 6 0 0 1-6 6H17a6 6 0 0 1-6-6V23a6 6 0 0 1 6-6Z" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" />
      <path d="M20 40l7 7 13-15" stroke="var(--accent)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
