import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useApi, useDebounced } from '../hooks/useApi.js';
import { customersApi } from '../services/api.js';
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  PageHeader,
  Select,
  TableWrap,
  Td,
  Th,
} from '../components/ui/index.jsx';
import { RiskBadge } from '../components/domain/index.jsx';
import { formatInr } from '../utils/format.js';

export default function CustomersPage() {
  const [search, setSearch] = useState('');
  const [segment, setSegment] = useState('');
  const [riskLevel, setRiskLevel] = useState('');
  const [sort, setSort] = useState('name');
  const [page, setPage] = useState(1);

  // Debounced so typing does not fire a request per keystroke.
  const q = useDebounced(search, 300);

  const { data, meta, loading, error, refetch } = useApi(
    () =>
      customersApi.list({
        search: q || undefined,
        segment: segment || undefined,
        riskLevel: riskLevel || undefined,
        sort,
        order: sort === 'lifetime_value' ? 'desc' : 'asc',
        page,
        limit: 20,
      }),
    [q, segment, riskLevel, sort, page]
  );

  const reset = (fn) => (e) => {
    fn(e.target.value);
    setPage(1); // A filter change invalidates the current page number.
  };

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Directory"
        title="Customers"
        subtitle={`${meta ? meta.total : ''} customers with their current experience risk.`.trim()}
      />

      <Card>
        <CardHeader
          title="Directory"
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
                  onChange={reset(setSearch)}
                  placeholder="Search name or email"
                  aria-label="Search customers"
                  className="h-8 w-48 pl-8 text-xs"
                />
              </div>
              <Select
                value={segment}
                onChange={reset(setSegment)}
                aria-label="Filter by segment"
                className="h-8 w-32 text-xs"
              >
                <option value="">All segments</option>
                <option value="PREMIUM">Premium</option>
                <option value="STANDARD">Standard</option>
                <option value="NEW">New</option>
              </Select>
              <Select
                value={riskLevel}
                onChange={reset(setRiskLevel)}
                aria-label="Filter by risk level"
                className="h-8 w-28 text-xs"
              >
                <option value="">All risk</option>
                <option value="HIGH">High</option>
                <option value="MEDIUM">Medium</option>
                <option value="LOW">Low</option>
              </Select>
              <Select value={sort} onChange={reset(setSort)} aria-label="Sort by" className="h-8 w-36 text-xs">
                <option value="name">Sort: Name</option>
                <option value="lifetime_value">Sort: Lifetime value</option>
                <option value="segment">Sort: Segment</option>
                <option value="created_at">Sort: Newest</option>
              </Select>
            </div>
          }
        />

        {loading ? (
          <LoadingState label="Loading customers…" rows={6} />
        ) : error ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : !data?.length ? (
          <EmptyState
            title="No customers match"
            description="Try clearing the search or filters."
            action={
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setSearch('');
                  setSegment('');
                  setRiskLevel('');
                  setPage(1);
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <>
            <TableWrap>
              <thead>
                <tr>
                  <Th>Customer</Th>
                  <Th>Segment</Th>
                  <Th className="text-right">Lifetime value</Th>
                  <Th>Channel</Th>
                  <Th>Risk</Th>
                  <Th className="text-right">Open cases</Th>
                </tr>
              </thead>
              <tbody>
                {data.map((c) => (
                  <tr key={c.id} className="transition-colors hover:bg-surface-2">
                    <Td>
                      <Link to={`/customers/${c.id}`} className="target-24 font-medium text-fg hover:text-brand hover:underline">
                        {c.name}
                      </Link>
                      <p className="text-xs text-fg-muted">{c.email}</p>
                    </Td>
                    <Td className="text-fg-muted">{c.segment}</Td>
                    <Td className="text-right font-mono tabular">{formatInr(c.lifetime_value)}</Td>
                    <Td className="text-fg-muted">{c.preferred_channel}</Td>
                    <Td>
                      {c.riskScore !== null ? (
                        <RiskBadge score={c.riskScore} level={c.riskLevel} />
                      ) : (
                        <span className="text-xs text-fg-muted">—</span>
                      )}
                    </Td>
                    <Td className="text-right font-mono tabular">{c.openIncidents || '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>

            {meta && meta.totalPages > 1 && (
              <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2.5">
                <p className="text-xs text-fg-muted">
                  Page {meta.page} of {meta.totalPages}
                </p>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    Previous
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={page >= meta.totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
