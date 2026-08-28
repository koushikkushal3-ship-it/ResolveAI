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
import { Link } from 'react-router-dom';
import { Badge, Button, Card, CardBody, CardHeader, cx } from '../ui/index.jsx';
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
 * Metric strip — ONE surface holding every headline number, divided
 * internally rather than split into separate cards.
 *
 * Four bordered cards in a row read as four unrelated things and spend a
 * strong visual signal (a border) on grouping that adjacency already
 * communicates. One panel with hairline dividers reads as a single instrument
 * cluster, which is what it is.
 */
export function StatStrip({ children, testId }) {
  return (
    <div
      data-testid={testId}
      className="panel grid grid-cols-2 divide-x divide-y divide-border/70 overflow-hidden lg:grid-cols-4 lg:divide-y-0"
    >
      {children}
    </div>
  );
}

const ACCENT = {
  'text-high': 'bg-high-fill',
  'text-medium': 'bg-medium-fill',
  'text-low': 'bg-low-fill',
  'text-escalated': 'bg-escalated',
  'text-fg': 'bg-transparent',
};

/**
 * One cell of the strip.
 *
 * The accent bar sits UNDER the number rather than beside the card, so it
 * reads as an underline on the value it qualifies instead of as decoration on
 * a container. Only non-neutral tones draw it — a rail on every cell would
 * make severity meaningless.
 */
export function StatCell({ label, value, hint, icon: Icon, tone = 'text-fg', testId, index = 0 }) {
  return (
    <div
      data-testid={testId}
      className="rise-in relative px-5 py-4"
      // 40ms stagger so the cluster resolves left to right rather than
      // popping. Disabled entirely under prefers-reduced-motion.
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="t-micro text-fg-muted">{label}</p>
        {Icon && <Icon size={14} className={cx('shrink-0 opacity-60', tone)} aria-hidden="true" />}
      </div>

      <p className={cx('t-display mt-3 font-mono', tone)}>{value}</p>

      {tone !== 'text-fg' && (
        <span
          className={cx('mt-2.5 block h-0.5 w-8 rounded-full', ACCENT[tone])}
          aria-hidden="true"
        />
      )}

      {hint && <p className={cx('text-xs text-fg-muted', tone !== 'text-fg' ? 'mt-2' : 'mt-3.5')}>{hint}</p>}
    </div>
  );
}

/** Kept for the analytics page, which still wants discrete tiles. */
export function StatCard(props) {
  return (
    <Card className="p-0">
      <StatCell {...props} />
    </Card>
  );
}

/**
 * Coverage bar — the one chart on the dashboard that earns its place.
 *
 * It answers "is anyone falling through?", which a risk-distribution bar chart
 * does not. Values are printed on the bar rather than hidden behind a hover,
 * because a number you must hover to read is a number nobody reads.
 */
export function CoverageBar({ coverage, testId }) {
  if (!coverage || coverage.total === 0) {
    return (
      <p className="text-sm text-fg-muted">
        No unresolved cases. Everyone affected has been dealt with.
      </p>
    );
  }

  const { total, contacted, high, medium, low } = coverage;
  const pct = Math.round((contacted / total) * 100);
  const segments = [
    { key: 'contacted', label: 'Contacted', count: contacted, cls: 'bg-low-fill' },
    { key: 'high', label: 'High, waiting', count: high.uncontacted, cls: 'bg-high-fill' },
    { key: 'medium', label: 'Medium, waiting', count: medium.uncontacted, cls: 'bg-medium-fill' },
    { key: 'low', label: 'Low, waiting', count: low.uncontacted, cls: 'bg-border-strong' },
  ].filter((s) => s.count > 0);

  return (
    <div data-testid={testId}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="t-label text-fg-muted">
          Outreach coverage
          <span className="ml-2 text-fg">
            <span className="font-mono text-base font-semibold tabular">{contacted}</span>
            <span className="text-fg-muted"> of </span>
            <span className="font-mono text-base font-semibold tabular">{total}</span>
            <span className="text-fg-muted"> affected customers contacted</span>
          </span>
        </p>
        <span className={cx('font-mono text-sm tabular', pct === 100 ? 'text-low' : 'text-fg-muted')}>
          {pct}%
        </span>
      </div>

      <div
        className="mt-2.5 flex h-2.5 w-full overflow-hidden rounded-full bg-surface-2"
        role="img"
        aria-label={`${contacted} of ${total} affected customers contacted. ${high.uncontacted} high risk still waiting.`}
      >
        {segments.map((s) => (
          <div
            key={s.key}
            className={cx('h-full transition-[width] duration-700 ease-out first:rounded-l-full last:rounded-r-full', s.cls)}
            style={{ width: `${(s.count / total) * 100}%` }}
          />
        ))}
      </div>

      {/* A legend with counts, not a colour key you have to decode. */}
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {segments.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5 text-xs">
            <span className={cx('h-2 w-2 rounded-full', s.cls)} aria-hidden="true" />
            <span className="font-mono font-semibold text-fg tabular">{s.count}</span>
            <span className="text-fg-muted">{s.label}</span>
          </li>
        ))}
      </ul>

      {high.uncontacted > 0 && (
        <p className="mt-3 flex items-center gap-1.5 rounded-md border border-high/40 bg-high-soft px-2.5 py-1.5 text-xs text-high">
          <AlertTriangle size={13} aria-hidden="true" />
          {high.uncontacted} high-risk {high.uncontacted === 1 ? 'customer has' : 'customers have'} not
          been contacted yet
        </p>
      )}
    </div>
  );
}

/**
 * One row of the triage queue.
 *
 * Carries everything needed to decide without opening anything: who, how bad,
 * why, what it is worth, what the agent proposes, and whether the customer
 * still knows nothing.
 */
export function TriageRow({ row, onResolve, resolving, testId }) {
  const tone = riskTone(row.riskLevel);
  return (
    <div
      data-testid={testId}
      className="group flex flex-wrap items-center gap-x-5 gap-y-2.5 border-b border-border/60 px-5 py-3.5 transition-colors last:border-0 hover:bg-surface-2/60"
    >
      {/* Score is the scan column — the queue is ranked by it, so it sits
          first, right-aligned as a numeral block rather than centred text. */}
      <div className="w-11 shrink-0">
        <p className={cx('font-mono text-[22px] font-semibold leading-none tabular', tone.text)}>
          {row.riskScore}
        </p>
        <p className="t-micro mt-1 text-fg-muted">
          {row.riskLevel}
        </p>
      </div>

      <div className="min-w-[200px] flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link
            to={`/customers/${row.customerId}`}
            className="target-24 t-label text-fg transition-colors hover:text-brand hover:underline"
          >
            {row.customerName}
          </Link>
          {row.segment === 'PREMIUM' && <Badge tone="text-brand bg-brand/10 border-brand/30">Premium</Badge>}
          {/* Only the exception is badged. Badging both states doubles the
              visual noise to convey one bit. */}
          {!row.contacted ? (
            <Badge tone="text-high bg-high-soft border-high/30">Not contacted</Badge>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-low">
              <CheckCircle2 size={12} aria-hidden="true" />
              Contacted
            </span>
          )}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-fg-muted">{row.topFactors.join(' · ')}</p>
      </div>

      <div className="w-28 shrink-0 text-right">
        <p className="font-mono text-sm text-fg tabular">{formatInr(row.orderAmount)}</p>
        {row.delayHours > 0 && (
          <p className="mt-0.5 text-xs text-fg-muted">{formatDelay(row.delayHours)}</p>
        )}
      </div>

      <div className="w-44 shrink-0">
        {row.proposedAction ? (
          <>
            <p className="t-label text-fg">{humanize(row.proposedAction)}</p>
            <p className="mt-0.5 font-mono text-[10.5px] text-fg-muted">
              {row.proposedCredit > 0 ? `${formatInr(row.proposedCredit)} · ` : ''}
              {row.policyReference}
            </p>
          </>
        ) : (
          <p className="text-xs text-fg-muted">Not analyzed</p>
        )}
      </div>

      {/* Primary weight only for HIGH. If every row's button were primary,
          none of them would be. */}
      <Button
        size="sm"
        variant={row.riskLevel === 'HIGH' ? 'primary' : 'outline'}
        loading={resolving}
        onClick={() => onResolve(row)}
        data-testid="triage-resolve"
        className="w-[84px]"
      >
        {row.proposedAction ? 'Resolve' : 'Analyze'}
      </Button>
    </div>
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
