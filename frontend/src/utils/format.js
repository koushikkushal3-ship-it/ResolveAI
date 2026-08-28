/**
 * Formatting helpers.
 *
 * Intl is native and locale-aware, so there is no date library here. One
 * `en-IN` currency formatter, reused, because constructing Intl.NumberFormat
 * per cell is measurably slow in a long table.
 */

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

const inrCompact = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** @param {number|string|null|undefined} value */
export const formatInr = (value) =>
  value === null || value === undefined || value === '' ? '—' : inr.format(Number(value));

/** Compact form for KPI tiles, where ₹2,10,000 would wrap. */
export const formatInrCompact = (value) =>
  value === null || value === undefined ? '—' : inrCompact.format(Number(value));

export const formatNumber = (value) =>
  value === null || value === undefined ? '—' : new Intl.NumberFormat('en-IN').format(Number(value));

const dateTime = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const dateOnly = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export const formatDateTime = (iso) => (iso ? dateTime.format(new Date(iso)) : '—');
export const formatDate = (iso) => (iso ? dateOnly.format(new Date(iso)) : '—');

/**
 * Relative time, coarse on purpose. "3 hours ago" is what an operator needs;
 * "3 hours 12 minutes ago" is noise in a feed.
 * @param {string|null} iso
 */
export function formatRelative(iso) {
  if (!iso) return '—';
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}

/** 72 -> "3d 0h", so a long delay is readable at a glance. */
export function formatDelay(hours) {
  if (!hours || hours <= 0) return 'On time';
  if (hours < 24) return `${hours}h late`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest ? `${days}d ${rest}h late` : `${days}d late`;
}

/** DELIVERY_DELAY -> "Delivery delay" */
export const humanize = (value) =>
  !value ? '—' : String(value).replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());

export const initials = (name) =>
  String(name ?? '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');

/**
 * Semantic token for a risk level. Returned as full class strings rather than
 * built by interpolation, because Tailwind only emits classes it can see
 * literally in the source.
 */
export const riskTone = (level) =>
  ({
    HIGH: { text: 'text-high', bg: 'bg-high-soft', border: 'border-high/40', fill: 'bg-high-fill' },
    MEDIUM: { text: 'text-medium', bg: 'bg-medium-soft', border: 'border-medium/40', fill: 'bg-medium-fill' },
    LOW: { text: 'text-low', bg: 'bg-low-soft', border: 'border-low/40', fill: 'bg-low-fill' },
  })[level] ?? { text: 'text-fg-muted', bg: 'bg-surface-2', border: 'border-border', fill: 'bg-fg-muted' };

/** Status tone for actions and incidents. */
export const statusTone = (status) =>
  ({
    EXECUTED: 'text-low bg-low-soft border-low/40',
    APPROVED: 'text-low bg-low-soft border-low/40',
    RESOLVED: 'text-low bg-low-soft border-low/40',
    PROPOSED: 'text-medium bg-medium-soft border-medium/40',
    INVESTIGATING: 'text-medium bg-medium-soft border-medium/40',
    MITIGATING: 'text-medium bg-medium-soft border-medium/40',
    OPEN: 'text-high bg-high-soft border-high/40',
    FAILED: 'text-high bg-high-soft border-high/40',
    REJECTED: 'text-fg-muted bg-surface-2 border-border',
    ARCHIVED: 'text-fg-muted bg-surface-2 border-border',
    ESCALATED: 'text-escalated bg-escalated-soft border-escalated/40',
  })[status] ?? 'text-fg-muted bg-surface-2 border-border';
