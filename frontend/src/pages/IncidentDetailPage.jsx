import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { useApi } from '../hooks/useApi.js';
import { incidentsApi } from '../services/api.js';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingState,
  TableWrap,
  Td,
  Th,
} from '../components/ui/index.jsx';
import { RiskBadge } from '../components/domain/index.jsx';
import { formatDateTime, formatDelay, formatInr, humanize, statusTone } from '../utils/format.js';

/**
 * Incident detail — the pivot of the demo.
 *
 * The affected-customer table is ordered by risk descending, so the person who
 * most needs help is the first row rather than something the operator has to
 * hunt for.
 */
export default function IncidentDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, loading, error, refetch } = useApi(() => incidentsApi.get(id), [id]);

  if (loading) {
    return (
      <Card>
        <LoadingState label="Loading incident…" rows={6} />
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

  const { incident, affectedCustomers, affectedOrders, summary } = data;

  return (
    <div className="space-y-5">
      <div>
        <Button variant="ghost" size="sm" onClick={() => navigate('/incidents')}>
          <ArrowLeft size={15} aria-hidden="true" />
          Incidents
        </Button>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{incident.title}</h1>
            <Badge tone={statusTone(incident.status)} className="uppercase" data-testid="incident-status">
              {incident.status}
            </Badge>
            <Badge>{incident.severity}</Badge>
            {incident.is_simulated && <Badge>Simulated</Badge>}
          </div>
          <p className="mt-1 text-sm text-fg-muted">
            {humanize(incident.type)} · started {formatDateTime(incident.started_at)}
          </p>
        </div>
      </header>

      {incident.description && (
        <Card>
          <CardBody>
            <p className="text-sm leading-relaxed text-fg-muted">{incident.description}</p>
          </CardBody>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          { label: 'Affected orders', value: affectedOrders, tone: 'text-fg' },
          { label: 'Customers', value: summary.total, tone: 'text-fg' },
          { label: 'High risk', value: summary.high, tone: 'text-high' },
          { label: 'Medium', value: summary.medium, tone: 'text-medium' },
          { label: 'Resolved', value: summary.resolved, tone: 'text-low' },
        ].map((s) => (
          <Card key={s.label} className="p-3">
            <p className="text-xs uppercase tracking-wide text-fg-muted">{s.label}</p>
            <p className={`mt-1 font-mono text-2xl font-semibold tabular ${s.tone}`}>{s.value}</p>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader
          title="Affected customers"
          subtitle="Ranked by CX risk — open the highest first"
        />
        {!affectedCustomers.length ? (
          <EmptyState title="No customers affected" description="This incident has no linked customers yet." />
        ) : (
          <TableWrap data-testid="affected-customers">
            <thead>
              <tr>
                <Th>Customer</Th>
                <Th>Segment</Th>
                <Th>Order</Th>
                <Th className="text-right">Value</Th>
                <Th>Delay</Th>
                <Th>Risk</Th>
                <Th>Status</Th>
                <Th><span className="sr-only">Open</span></Th>
              </tr>
            </thead>
            <tbody>
              {affectedCustomers.map((a) => (
                <tr key={a.id} className="transition-colors hover:bg-surface-2">
                  <Td>
                    <Link
                      to={`/customers/${a.customerId}`}
                      className="target-24 font-medium text-fg hover:text-brand hover:underline"
                      data-testid="affected-customer-link"
                    >
                      {a.customer.name}
                    </Link>
                  </Td>
                  <Td className="text-fg-muted">{a.customer.segment}</Td>
                  <Td className="font-mono text-xs text-fg-muted">{a.order?.order_number ?? '—'}</Td>
                  <Td className="text-right font-mono tabular">{formatInr(a.order?.amount)}</Td>
                  <Td className={a.delayHours > 48 ? 'text-high' : 'text-fg-muted'}>
                    {formatDelay(a.delayHours)}
                  </Td>
                  <Td>
                    <RiskBadge score={a.riskScore} level={a.riskLevel} />
                  </Td>
                  <Td>
                    <Badge tone={statusTone(a.status)}>{a.status}</Badge>
                  </Td>
                  <Td>
                    <Link
                      to={`/customers/${a.customerId}`}
                      className="inline-flex items-center gap-0.5 text-xs text-brand hover:underline"
                      aria-label={`Open ${a.customer.name}`}
                    >
                      Open
                      <ChevronRight size={13} aria-hidden="true" />
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
