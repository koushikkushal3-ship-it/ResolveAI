import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Play, Send, Sparkles } from 'lucide-react';
import { useApi, useAction } from '../hooks/useApi.js';
import { agentApi, incidentsApi } from '../services/api.js';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Select,
} from '../components/ui/index.jsx';
import {
  DecisionTrace,
  GuardrailStatus,
  NotificationPreview,
  PolicyCard,
  RiskMeter,
} from '../components/domain/index.jsx';
import { formatInr, humanize, statusTone } from '../utils/format.js';

/**
 * Agent workbench.
 *
 * Pick an incident, pick an affected customer, and walk the decision: context,
 * risk, policy, recommendation, guardrail, action. Analyze changes nothing;
 * only Execute can.
 */
export default function AgentPage() {
  const [incidentId, setIncidentId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [recommendation, setRecommendation] = useState(null);
  const [resolved, setResolved] = useState(null);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState(null);

  const incidents = useApi(() => incidentsApi.list({ status: 'OPEN', limit: 20 }), []);
  const detail = useApi(() => incidentsApi.get(incidentId), [incidentId], { enabled: Boolean(incidentId) });
  const context = useApi(
    () => agentApi.context({ customerId, incidentId }),
    [customerId, incidentId],
    { enabled: Boolean(customerId && incidentId) }
  );

  const analyze = useAction(agentApi.analyze);
  const resolve = useAction(agentApi.resolve);
  const chat = useAction(agentApi.chat);

  const pickIncident = (id) => {
    setIncidentId(id);
    setCustomerId('');
    setRecommendation(null);
    setResolved(null);
  };

  const pickCustomer = (id) => {
    setCustomerId(id);
    setRecommendation(null);
    setResolved(null);
  };

  const runAnalyze = async () => {
    const res = await analyze.execute({ customerId, incidentId, force: true });
    if (res.ok) setRecommendation(res.data.data);
  };

  const runResolve = async () => {
    const res = await resolve.execute({ customerId, incidentId, useCached: true });
    if (res.ok) setResolved(res.data.data);
  };

  const ask = async (e) => {
    e.preventDefault();
    if (!question.trim() || !customerId) return;
    const res = await chat.execute({ customerId, incidentId: incidentId || undefined, question });
    if (res.ok) setAnswer(res.data.data);
  };

  const active = recommendation ?? context.data?.cachedRecommendation;
  const selected = detail.data?.affectedCustomers?.find((a) => a.customerId === customerId);

  return (
    <div className="space-y-4">
      <header>
        <p className="mb-1 text-xs font-medium uppercase tracking-[0.14em] text-brand">Decide</p>
        <h1 className="text-2xl font-semibold tracking-tight">AI Agent</h1>
        <p className="mt-0.5 max-w-2xl text-sm text-fg-muted">
          The agent proposes. The backend decides. Every recommendation is validated, checked against
          policy limits, and authorized server-side before anything reaches a customer.
        </p>
      </header>

      <Card>
        <CardHeader title="Select a case" />
        <CardBody>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Incident" htmlFor="agent-incident">
              {(a) => (
                <Select
                  {...a}
                  value={incidentId}
                  onChange={(e) => pickIncident(e.target.value)}
                  disabled={incidents.loading}
                >
                  <option value="">
                    {incidents.loading ? 'Loading…' : 'Choose an open incident'}
                  </option>
                  {incidents.data?.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.title} ({i.affectedCustomers} affected)
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field label="Affected customer" htmlFor="agent-customer">
              {(a) => (
                <Select
                  {...a}
                  value={customerId}
                  onChange={(e) => pickCustomer(e.target.value)}
                  disabled={!incidentId || detail.loading}
                >
                  <option value="">
                    {!incidentId ? 'Select an incident first' : detail.loading ? 'Loading…' : 'Choose a customer'}
                  </option>
                  {detail.data?.affectedCustomers?.map((c) => (
                    <option key={c.customerId} value={c.customerId}>
                      {c.customer.name} — risk {c.riskScore} {c.riskLevel}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>

          {!incidents.loading && !incidents.data?.length && (
            <p className="mt-3 text-sm text-fg-muted">
              No open incidents.{' '}
              <Link to="/simulator" className="text-brand hover:underline">
                Run the simulator
              </Link>{' '}
              to create one.
            </p>
          )}
        </CardBody>
      </Card>

      {!customerId ? (
        <Card>
          <EmptyState
            title="No case selected"
            description="Choose an incident and an affected customer to see the decision the agent would make."
            icon={Bot}
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-5">
          <div className="space-y-4 lg:col-span-2">
            <Card>
              <CardHeader title="Customer context" />
              <CardBody>
                {context.loading ? (
                  <LoadingState rows={3} />
                ) : context.error ? (
                  <ErrorState message={context.error} onRetry={context.refetch} />
                ) : (
                  <div className="space-y-3">
                    <div>
                      <Link
                        to={`/customers/${customerId}`}
                        className="text-sm font-medium text-fg hover:text-brand hover:underline"
                      >
                        {context.data?.customer?.name ?? '—'}
                      </Link>
                      <p className="text-xs text-fg-muted">
                        {context.data?.customer?.segment} ·{' '}
                        {formatInr(context.data?.customer?.lifetime_value)}
                      </p>
                    </div>
                    {context.data?.order && (
                      <dl className="grid grid-cols-2 gap-y-1.5 border-t border-border pt-3 text-sm">
                        <dt className="text-fg-muted">Order</dt>
                        <dd className="text-right font-mono text-xs">{context.data?.order?.order_number}</dd>
                        <dt className="text-fg-muted">Value</dt>
                        <dd className="text-right font-mono tabular">{formatInr(context.data?.order?.amount)}</dd>
                        <dt className="text-fg-muted">Delay</dt>
                        <dd className="text-right font-mono tabular">{context.data?.delayHours}h</dd>
                      </dl>
                    )}
                  </div>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="CX risk" subtitle="Deterministic — no AI involved" />
              <CardBody>
                {context.loading ? <LoadingState rows={2} /> : <RiskMeter risk={context.data?.risk ?? selected} />}
              </CardBody>
            </Card>
          </div>

          <div className="space-y-4 lg:col-span-3">
            <Card>
              <CardHeader
                title="Recommendation"
                action={
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" loading={analyze.pending} onClick={runAnalyze}>
                      <Sparkles size={14} aria-hidden="true" />
                      Analyze
                    </Button>
                    {active && !resolved && (
                      <Button size="sm" loading={resolve.pending} onClick={runResolve}>
                        <Play size={14} aria-hidden="true" />
                        Execute
                      </Button>
                    )}
                  </div>
                }
              />
              <CardBody>
                {analyze.pending ? (
                  <div role="status" aria-live="polite" className="space-y-1.5 py-3 text-sm text-fg-muted">
                    <p>Retrieving policy…</p>
                    <p>Generating recommendation…</p>
                    <p>Validating structured output…</p>
                  </div>
                ) : analyze.error ? (
                  <ErrorState message={analyze.error} onRetry={runAnalyze} />
                ) : !active ? (
                  <EmptyState title="Not analyzed" description="Run Analyze to see what the agent proposes." icon={Bot} />
                ) : (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="text-brand bg-brand/10 border-brand/40">
                        {humanize(active.recommendedAction)}
                      </Badge>
                      {active.creditAmount > 0 && (
                        <Badge>{formatInr(active.creditAmount)}</Badge>
                      )}
                      {active.confidence !== null && active.confidence !== undefined && (
                        <Badge>confidence {active.confidence}</Badge>
                      )}
                      {!active.aiGenerated && <Badge tone="text-medium bg-medium-soft border-medium/40">Fallback</Badge>}
                    </div>

                    <PolicyCard reference={active.policyReference} />
                    <DecisionTrace
                      recommendation={active}
                      risk={context.data?.risk}
                      incident={context.data?.incident}
                      customer={context.data?.customer}
                    />
                  </div>
                )}
              </CardBody>
            </Card>

            {resolve.error && (
              <Card>
                <ErrorState message={resolve.error} onRetry={runResolve} />
              </Card>
            )}

            {resolved && (
              <>
                <Card>
                  <CardHeader
                    title="Guardrail verdict"
                    action={<Badge tone={statusTone(resolved.action.status)}>{resolved.action.status}</Badge>}
                  />
                  <CardBody>
                    <GuardrailStatus verdict={resolved.verdict} amount={resolved.action.amount} />
                  </CardBody>
                </Card>

                {(resolved.notification || resolved.action.customer_message) && (
                  <NotificationPreview
                    message={resolved.action.customer_message}
                    channel={resolved.notification?.channel}
                    customerName={context.data?.customer?.name}
                    sent={Boolean(resolved.notification)}
                  />
                )}
              </>
            )}

            <Card>
              <CardHeader title="Ask about this customer" subtitle="Grounded in policy and customer data" />
              <CardBody className="space-y-3">
                <form onSubmit={ask} className="flex gap-2">
                  <Input
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    placeholder="What compensation is this customer eligible for?"
                    aria-label="Question about this customer"
                  />
                  <Button type="submit" loading={chat.pending} disabled={!question.trim()}>
                    <Send size={14} aria-hidden="true" />
                    <span className="sr-only sm:not-sr-only">Ask</span>
                  </Button>
                </form>

                {chat.error && <ErrorState message={chat.error} />}

                {answer && (
                  <div className="rounded-md border border-border bg-surface-2 p-3">
                    <p className="text-sm leading-relaxed text-fg">{answer.answer}</p>
                    {answer.citedPolicies?.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5 border-t border-border pt-2">
                        {answer.citedPolicies.map((slug) => (
                          <Badge key={slug} className="font-mono">
                            {slug}
                          </Badge>
                        ))}
                      </div>
                    )}
                    {answer.degraded && (
                      <p className="mt-2 text-xs text-medium">
                        AI unavailable — showing the relevant policies instead.
                      </p>
                    )}
                  </div>
                )}
              </CardBody>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
