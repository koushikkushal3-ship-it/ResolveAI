import { AlertTriangle, Inbox, Loader2, RefreshCw, X } from 'lucide-react';

/**
 * UI primitives.
 *
 * One module because each is a handful of lines and they are always imported
 * together. Every interactive element keeps its focus ring — the outline is
 * defined once in index.css and is never removed here.
 */

const cx = (...parts) => parts.filter(Boolean).join(' ');

// --- Button ------------------------------------------------------------------
const BUTTON_VARIANTS = {
  primary: 'bg-brand-fill text-on-brand hover:brightness-110 border-transparent',
  secondary: 'bg-surface-2 text-fg hover:bg-surface-3 border-border',
  ghost: 'bg-transparent text-fg-muted hover:text-fg hover:bg-surface-2 border-transparent',
  danger: 'bg-high-fill text-white hover:brightness-110 border-transparent',
  outline: 'bg-transparent text-fg border-border-strong hover:bg-surface-2',
};

/* Compact by default. 28/32/36px with 13px labels — a 40px+ button with 16px
   text reads consumer, not tool. */
const BUTTON_SIZES = {
  sm: 'h-7 px-2.5 text-[12px] gap-1.5 rounded-[5px]',
  md: 'h-8 px-3 text-[13px] gap-1.5 rounded-md',
  lg: 'h-9 px-3.5 text-[13px] gap-2 rounded-md',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className,
  children,
  ...props
}) {
  return (
    <button
      // Disabled while loading, so a slow action cannot be double-submitted.
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex items-center justify-center border font-medium whitespace-nowrap',
        // 100ms: fast enough to feel instant, slow enough to read as a state
        // change rather than a flicker.
        'transition-[background-color,border-color,filter] duration-100 cursor-pointer',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className
      )}
      {...props}
    >
      {loading && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}

// --- Card --------------------------------------------------------------------

/**
 * @param {object} props
 * @param {boolean} [props.interactive] Adds a hover lift. Only for cards that
 *   are genuinely clickable — a hover state on static content is a lie.
 */
export function Card({ className, interactive = false, children, ...props }) {
  return (
    <div
      className={cx(
        'overflow-hidden rounded-lg border border-border bg-surface',
        interactive &&
          'transition-[border-color,background-color] duration-100 hover:border-border-strong',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, action, className }) {
  return (
    <div
      className={cx(
        'flex items-start justify-between gap-4 border-b border-border bg-surface-2/40 px-4 py-3',
        className
      )}
    >
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold tracking-tight text-fg">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-fg-muted">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export const CardBody = ({ className, children }) => (
  <div className={cx('p-4', className)}>{children}</div>
);

/** Page heading. One place so every screen shares the same rhythm. */
export function PageHeader({ title, subtitle, action, eyebrow }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-1 text-xs font-medium uppercase tracking-[0.14em] text-brand">{eyebrow}</p>
        )}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-fg-muted">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

// --- Badge -------------------------------------------------------------------
export function Badge({ tone = 'text-fg-muted bg-surface-2 border-border', icon: Icon, children, className }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-[5px] border px-1.5 py-px text-[11px] font-medium whitespace-nowrap',
        tone,
        className
      )}
    >
      {/* Decorative: the label beside it already carries the meaning. */}
      {Icon && <Icon size={12} aria-hidden="true" />}
      {children}
    </span>
  );
}

// --- States ------------------------------------------------------------------

/** Skeleton, sized by the caller so it reserves the real layout and avoids CLS. */
export const Skeleton = ({ className }) => (
  <div className={cx('animate-pulse rounded bg-surface-2', className)} aria-hidden="true" />
);

export function LoadingState({ label = 'Loading…', rows = 3 }) {
  return (
    <div className="p-4 space-y-3" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

/**
 * Error state. Always offers a way forward — a dead end with no retry is the
 * thing that makes a demo look broken rather than merely slow.
 */
export function ErrorState({ message, onRetry, className }) {
  return (
    <div className={cx('p-6 text-center', className)} role="alert">
      <AlertTriangle size={22} className="mx-auto text-high" aria-hidden="true" />
      <p className="mt-2 text-sm text-fg">{message ?? 'Something went wrong.'}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>
          <RefreshCw size={14} aria-hidden="true" />
          Try again
        </Button>
      )}
    </div>
  );
}

export function EmptyState({ title, description, action, icon: Icon = Inbox }) {
  return (
    <div className="p-8 text-center">
      <Icon size={26} className="mx-auto text-fg-muted" aria-hidden="true" />
      <p className="mt-3 text-sm font-medium text-fg">{title}</p>
      {description && <p className="mt-1 text-sm text-fg-muted max-w-sm mx-auto">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// --- Form --------------------------------------------------------------------

/**
 * Labelled field.
 *
 * The label is always visible — a placeholder disappears the moment someone
 * types, which is exactly when they need it. Errors are linked with
 * aria-describedby and aria-invalid so a screen reader announces them.
 */
export function Field({ label, htmlFor, error, hint, required, children }) {
  const errorId = error ? `${htmlFor}-error` : undefined;
  const hintId = hint ? `${htmlFor}-hint` : undefined;
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-fg">
        {label}
        {required && (
          <span className="text-high ml-0.5" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children({ id: htmlFor, describedBy: [hintId, errorId].filter(Boolean).join(' ') || undefined, invalid: Boolean(error) })}
      {hint && !error && (
        <p id={hintId} className="text-xs text-fg-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs text-high" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/* border-input, not border: an input edge is a meaningful UI boundary and
   must clear 3:1 (WCAG 1.4.11), unlike a decorative panel divider. */
export const inputClass =
  'w-full h-8 rounded-md border border-border-input bg-surface px-2.5 text-[13px] text-fg ' +
  'placeholder:text-fg-muted/70 transition-colors duration-100 ' +
  'hover:border-fg-muted/60 aria-[invalid=true]:border-high';

export function Input({ describedBy, invalid, className, ...props }) {
  return (
    <input
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      className={cx(inputClass, className)}
      {...props}
    />
  );
}

export function Select({ describedBy, invalid, className, children, ...props }) {
  return (
    <select
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      className={cx(inputClass, 'cursor-pointer', className)}
      {...props}
    >
      {children}
    </select>
  );
}

export function Textarea({ describedBy, invalid, className, rows = 4, ...props }) {
  return (
    <textarea
      rows={rows}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      className={cx(inputClass, 'h-auto py-2 resize-y', className)}
      {...props}
    />
  );
}

// --- Modal -------------------------------------------------------------------

/**
 * Modal. Escape closes it, the backdrop closes it, and focus moves to the
 * dialog on open — a modal you cannot leave from the keyboard is a trap.
 */
export function Modal({ open, onClose, title, children, footer }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onKeyDown={(e) => e.key === 'Escape' && onClose?.()}
    >
      <button
        type="button"
        className="absolute inset-0 bg-[var(--rai-scrim)] cursor-default"
        aria-label="Close dialog"
        onClick={onClose}
      />
      <Card
        className="relative w-full max-w-lg max-h-[85vh] overflow-y-auto"
        // eslint-disable-next-line jsx-a11y/no-autofocus
        autoFocus
        tabIndex={-1}
      >
        <CardHeader
          title={title}
          action={
            <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
              <X size={16} aria-hidden="true" />
            </Button>
          }
        />
        <CardBody>{children}</CardBody>
        {footer && <div className="flex justify-end gap-2 px-4 py-3 border-t border-border">{footer}</div>}
      </Card>
    </div>
  );
}

// --- Table -------------------------------------------------------------------

/**
 * Table shell. The horizontal scroll lives on this wrapper, never on the page —
 * a body that scrolls sideways on mobile is the most common responsive failure.
 */
export const TableWrap = ({ children, className }) => (
  <div className={cx('w-full overflow-x-auto', className)}>
    <table className="w-full text-sm border-collapse">{children}</table>
  </div>
);

/**
 * Sticky header: a 17-row affected-customer table scrolls the column labels
 * away exactly when the operator needs them most.
 */
export const Th = ({ children, className, ...props }) => (
  <th
    scope="col"
    className={cx(
      'text-left text-[11px] font-medium text-fg-muted',
      'sticky top-0 z-10 whitespace-nowrap border-b border-border bg-surface px-3 py-2 backdrop-blur',
      className
    )}
    {...props}
  >
    {children}
  </th>
);

export const Td = ({ children, className, ...props }) => (
  <td className={cx('border-b border-border px-3 py-2 align-middle text-[13px]', className)} {...props}>
    {children}
  </td>
);

export { cx };
