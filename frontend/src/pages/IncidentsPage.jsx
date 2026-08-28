import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { useApi, useAction, useDebounced } from '../hooks/useApi.js';
import { incidentsApi } from '../services/api.js';
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Modal,
  Select,
  Textarea,
} from '../components/ui/index.jsx';
import { IncidentCard } from '../components/domain/index.jsx';

const TYPES = [
  'DELIVERY_DELAY',
  'PAYMENT_FAILURE',
  'INVENTORY_SHORTAGE',
  'ORDER_CANCELLED',
  'SUBSCRIPTION_ISSUE',
];
const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export default function IncidentsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ type: 'DELIVERY_DELAY', severity: 'MEDIUM', title: '', description: '' });

  const q = useDebounced(search, 300);
  const { data, loading, error, refetch } = useApi(
    () => incidentsApi.list({ search: q || undefined, status: status || undefined, limit: 30 }),
    [q, status]
  );
  const create = useAction(incidentsApi.create);

  const submit = async (e) => {
    e.preventDefault();
    const res = await create.execute(form);
    if (res.ok) {
      setCreating(false);
      setForm({ type: 'DELIVERY_DELAY', severity: 'MEDIUM', title: '', description: '' });
      refetch();
      navigate(`/incidents/${res.data.data.id}`);
    }
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Incidents</h1>
          <p className="mt-0.5 text-sm text-fg-muted">Operational events and who they affect.</p>
        </div>
        <Button onClick={() => setCreating(true)} data-testid="new-incident">
          <Plus size={15} aria-hidden="true" />
          New incident
        </Button>
      </header>

      <Card>
        <CardHeader
          title="All incidents"
          action={
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search
                  size={14}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted"
                  aria-hidden="true"
                />
                <Input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search incidents"
                  aria-label="Search incidents"
                  className="h-8 w-48 pl-8 text-xs"
                />
              </div>
              <Select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                aria-label="Filter by status"
                className="h-8 w-36 text-xs"
              >
                <option value="">All statuses</option>
                <option value="OPEN">Open</option>
                <option value="INVESTIGATING">Investigating</option>
                <option value="MITIGATING">Mitigating</option>
                <option value="RESOLVED">Resolved</option>
              </Select>
            </div>
          }
        />

        {loading ? (
          <LoadingState label="Loading incidents…" rows={6} />
        ) : error ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : !data?.length ? (
          <EmptyState
            title="No incidents"
            description="Create one, or run a simulator scenario to generate a realistic incident."
            action={
              <Button size="sm" onClick={() => navigate('/simulator')}>
                Open simulator
              </Button>
            }
          />
        ) : (
          <div>
            {data.map((incident) => (
              <IncidentCard
                key={incident.id}
                incident={incident}
                onClick={() => navigate(`/incidents/${incident.id}`)}
              />
            ))}
          </div>
        )}
      </Card>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New incident"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button type="submit" form="incident-form" loading={create.pending}>
              Create incident
            </Button>
          </>
        }
      >
        <form id="incident-form" onSubmit={submit} className="space-y-4" noValidate>
          {create.error && (
            <div role="alert" className="rounded-md border border-high/40 bg-high-soft px-3 py-2 text-sm text-high">
              {create.error}
            </div>
          )}

          <Field label="Title" htmlFor="incident-title" required hint="At least 5 characters">
            {(a) => (
              <Input
                {...a}
                required
                minLength={5}
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Carrier hub delay — North Zone"
              />
            )}
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Type" htmlFor="incident-type" required>
              {(a) => (
                <Select {...a} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  {TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t.replace(/_/g, ' ')}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Severity" htmlFor="incident-severity" required>
              {(a) => (
                <Select
                  {...a}
                  value={form.severity}
                  onChange={(e) => setForm({ ...form, severity: e.target.value })}
                >
                  {SEVERITIES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>

          <Field label="Description" htmlFor="incident-description">
            {(a) => (
              <Textarea
                {...a}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="What happened, and which orders are affected?"
              />
            )}
          </Field>
        </form>
      </Modal>
    </div>
  );
}
