/**
 * ResolveAI mark — three ascending bars, the last one accented.
 *
 * Taken from the supplied brand reference (viewBox 0 0 120 120; bars at y=18,
 * 46, 74 with widths 52, 76, 96). Geometry is reproduced exactly.
 *
 * It reads as an escalation growing — and the accented bar as the one that
 * gets caught. That maps onto the product without needing explanation, which
 * is why the accent also carries HIGH risk throughout the interface rather
 * than fighting it for attention.
 *
 * currentColor on the first two bars so the mark inherits the theme; the third
 * is fixed to the brand vermilion, which clears 3:1 as a large shape on both
 * the light and dark grounds.
 */
export function LogoMark({ size = 32, className, title, accent = '#ec3013', mono = false }) {
  return (
    <svg
      viewBox="0 0 120 120"
      width={size}
      height={size}
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : 'true'}
    >
      <rect x="12" y="18" width="52" height="16" fill="currentColor" />
      <rect x="12" y="46" width="76" height="16" fill="currentColor" />
      {/* The escalation that gets resolved. */}
      <rect x="12" y="74" width="96" height="16" fill={mono ? 'currentColor' : accent} />
    </svg>
  );
}

/** Mark plus wordmark, for the sidebar and the login screen. */
export function LogoLockup({ size = 26, className }) {
  return (
    <span className={className}>
      <LogoMark size={size} />
      <span className="font-heading text-[15px] font-semibold tracking-[-0.02em]">ResolveAI</span>
    </span>
  );
}
