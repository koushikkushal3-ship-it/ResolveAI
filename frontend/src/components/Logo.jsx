/**
 * ResolveAI mark — "The Intercept".
 *
 * The product's whole thesis in three shapes: a disturbance propagates outward
 * toward the customer (two arcs), and is stopped before it arrives (the bar).
 * The arcs deliberately fall SHORT of the bar — the impact never lands, which
 * is the difference between this product and a support ticket system.
 *
 * Why not a shield, a check, or a lightning bolt: every support tool uses
 * those, and none of them say "before". This says before.
 *
 * Authored rather than generated. A mark that has to survive a 32px favicon
 * needs deliberate geometry — few shapes, thick strokes, generous optical
 * spacing — which is exactly what path-generation tends to get wrong.
 *
 * currentColor throughout, so it inherits the theme instead of shipping two
 * versions.
 */
export function LogoMark({ size = 32, className, title }) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={className}
      fill="none"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : 'true'}
    >
      {/* Outer wave — the incident spreading toward customers. */}
      <path
        d="M6 6 A14 14 0 0 1 6 26"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.45"
      />
      {/* Inner wave, closer to impact. */}
      <path
        d="M13 10 A8 8 0 0 1 13 22"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.75"
      />
      {/* The intercept. Solid, full weight — this is the thing that acts. */}
      <rect x="21.5" y="6" width="4.5" height="20" rx="2.25" fill="currentColor" />
    </svg>
  );
}

/**
 * Mark in its container tile, as it appears in the sidebar and on login.
 * @param {{ size?: number, className?: string }} props
 */
export function LogoTile({ size = 32, className }) {
  return (
    <span
      className={className}
      style={{ width: size, height: size }}
      // The tile is decorative chrome; the wordmark beside it carries the name.
      aria-hidden="true"
    >
      <LogoMark size={Math.round(size * 0.62)} />
    </span>
  );
}
