import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, IndianRupee, ShieldAlert, Zap } from 'lucide-react';
import { useApi, useAction } from '../hooks/useApi.js';
import { analyticsApi, agentApi } from '../services/api.js';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
} from '../components/ui/index.jsx';
import {
  ActionRow,
  CoverageBar,
  IncidentCard,
  StatCard,
  TriageRow,
} from '../components/domain/index.jsx';
import { formatInrCompact } from '../utils/format.js';
import { incidentsApi } from '../services/api.js';

/**
 * The shift console.
 *
 * Built around one question: what needs me right now, and is anyone falling
 * through?
 *
 * This page deliberately carries no trend charts. A support lead does not open
 * an operations console to study a 14-day line, and a three-bar "risk
 * distribution" chart is a sentence pretending to be a visualisation — the same
 * information reads better as "5 high, 6 medium, 6 low". Trends live on
 * /analytics, where studying them is the actual task.
 *
 * What replaces them is the work itself: a coverage bar that shows whether any
 * customer is being missed, and a triage queue with a resolve button on every
 * row.
 */
export default function DashboardPage() {
  const navigate = useNavigate();
  const [resolvingId, setResolvingId] = useState(null);

  const overview = useApi(() => analyticsApi.overview(), []);
  const incidents = useApi(() => incidentsApi.list({ limit: 4, status: 'OPEN' }), []);
  const resolve = useAction(agentApi.resolve);
  const analyze = useAction(agentApi.analyze);

  const d = overview.data;

  /** Resolve straight from the queue. Analyze first if it has not been. */
  const handleResolve = async (row) => {
    setResolvingId(row.id);
    const res = row.proposedAction
      ? await resolve.execute({ customerId: row.customerId, incidentId: row.incidentId, useCached: true })
      : await analyze.execute({ customerId: row.customerId, incidentId: row.incidentId, force: false });
    setResolvingId(null);
    if (res.ok) overview.refetch();
  };

  const uncontactedHigh = d?.coverage?.high?.uncontacted ?? 0;

  return (
    <div className="space-y-6" data-testid="dashboard">
      <PageHeader
        eyebrow="Customer experience"
        title="Command Center"
        subtitle="Who needs attention right now, and whether anyone is being missed."
        action={
          <Button onClick={() => navigate('/simulator')} data-testid="dashboard-simulate">
            <Zap size={15} aria-hidden="true" />
            Run simulator
          </Button>
        }
      />

      {/* --- Four numbers that drive an action, not six that describe a state --- */}
      {overview.loading ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="h-24 animate-pulse bg-surface-2" />
          ))}
        </div>
      ) : overview.error ? (
        <Card>
          <ErrorState message={overview.error} onRetry={overview.refetch} />
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Needs contact now"
            value={uncontactedHigh}
            hint="High risk, not yet told"
            icon={AlertTriangle}
            tone={uncontactedHigh > 0 ? 'text-high' : 'text-low'}
            testId="kpi-needs-contact"
            index={0}
          />
          <StatCard
            label="Awaiting approval"
            value={d.pendingApprovals}
            hint="Blocked on a supervisor"
            icon={ShieldAlert}
            tone={d.pendingApprovals > 0 ? 'text-medium' : 'text-fg'}
            testId="kpi-awaiting-approval"
            index={1}
          />
          <StatCard
            label="Value at risk"
            value={formatInrCompact(d.coverage?.valueAtRisk ?? 0)}
            hint="Orders behind open cases"
            icon={IndianRupee}
            tone="text-fg"
            testId="kpi-value-at-risk"
            index={2}
          />
          <StatCard
            label="Resolved by AI"
            value={d.aiResolved}
            hint={`${d.estimatedTicketsAvoided} tickets likely avoided`}
            icon={CheckCircle2}
            tone="text-low"
            testId="kpi-ai-resolved"
            index={3}
          />
        </div>
      )}

      {/* --- Coverage: the one visual that answers a real question --- */}
      <Card>
        <CardHeader
          title="Outreach coverage"
          subtitle="Whether anyone affected is still waiting to hear from us"
        />
        <CardBody>
          {overview.loading ? (
            <LoadingState rows={2} />
          ) : (
            <CoverageBar coverage={d?.coverage} testId="coverage-bar" />
          )}
        </CardBody>
      </Card>

      {/* --- The work itself --- */}
      <Card>
        <CardHeader
          title="Triage queue"
          subtitle="Ranked worst first. Resolve without leaving this page."
          action={
            <Link to="/actions" className="text-xs text-brand hover:underline">
              Approval queue
            </Link>
          }
        />
        {overview.loading ? (
          <LoadingState label="Loading queue…" rows={5} />
        ) : !d?.worklist?.length ? (
          <EmptyState
            title="Queue is clear"
            description="No unresolved customers on any open incident. Run a simulator scenario to see the workflow."
            icon={CheckCircle2}
            action={
              <Button size="sm" onClick={() => navigate('/simulator')}>
                <Zap size={14} aria-hidden="true" />
                Open simulator
              </Button>
            }
          />
        ) : (
          <>
            {/* Column labels, so the row grid is not a guess. */}
            <div className="hidden items-center gap-x-4 border-b border-border bg-surface-2/40 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-muted lg:flex">
              <span className="w-12 shrink-0 text-center">Risk</span>
              <span className="min-w-[180px] flex-1">Customer and why</span>
              <span className="w-28 shrink-0 text-right">Order</span>
              <span className="w-44 shrink-0">Proposed</span>
              <span className="w-[76px] shrink-0" />
            </div>
            <div data-testid="triage-queue">
              {d.worklist.map((row) => (
                <TriageRow
                  key={row.id}
                  row={row}
                  onResolve={handleResolve}
                  resolving={resolvingId === row.id}
                />
              ))}
            </div>
          </>
        )}
        {(resolve.error || analyze.error) && (
          <div className="border-t border-border">
            <ErrorState message={resolve.error ?? analyze.error} />
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Open incidents"
            subtitle="What is causing the queue"
            action={
              <Link to="/incidents" className="text-xs text-brand hover:underline">
                View all
              </Link>
            }
          />
          {incidents.loading ? (
            <LoadingState rows={3} />
          ) : incidents.error ? (
            <ErrorState message={incidents.error} onRetry={incidents.refetch} />
          ) : !incidents.data?.length ? (
            <EmptyState title="No open incidents" description="Nothing is currently affecting customers." />
          ) : (
            <div data-testid="incident-feed">
              {incidents.data.map((incident) => (
                <IncidentCard
                  key={incident.id}
                  incident={incident}
                  onClick={() => navigate(`/incidents/${incident.id}`)}
                />
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Recent activity" subtitle="What the agent has already done" />
          {overview.loading ? (
            <LoadingState rows={3} />
          ) : !d?.recentActions?.length ? (
            <EmptyState title="No actions yet" />
          ) : (
            <div data-testid="recent-actions">
              {d.recentActions.map((a) => (
                <ActionRow key={a.id} action={a} />
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
