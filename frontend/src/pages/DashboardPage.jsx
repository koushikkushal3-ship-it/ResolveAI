import { Link, useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  Bot,
  MessageSquare,
  ShieldAlert,
  TicketCheck,
  Zap,
} from 'lucide-react';
import { useApi } from '../hooks/useApi.js';
import { analyticsApi, incidentsApi } from '../services/api.js';
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
import { ActionRow, IncidentCard, RiskBadge, StatCard } from '../components/domain/index.jsx';
import { RiskDistributionChart, ResolutionTrendChart } from '../components/charts/index.jsx';
import { formatInr } from '../utils/format.js';

/**
 * Dashboard — the command center.
 *
 * Reading order is deliberate: the six KPIs answer "is anything wrong right
 * now", the incident feed answers "what", and the high-risk customer list
 * answers "who do I open first". Charts sit below that, because a trend is
 * context rather than a call to action.
 */
export default function DashboardPage() {
  const navigate = useNavigate();
  const overview = useApi(() => analyticsApi.overview(), []);
  const incidents = useApi(() => incidentsApi.list({ limit: 6, status: 'OPEN' }), []);
  const trends = useApi(() => analyticsApi.incidents({ days: 14 }), []);

  const d = overview.data;

  return (
    <div className="space-y-6" data-testid="dashboard">
      <PageHeader
        eyebrow="Customer experience"
        title="Command Center"
        subtitle="Operational incidents, customer risk, and what the agent has already resolved."
        action={
          <Button onClick={() => navigate('/simulator')} data-testid="dashboard-simulate">
            <Zap size={15} aria-hidden="true" />
            Run simulator
          </Button>
        }
      />

      {/* --- KPIs --- */}
      {overview.loading ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="h-24 animate-pulse bg-surface-2" />
          ))}
        </div>
      ) : overview.error ? (
        <Card>
          <ErrorState message={overview.error} onRetry={overview.refetch} />
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          <StatCard
            label="Active incidents"
            value={d.activeIncidents}
            icon={Activity}
            tone={d.activeIncidents > 0 ? 'text-high' : 'text-fg'}
            testId="kpi-active-incidents"
            index={0}
          />
          <StatCard
            label="Customers at risk"
            value={d.customersAtRisk}
            icon={AlertTriangle}
            tone={d.customersAtRisk > 0 ? 'text-medium' : 'text-fg'}
            testId="kpi-at-risk"
            index={1}
          />
          <StatCard label="AI resolved" value={d.aiResolved} icon={Bot} tone="text-low" testId="kpi-ai-resolved"
            index={2} />
          <StatCard
            label="Proactively contacted"
            value={d.proactivelyContacted}
            icon={MessageSquare}
            testId="kpi-contacted"
            index={3}
          />
          <StatCard
            label="Tickets avoided"
            value={d.estimatedTicketsAvoided}
            hint="Estimated"
            icon={TicketCheck}
            tone="text-low"
            testId="kpi-tickets-avoided"
            index={4}
          />
          <StatCard
            label="Escalations"
            value={d.humanEscalations}
            icon={ShieldAlert}
            tone={d.humanEscalations > 0 ? 'text-escalated' : 'text-fg'}
            testId="kpi-escalations"
            index={5}
          />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* --- Incident feed --- */}
        <Card className="lg:col-span-2">
          <CardHeader
            title="Open incidents"
            subtitle="Operational events currently affecting customers"
            action={
              <Link to="/incidents" className="text-xs text-brand hover:underline">
                View all
              </Link>
            }
          />
          {incidents.loading ? (
            <LoadingState label="Loading incidents…" />
          ) : incidents.error ? (
            <ErrorState message={incidents.error} onRetry={incidents.refetch} />
          ) : !incidents.data?.length ? (
            <EmptyState
              title="No open incidents"
              description="Nothing is currently affecting customers. Run a simulator scenario to see the workflow."
              action={
                <Button size="sm" onClick={() => navigate('/simulator')}>
                  <Zap size={14} aria-hidden="true" />
                  Open simulator
                </Button>
              }
            />
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

        {/* --- Highest-risk customers --- */}
        <Card>
          <CardHeader title="Highest risk" subtitle="Open cases, worst first" />
          {overview.loading ? (
            <LoadingState label="Loading customers…" rows={4} />
          ) : !d?.topRiskCustomers?.length ? (
            <EmptyState title="No customers at risk" description="Risk appears once an incident is detected." />
          ) : (
            <div data-testid="top-risk-customers">
              {d.topRiskCustomers.map((c) => (
                <Link
                  key={c.id}
                  to={`/customers/${c.customerId}`}
                  className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-2.5 transition-colors last:border-0 hover:bg-surface-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-fg">{c.name}</p>
                    <p className="text-xs text-fg-muted">
                      {c.segment} · {formatInr(c.lifetimeValue)}
                    </p>
                  </div>
                  <RiskBadge score={c.riskScore} level={c.riskLevel} />
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Risk distribution" subtitle="Open customer cases" />
          <CardBody>
            {overview.loading ? <LoadingState rows={2} /> : <RiskDistributionChart data={d?.riskDistribution ?? []} />}
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Resolution activity" subtitle="Last 14 days" />
          <CardBody>
            {trends.loading ? (
              <LoadingState rows={3} />
            ) : trends.error ? (
              <ErrorState message={trends.error} onRetry={trends.refetch} />
            ) : (
              <ResolutionTrendChart data={trends.data?.trends ?? []} />
            )}
          </CardBody>
        </Card>
      </div>

      {/* --- Recent AI actions --- */}
      <Card>
        <CardHeader
          title="Recent AI actions"
          subtitle="What the agent has done, and what is waiting on a human"
          action={
            <Link to="/actions" className="text-xs text-brand hover:underline">
              Approval queue
            </Link>
          }
        />
        {overview.loading ? (
          <LoadingState rows={4} />
        ) : !d?.recentActions?.length ? (
          <EmptyState title="No actions yet" description="Resolve an incident to see activity here." />
        ) : (
          <div data-testid="recent-actions">
            {d.recentActions.map((a) => (
              <ActionRow key={a.id} action={a} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
