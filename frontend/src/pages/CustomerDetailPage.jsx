import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Bot, Mail, Phone, Play, ShieldCheck, Sparkles } from 'lucide-react';
import { useApi, useAction } from '../hooks/useApi.js';
import { agentApi, customersApi } from '../services/api.js';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingState,
} from '../components/ui/index.jsx';
import {
  DecisionTrace,
  GuardrailStatus,
  NotificationPreview,
  OrderRow,
  PolicyCard,
  RiskMeter,
} from '../components/domain/index.jsx';
import { formatDateTime, formatInr, formatRelative, humanize, statusTone } from '../utils/format.js';

/**
 * Customer 360 — and the place the whole resolution loop is driven from.
 *
 * Layout puts identity and risk in the left column (who and how bad) and the
 * AI decision in the right (what to do about it). The customer-facing message
 * is styled unlike everything around it so an operator can never mistake
 * internal evidence for what the customer will read.
 */
export default function CustomerDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, loading, error, refetch } = useApi(() => customersApi.get(id), [id]);

  const [recommendation, setRecommendation] = useState(null);
  const [resolved, setResolved] = useState(null);

  const analyze = useAction(agentApi.analyze);
  const resolve = useAction(agentApi.resolve);

  if (loading) {
    return (
      <Card>
        <LoadingState label="Loading customer…" rows={6} />
      </Card>
    );
  }
  if (error) {
    return (
      <Card>
        <ErrorState message={error} onRetry={refetch} />
      </Card>
    );
  }

  const { customer, orders, conversations, actions, currentIncident, risk, history } = data;
  const incidentId = currentIncident?.incident?.id;
  const active = recommendation ?? data.recommendedAction;

  const runAnalyze = async () => {
    if (!incidentId) return;
    const res = await analyze.execute({ customerId: id, incidentId, force: true });
    if (res.ok) setRecommendation(res.data.data);
  };

  const runResolve = async () => {
    if (!incidentId) return;
    const res = await resolve.execute({ customerId: id, incidentId, useCached: true });
    if (res.ok) {
      setResolved(res.data.data);
      refetch();
    }
  };

  const inbound = conversations.filter((c) => !c.is_outbound);
  const outbound = conversations.filter((c) => c.is_outbound);

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
        <ArrowLeft size={15} aria-hidden="true" />
        Back
      </Button>

      {/* --- Identity --- */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{customer.name}</h1>
            <Badge tone={customer.segment === 'PREMIUM' ? 'text-brand bg-brand/10 border-brand/40' : undefined}>
              {customer.segment}
            </Badge>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-fg-muted">
            <span className="inline-flex items-center gap-1.5">
              <Mail size={13} aria-hidden="true" />
              {customer.email}
            </span>
            {customer.phone && (
              <span className="inline-flex items-center gap-1.5">
                <Phone size={13} aria-hidden="true" />
                {customer.phone}
              </span>
            )}
            <span>Prefers {humanize(customer.preferred_channel)}</span>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-wide text-fg-muted">Lifetime value</p>
          <p className="font-mono text-xl font-semibold tabular">{formatInr(customer.lifetime_value)}</p>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-5">
        {/* ---------------- Left: context and risk ---------------- */}
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="CX risk" subtitle="Computed by the backend, not the model" />
            <CardBody>
              <RiskMeter risk={risk} testId="customer-risk-score" />
            </CardBody>
          </Card>

          {currentIncident && (
            <Card>
              <CardHeader title="Current incident" />
              <CardBody className="space-y-2">
                <Link
                  to={`/incidents/${incidentId}`}
                  className="text-sm font-medium text-fg hover:text-brand hover:underline"
                >
                  {currentIncident.incident.title}
                </Link>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={statusTone(currentIncident.incident.status)}>
                    {currentIncident.incident.status}
                  </Badge>
                  <Badge>{humanize(currentIncident.incident.type)}</Badge>
                </div>
                {currentIncident.order && (
                  <p className="text-xs text-fg-muted">
                    Affected order {currentIncident.order.order_number} ·{' '}
                    {formatInr(currentIncident.order.amount)}
                  </p>
                )}
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title="Signals" subtitle="Inputs behind the score" />
            <CardBody>
              <dl className="grid grid-cols-2 gap-y-2 text-sm">
                <dt className="text-fg-muted">Previous complaints</dt>
                <dd className="text-right font-mono tabular">{history.priorComplaintCount}</dd>
                <dt className="text-fg-muted">Latest sentiment</dt>
                <dd
                  className={`text-right ${history.latestSentiment === 'NEGATIVE' ? 'text-high' : 'text-fg'}`}
                >
                  {humanize(history.latestSentiment)}
                </dd>
                <dt className="text-fg-muted">Total orders</dt>
                <dd className="text-right font-mono tabular">{history.totalOrders}</dd>
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Order history" />
            {orders.length ? (
              <div className="max-h-72 overflow-y-auto">
                {orders.map((o) => (
                  <OrderRow key={o.id} order={o} />
                ))}
              </div>
            ) : (
              <EmptyState title="No orders" />
            )}
          </Card>

          <Card>
            <CardHeader title="Conversations" subtitle={`${inbound.length} inbound · ${outbound.length} outreach`} />
            {conversations.length ? (
              <div className="max-h-64 overflow-y-auto">
                {conversations.map((c) => (
                  <div key={c.id} className="border-b border-border/60 px-4 py-2.5 last:border-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <Badge>{humanize(c.channel)}</Badge>
                        {c.is_outbound && <Badge tone="text-brand bg-brand/10 border-brand/40">Outreach</Badge>}
                        {c.is_complaint && <Badge tone="text-high bg-high-soft border-high/40">Complaint</Badge>}
                      </div>
                      <span className="text-xs text-fg-muted">{formatRelative(c.created_at)}</span>
                    </div>
                    {c.summary && <p className="mt-1 text-xs text-fg-muted">{c.summary}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="No conversations" />
            )}
          </Card>
        </div>

        {/* ---------------- Right: AI decision ---------------- */}
        <div className="space-y-4 lg:col-span-3">
          <Card>
            <CardHeader
              title="AI resolution"
              subtitle={
                incidentId
                  ? 'Risk, policy and recommendation for the current incident'
                  : 'No active incident for this customer'
              }
              action={
                incidentId && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={analyze.pending}
                      onClick={runAnalyze}
                      data-testid="analyze-customer"
                    >
                      <Sparkles size={14} aria-hidden="true" />
                      {active ? 'Re-analyze' : 'Analyze'}
                    </Button>
                    {active && !resolved && (
                      <Button
                        size="sm"
                        loading={resolve.pending}
                        onClick={runResolve}
                        data-testid="execute-action"
                      >
                        <Play size={14} aria-hidden="true" />
                        Execute
                      </Button>
                    )}
                  </div>
                )
              }
            />
            <CardBody>
              {!incidentId ? (
                <EmptyState
                  title="Nothing to resolve"
                  description="This customer is not currently affected by an open incident."
                />
              ) : analyze.pending ? (
                <div role="status" aria-live="polite" className="space-y-2 py-4 text-sm text-fg-muted">
                  <p>Retrieving customer context…</p>
                  <p>Calculating CX risk…</p>
                  <p>Retrieving governing policy…</p>
                  <p>Generating recommendation…</p>
                </div>
              ) : analyze.error ? (
                <ErrorState message={analyze.error} onRetry={runAnalyze} />
              ) : !active ? (
                <EmptyState
                  title="Not analyzed yet"
                  description="Run the agent to retrieve the policy and generate a recommendation."
                  icon={Bot}
                  action={
                    <Button size="sm" onClick={runAnalyze} loading={analyze.pending}>
                      <Sparkles size={14} aria-hidden="true" />
                      Analyze this customer
                    </Button>
                  }
                />
              ) : (
                <div className="space-y-4">
                  {!active.aiGenerated && (
                    <div className="rounded-md border border-medium/40 bg-medium-soft px-3 py-2 text-xs text-medium">
                      AI unavailable — this recommendation came from the deterministic policy rules.
                      It requires human approval before anything is issued.
                    </div>
                  )}

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-fg-muted">Recommended action</p>
                      <p className="mt-0.5 text-sm font-medium text-fg" data-testid="ai-recommendation">
                        {humanize(active.recommendedAction)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-fg-muted">Credit</p>
                      <p className="mt-0.5 font-mono text-sm font-medium tabular text-fg">
                        {formatInr(active.creditAmount)}
                      </p>
                    </div>
                  </div>

                  <PolicyCard reference={active.policyReference} testId="policy-reference" />

                  <div>
                    <p className="mb-2 text-xs uppercase tracking-wide text-fg-muted">Decision evidence</p>
                    <DecisionTrace
                      recommendation={active}
                      risk={risk}
                      incident={currentIncident?.incident}
                      customer={customer}
                      testId="decision-trace"
                    />
                  </div>
                </div>
              )}
            </CardBody>
          </Card>

          {/* Guardrail verdict, shown only once the backend has produced one. */}
          {resolved?.verdict && (
            <Card>
              <CardHeader title="Guardrail" subtitle="Enforced server-side, after the model" />
              <CardBody>
                <GuardrailStatus
                  verdict={resolved.verdict}
                  amount={resolved.action?.amount}
                  testId="guardrail-status"
                />
              </CardBody>
            </Card>
          )}

          {resolve.error && (
            <Card>
              <ErrorState message={resolve.error} onRetry={runResolve} />
            </Card>
          )}

          {resolved?.action && (
            <Card>
              <CardHeader
                title="Action"
                subtitle="What the system actually did"
                action={<Badge tone={statusTone(resolved.action.status)}>{resolved.action.status}</Badge>}
              />
              <CardBody className="space-y-3">
                <dl className="grid grid-cols-2 gap-y-2 text-sm">
                  <dt className="text-fg-muted">Type</dt>
                  <dd className="text-right">{humanize(resolved.action.action_type)}</dd>
                  <dt className="text-fg-muted">Amount</dt>
                  <dd className="text-right font-mono tabular">{formatInr(resolved.action.amount)}</dd>
                  <dt className="text-fg-muted">Policy</dt>
                  <dd className="text-right font-mono text-xs">{resolved.action.policy_reference}</dd>
                </dl>

                {resolved.action.status === 'PROPOSED' && (
                  <p className="flex items-center gap-1.5 rounded-md border border-medium/40 bg-medium-soft px-3 py-2 text-xs text-medium">
                    <ShieldCheck size={13} aria-hidden="true" />
                    Queued for supervisor approval — nothing has been issued to the customer yet.
                  </p>
                )}
              </CardBody>
            </Card>
          )}

          {/* Customer-facing message. Only shown as "sent" when it really was. */}
          {(resolved?.notification || active?.customerMessage) && (
            <NotificationPreview
              message={resolved?.action?.customer_message ?? active?.customerMessage}
              channel={resolved?.notification?.channel ?? customer.preferred_channel}
              customerName={customer.name}
              sent={Boolean(resolved?.notification)}
              testId="notification"
            />
          )}

          <Card>
            <CardHeader title="Action history" />
            {actions.length ? (
              <div className="max-h-72 overflow-y-auto">
                {actions.map((a) => (
                  <div key={a.id} className="border-b border-border/60 px-4 py-2.5 last:border-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-fg">{humanize(a.action_type)}</span>
                      <div className="flex items-center gap-2">
                        {Number(a.amount) > 0 && (
                          <span className="font-mono text-xs tabular">{formatInr(a.amount)}</span>
                        )}
                        <Badge tone={statusTone(a.status)}>{a.status}</Badge>
                      </div>
                    </div>
                    <p className="mt-0.5 text-xs text-fg-muted">
                      {a.policy_reference} · {formatDateTime(a.created_at)}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="No actions yet" description="Resolutions for this customer will appear here." />
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
