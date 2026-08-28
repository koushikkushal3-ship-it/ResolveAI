import {
  AlertTriangle,
  BadgeCheck,
  Bot,
  CheckCircle2,
  CircleDashed,
  FileText,
  MessageSquare,
  ShieldAlert,
  ShieldCheck,
  User,
  XCircle,
} from 'lucide-react';
import { Badge, Card, CardBody, CardHeader, cx } from '../ui/index.jsx';
import { formatDelay, formatInr, formatRelative, humanize, riskTone, statusTone } from '../../utils/format.js';

/**
 * Domain components — the parts that carry ResolveAI's actual meaning:
 * risk, guardrails, decision evidence and customer communication.
 *
 * Every status here pairs colour with an icon AND a text label. Colour alone
 * fails for colour-blind users and disappears entirely in a printed or
 * screenshotted demo.
 */

/** Risk badge: score + level, never colour alone. */
export function RiskBadge({ score, level, size = 'md', testId }) {
  const tone = riskTone(level);
  const Icon = level === 'HIGH' ? AlertTriangle : level === 'MEDIUM' ? CircleDashed : CheckCircle2;
  return (
    <span
      data-testid={testId}
      className={cx(
        'inline-flex items-center gap-1.5 rounded border font-semibold whitespace-nowrap',
        tone.text,
        tone.bg,
        tone.border,
        size === 'lg' ? 'px-2.5 py-1 text-sm' : 'px-2 py-0.5 text-xs'
      )}
    >
      <Icon size={size === 'lg' ? 14 : 12} aria-hidden="true" />
      <span className="font-mono tabular">{score}</span>
      <span className="opacity-70">/100</span>
      <span>{level}</span>
    </span>
  );
}

/**
 * Risk meter with the contributing factors listed.
 *
 * The factors matter more than the number: "91" is not actionable, but
 * "premium customer, 72h delay, previous complaint" tells an agent why this
 * person is about to churn.
 */
export function RiskMeter({ risk, testId }) {
  if (!risk) return null;
  const tone = riskTone(risk.level);
  return (
    <div data-testid={testId}>
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className={cx('font-mono text-3xl font-semibold tabular', tone.text)}>{risk.score}</span>
          <span className="text-sm text-fg-muted">/ 100</span>
        </div>
        <RiskBadge score={risk.score} level={risk.level} />
      </div>

      {/* Threshold ticks make the bands legible: a bar alone says "quite full",
          it does not say "past the HIGH line". */}
      <div className="relative mt-3">
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-surface-2"
          role="meter"
          aria-valuenow={risk.score}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Customer experience risk ${risk.score} out of 100, ${risk.level}`}
        >
          <div
            className={cx('h-full rounded-full transition-[width] duration-700 ease-out', tone.fill)}
            style={{ width: `${risk.score}%` }}
          />
        </div>
        {[40, 70].map((t) => (
          <span
            key={t}
            className="absolute top-0 h-2 w-px bg-bg/70"
            style={{ left: `${t}%` }}
            aria-hidden="true"
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] uppercase tracking-wider text-fg-muted">
        <span>Low</span>
        <span>Medium 40</span>
        <span>High 70</span>
      </div>

      {risk.factors?.length > 0 && (
        <ul className="mt-3 space-y-0.5 border-t border-border pt-3">
          {risk.factors.map((f) => (
            <li
              key={f.key}
              className="flex items-center justify-between gap-3 rounded px-1.5 py-1 text-sm transition-colors hover:bg-surface-2"
            >
              <span className="text-fg-muted">{f.label}</span>
              <span className={cx('font-mono text-xs tabular', tone.text)}>+{f.points}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Guardrail verdict — makes the safety layer visible.
 *
 * This is the component that shows the AI did not get to decide. It renders the
 * backend's actual verdict; it never re-derives one, because a frontend that
 * computed its own answer could disagree with what really happened.
 */
export function GuardrailStatus({ verdict, amount, autoLimit = 500, testId }) {
  if (!verdict) return null;

  const blocked = verdict.requiresApproval || verdict.escalate;
  const Icon = blocked ? ShieldAlert : ShieldCheck;
  const tone = blocked
    ? verdict.escalate
      ? 'text-escalated bg-escalated-soft border-escalated/40'
      : 'text-medium bg-medium-soft border-medium/40'
    : 'text-low bg-low-soft border-low/40';

  const headline = verdict.escalate
    ? 'ESCALATED TO HUMAN'
    : verdict.requiresApproval
      ? 'HUMAN APPROVAL REQUIRED'
      : 'SAFE TO EXECUTE';

  return (
    <div data-testid={testId} className={cx('rounded-lg border p-3', tone)}>
      <div className="flex items-center gap-2">
        <Icon size={16} aria-hidden="true" />
        <span className="text-sm font-semibold tracking-wide">{headline}</span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        <dt className="text-fg-muted">Proposed</dt>
        <dd className="text-right font-mono text-fg tabular">{formatInr(amount ?? 0)}</dd>
        <dt className="text-fg-muted">Auto-approve limit</dt>
        <dd className="text-right font-mono text-fg tabular">{formatInr(autoLimit)}</dd>
      </dl>

      {verdict.explanations?.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-current/20 pt-2">
          {verdict.explanations.map((reason) => (
            <li key={reason} className="flex items-start gap-1.5 text-xs">
              <XCircle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{reason}</span>
            </li>
          ))}
        </ul>
      )}

      {!blocked && (
        <p className="mt-2 flex items-center gap-1.5 border-t border-current/20 pt-2 text-xs">
          <BadgeCheck size={12} aria-hidden="true" />
          Within policy limits, confidence above threshold, policy matched
        </p>
      )}
    </div>
  );
}

/** One step of the decision trail. */
function TraceStep({ icon: Icon, label, value, detail, done = true }) {
  return (
    <li className="flex gap-3">
      <div className="flex flex-col items-center">
        <span
          className={cx(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border',
            done ? 'border-brand/40 bg-brand/10 text-brand' : 'border-border bg-surface-2 text-fg-muted'
          )}
        >
          <Icon size={12} aria-hidden="true" />
        </span>
        <span className="mt-1 w-px flex-1 bg-border last:hidden" />
      </div>
      <div className="min-w-0 pb-4">
        <p className="text-xs uppercase tracking-wide text-fg-muted">{label}</p>
        <p className="text-sm text-fg wrap-anywhere">{value}</p>
        {detail && <p className="mt-0.5 text-xs text-fg-muted wrap-anywhere">{detail}</p>}
      </div>
    </li>
  );
}

/**
 * Decision trace: the evidence behind a recommendation.
 *
 * Shows conclusions only — incident, context, risk, policy, decision. The
 * model's internal reasoning is never requested, stored, or displayed; the
 * one-sentence rationale is a conclusion, not a thought process.
 */
export function DecisionTrace({ recommendation, risk, incident, customer, testId }) {
  if (!recommendation) return null;
  const provider = recommendation.source ?? (recommendation.aiGenerated ? 'AI' : 'FALLBACK');
  const degraded = !recommendation.aiGenerated;

  return (
    <ol data-testid={testId} className="space-y-0">
      <TraceStep
        icon={AlertTriangle}
        label="Incident"
        value={incident ? incident.title : humanize(recommendation.incidentSummary)}
        detail={incident ? `${humanize(incident.type)} · ${incident.severity}` : null}
      />
      <TraceStep
        icon={User}
        label="Customer context"
        value={customer ? `${customer.name} · ${humanize(customer.segment)}` : '—'}
        detail={customer ? `Lifetime value ${formatInr(customer.lifetime_value)}` : null}
      />
      <TraceStep
        icon={AlertTriangle}
        label="CX risk (deterministic)"
        value={risk ? `${risk.score}/100 ${risk.level}` : '—'}
        detail={risk?.factors?.map((f) => f.label).join(' · ')}
      />
      <TraceStep
        icon={FileText}
        label="Policy retrieved"
        value={recommendation.policyReference ?? 'None'}
        detail={
          recommendation.policiesConsidered?.length
            ? `Considered: ${recommendation.policiesConsidered.map((p) => p.slug).join(', ')}`
            : null
        }
      />
      <TraceStep
        icon={Bot}
        label={degraded ? 'Deterministic recommendation' : `Recommendation (${provider.toLowerCase()})`}
        value={humanize(recommendation.recommendedAction)}
        detail={recommendation.rationale}
      />
    </ol>
  );
}

/** Policy card — the retrieved governing document. */
export function PolicyCard({ policy, reference, testId }) {
  if (!policy && !reference) return null;
  return (
    <div data-testid={testId} className="rounded-lg border border-border bg-surface-2 p-3">
      <div className="flex items-center gap-2">
        <FileText size={14} className="text-brand" aria-hidden="true" />
        <span className="font-mono text-xs text-brand">{policy?.slug ?? reference}</span>
        {policy?.version && <Badge>{policy.version}</Badge>}
      </div>
      {policy?.title && <p className="mt-1.5 text-sm font-medium text-fg">{policy.title}</p>}
      {policy?.content && (
        <p className="mt-1 text-xs leading-relaxed text-fg-muted line-clamp-4">{policy.content}</p>
      )}
    </div>
  );
}

/**
 * Customer-facing message preview.
 *
 * Styled deliberately unlike the internal panels around it — this is what the
 * customer receives, and an operator must never confuse the two.
 */
export function NotificationPreview({ message, channel, customerName, sent = false, testId }) {
  if (!message) return null;
  return (
    <div data-testid={testId} className="rounded-lg border border-brand/30 bg-brand/5 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-brand">
          <MessageSquare size={13} aria-hidden="true" />
          Customer message{channel ? ` · ${humanize(channel)}` : ''}
        </span>
        {sent && (
          <Badge tone="text-low bg-low-soft border-low/40" icon={CheckCircle2}>
            Sent
          </Badge>
        )}
      </div>
      <p className="mt-2.5 text-sm leading-relaxed text-fg whitespace-pre-line">{message}</p>
      {/* Only claim delivery once it actually happened. Before execution this
          is a preview, and saying "delivered" would be a false success state. */}
      {customerName && (
        <p className="mt-2 border-t border-brand/20 pt-2 text-xs text-fg-muted">
          {sent
            ? `Delivered to ${customerName} without them contacting support`
            : `Preview — not yet sent to ${customerName}`}
        </p>
      )}
    </div>
  );
}

/**
 * KPI tile.
 *
 * The accent rail encodes severity so the row can be scanned in one pass
 * without reading a single label — which is the whole point of a KPI strip in
 * an operations console.
 */
const ACCENT = {
  'text-high': 'bg-high-fill',
  'text-medium': 'bg-medium-fill',
  'text-low': 'bg-low-fill',
  'text-escalated': 'bg-escalated',
  'text-fg': 'bg-border-strong',
};

export function StatCard({ label, value, hint, icon: Icon, tone = 'text-fg', testId, index = 0 }) {
  return (
    <Card
      data-testid={testId}
      interactive
      className="rise-in relative p-4 pl-5"
      // Staggered by 40ms so the strip resolves left to right instead of
      // appearing all at once. Disabled entirely under reduced-motion.
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <span
        className={cx('absolute inset-y-0 left-0 w-1', ACCENT[tone] ?? ACCENT['text-fg'])}
        aria-hidden="true"
      />
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-fg-muted">{label}</p>
        {Icon && <Icon size={15} className={cx('shrink-0 opacity-70', tone)} aria-hidden="true" />}
      </div>
      <p className={cx('mt-2.5 font-mono text-[28px] font-semibold leading-none tabular', tone)}>
        {value}
      </p>
      {hint && <p className="mt-1.5 text-xs text-fg-muted">{hint}</p>}
    </Card>
  );
}

/** Compact action row for the approval queue and activity feeds. */
export function ActionRow({ action, right }) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border/60 last:border-0">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-fg">{humanize(action.action_type)}</span>
          <Badge tone={statusTone(action.status)}>{action.status}</Badge>
          {action.ai_generated ? (
            <Badge icon={Bot}>AI</Badge>
          ) : (
            <Badge icon={User}>Rule</Badge>
          )}
        </div>
        <p className="mt-0.5 text-xs text-fg-muted truncate">
          {action.customerName ?? action.customer?.name} · {formatRelative(action.created_at)}
          {action.policy_reference ? ` · ${action.policy_reference}` : ''}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {Number(action.amount) > 0 && (
          <span className="font-mono text-sm text-fg tabular">{formatInr(action.amount)}</span>
        )}
        {right}
      </div>
    </div>
  );
}

/** Incident summary card for lists and the dashboard feed. */
export function IncidentCard({ incident, onClick, testId }) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className="group w-full cursor-pointer border-b border-border/60 px-4 py-3 text-left transition-colors last:border-0 hover:bg-surface-2"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          {/* Pulses only while the incident is genuinely unresolved. */}
          <span
            className={cx(
              'mt-1.5 shrink-0',
              ['OPEN', 'INVESTIGATING', 'MITIGATING'].includes(incident.status)
                ? 'pulse-dot bg-high'
                : 'h-[7px] w-[7px] rounded-full bg-border-strong'
            )}
            aria-hidden="true"
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-fg transition-colors group-hover:text-brand">
              {incident.title}
            </p>
            <p className="mt-0.5 text-xs text-fg-muted">
              {humanize(incident.type)} · {formatRelative(incident.started_at)}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge tone={statusTone(incident.status)}>{incident.status}</Badge>
          {incident.affectedCustomers > 0 && (
            <span className="text-xs text-fg-muted">
              <span className="font-mono tabular">{incident.affectedCustomers}</span> affected
              {incident.highRiskCustomers > 0 && (
                <>
                  {' · '}
                  <span className="font-mono tabular text-high">{incident.highRiskCustomers}</span> high
                </>
              )}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

/** Order summary line for Customer 360. */
export function OrderRow({ order }) {
  const delayed = order.delayHours > 0 || order.status === 'DELAYED';
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/60 px-4 py-2.5 last:border-0">
      <div className="min-w-0">
        <p className="truncate text-sm text-fg">{order.product_name}</p>
        <p className="mt-0.5 font-mono text-xs text-fg-muted">{order.order_number}</p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="font-mono text-sm text-fg tabular">{formatInr(order.amount)}</span>
        <Badge tone={statusTone(order.status)}>{order.status}</Badge>
        {delayed && <span className="text-xs text-high">{formatDelay(order.delayHours)}</span>}
      </div>
    </div>
  );
}

export { CardHeader, CardBody, Card };
