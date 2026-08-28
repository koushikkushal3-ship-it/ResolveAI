import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, CheckCircle2, IndianRupee, ShieldAlert, Zap } from 'lucide-react';
import { useApi, useAction } from '../hooks/useApi.js';
import { analyticsApi, agentApi, incidentsApi } from '../services/api.js';
import { Button, EmptyState, ErrorState, LoadingState } from '../components/ui/index.jsx';
import {
  ActionRow,
  CoverageBar,
  IncidentCard,
  StatCell,
  StatStrip,
  TriageRow,
} from '../components/domain/index.jsx';
import { formatInrCompact } from '../utils/format.js';

/**
 * The shift console.
 *
 * Built around one question: what needs me right now, and is anyone falling
 * through?
 *
 * No trend charts here. A support lead does not open an operations console to
 * study a 14-day line, and a three-bar "risk distribution" is a sentence
 * pretending to be a visualisation. Trends live on /analytics, where studying
 * them is the actual task.
 *
 * Structurally this page is THREE surfaces, not eight. The previous version
 * gave every group its own bordered card, which spent a strong signal on
 * grouping that adjacency already communicates and left nothing dominant.
 */
export default function DashboardPage() {
  const navigate = useNavigate();
  const [resolvingId, setResolvingId] = useState(null);

  const overview = useApi(() => analyticsApi.overview(), []);
  const incidents = useApi(() => incidentsApi.list({ limit: 4, status: 'OPEN' }), []);
  const resolve = useAction(agentApi.resolve);
  const analyze = useAction(agentApi.analyze);

  const d = overview.data;
  const uncontactedHigh = d?.coverage?.high?.uncontacted ?? 0;

  /** Resolve straight from the queue. Analyze first if it has not been. */
  const handleResolve = async (row) => {
    setResolvingId(row.id);
    const res = row.proposedAction
      ? await resolve.execute({ customerId: row.customerId, incidentId: row.incidentId, useCached: true })
      : await analyze.execute({ customerId: row.customerId, incidentId: row.incidentId, force: false });
    setResolvingId(null);
    if (res.ok) overview.refetch();
  };

  return (
    <div className="space-y-8" data-testid="dashboard">
      {/* Section rhythm is 32px between groups and 16-20px within them, so the
          page reads as three blocks rather than a uniform grid of boxes. */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="t-micro text-brand">Customer experience</p>
          <h1 className="t-display mt-1.5">Command Center</h1>
          <p className="t-body mt-2 max-w-xl text-fg-muted">
            Who needs attention right now, and whether anyone is being missed.
          </p>
        </div>
        <Button size="lg" onClick={() => navigate('/simulator')} data-testid="dashboard-simulate">
          <Zap size={16} aria-hidden="true" />
          Run simulator
        </Button>
      </header>

      {/* --- Surface 1: the instrument cluster + coverage, one panel --- */}
      <section className="space-y-4">
        {overview.loading ? (
          <div className="panel h-28 animate-pulse" />
        ) : overview.error ? (
          <div className="panel">
            <ErrorState message={overview.error} onRetry={overview.refetch} />
          </div>
        ) : (
          <>
            <StatStrip testId="metric-strip">
              <StatCell
                label="Needs contact now"
                value={uncontactedHigh}
                hint="High risk, not yet told"
                icon={AlertTriangle}
                tone={uncontactedHigh > 0 ? 'text-high' : 'text-low'}
                testId="kpi-needs-contact"
                index={0}
              />
              <StatCell
                label="Awaiting approval"
                value={d.pendingApprovals}
                hint="Blocked on a supervisor"
                icon={ShieldAlert}
                tone={d.pendingApprovals > 0 ? 'text-medium' : 'text-fg'}
                testId="kpi-awaiting-approval"
                index={1}
              />
              <StatCell
                label="Value at risk"
                value={formatInrCompact(d.coverage?.valueAtRisk ?? 0)}
                hint="Orders behind open cases"
                icon={IndianRupee}
                testId="kpi-value-at-risk"
                index={2}
              />
              <StatCell
                label="Resolved by AI"
                value={d.aiResolved}
                hint={`${d.estimatedTicketsAvoided} tickets likely avoided`}
                icon={CheckCircle2}
                tone="text-low"
                testId="kpi-ai-resolved"
                index={3}
              />
            </StatStrip>

            {/* Coverage sits borderless beneath the cluster it belongs to.
                Its own card would have implied a separate concern. */}
            <div className="px-1">
              <CoverageBar coverage={d?.coverage} testId="coverage-bar" />
            </div>
          </>
        )}
      </section>

      {/* --- Surface 2: the work. The page's centre of gravity. --- */}
      <section>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h2 className="t-title">Triage queue</h2>
            <p className="t-body mt-0.5 text-fg-muted">
              Ranked worst first. Resolve without leaving this page.
            </p>
          </div>
          <Link
            to="/actions"
            className="inline-flex items-center gap-1 text-sm text-brand hover:underline"
          >
            Approval queue
            <ArrowRight size={13} aria-hidden="true" />
          </Link>
        </div>

        <div className="panel overflow-hidden">
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
              <div className="hidden items-center gap-x-5 border-b border-border bg-surface-2/50 px-5 py-2.5 lg:flex">
                <span className="t-micro w-11 shrink-0 text-center text-fg-muted">Risk</span>
                <span className="t-micro min-w-[200px] flex-1 text-fg-muted">Customer and why</span>
                <span className="t-micro w-28 shrink-0 text-right text-fg-muted">Order</span>
                <span className="t-micro w-44 shrink-0 text-fg-muted">Proposed</span>
                <span className="w-[84px] shrink-0" />
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
        </div>
      </section>

      {/* --- Surface 3: context, deliberately quieter than the queue --- */}
      <section className="grid gap-6 lg:grid-cols-2">
        <div>
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="t-title">Open incidents</h2>
            <Link to="/incidents" className="text-sm text-brand hover:underline">
              View all
            </Link>
          </div>
          <div className="panel overflow-hidden">
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
          </div>
        </div>

        <div>
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="t-title">Recent activity</h2>
            <span className="text-sm text-fg-muted">What the agent has already done</span>
          </div>
          <div className="panel overflow-hidden">
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
          </div>
        </div>
      </section>
    </div>
  );
}
