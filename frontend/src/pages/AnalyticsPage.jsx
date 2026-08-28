import { useState } from 'react';
import { useApi } from '../hooks/useApi.js';
import { analyticsApi } from '../services/api.js';
import { Card, CardBody, CardHeader, ErrorState, LoadingState, Select } from '../components/ui/index.jsx';
import { StatCard } from '../components/domain/index.jsx';
import { CategoryBarChart, ResolutionTrendChart, TicketsAvoidedChart } from '../components/charts/index.jsx';
import { formatInr } from '../utils/format.js';

export default function AnalyticsPage() {
  const [days, setDays] = useState(14);
  const overview = useApi(() => analyticsApi.overview(), []);
  const incidents = useApi(() => analyticsApi.incidents({ days }), [days]);

  const o = overview.data;
  const i = incidents.data;

  return (
    <div className="space-y-5" data-testid="analytics">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-[0.14em] text-brand">Measure</p>
          <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
          <p className="mt-1 text-sm text-fg-muted">Resolution outcomes and incident patterns.</p>
        </div>
        <Select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          aria-label="Time range"
          className="h-9 w-36 text-sm"
        >
          <option value={7}>Last 7 days</option>
          <option value={14}>Last 14 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </Select>
      </header>

      {overview.loading ? (
        <LoadingState rows={2} />
      ) : overview.error ? (
        <Card>
          <ErrorState message={overview.error} onRetry={overview.refetch} />
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="AI resolved" value={o.aiResolved} tone="text-low" />
          <StatCard
            label="Tickets avoided"
            value={o.estimatedTicketsAvoided}
            hint="Estimated, not measured"
            tone="text-low"
          />
          <StatCard label="Escalation rate" value={`${i?.escalationRate ?? 0}%`} tone="text-escalated" />
          <StatCard label="Credit issued" value={formatInr(o.totalCreditIssued)} />
        </div>
      )}

      {/* The estimate's basis, stated rather than implied. */}
      {o?.ticketsAvoidedBasis && (
        <p className="text-xs text-fg-muted">
          <span className="font-medium">Tickets avoided</span> is a modelled figure — a ticket that was
          never filed cannot be measured. Basis: {o.ticketsAvoidedBasis.toLowerCase()}.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Resolution activity" subtitle={`Last ${days} days`} />
          <CardBody>
            {incidents.loading ? (
              <LoadingState rows={3} />
            ) : incidents.error ? (
              <ErrorState message={incidents.error} onRetry={incidents.refetch} />
            ) : (
              <ResolutionTrendChart data={i?.trends ?? []} />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Tickets avoided" subtitle="Cumulative" />
          <CardBody>
            {incidents.loading ? <LoadingState rows={3} /> : <TicketsAvoidedChart data={i?.trends ?? []} />}
          </CardBody>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Incidents by type" />
          <CardBody>
            {incidents.loading ? <LoadingState rows={2} /> : <CategoryBarChart data={i?.byType ?? []} label="Incidents" />}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="By severity" />
          <CardBody>
            {incidents.loading ? (
              <LoadingState rows={2} />
            ) : (
              <CategoryBarChart data={i?.bySeverity ?? []} label="Incidents" color="medium" />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Resolution mix" subtitle="Executed actions" />
          <CardBody>
            {incidents.loading ? (
              <LoadingState rows={2} />
            ) : (
              <CategoryBarChart data={i?.resolutionMix ?? []} label="Actions" color="low" />
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
