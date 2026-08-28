import { useState } from 'react';
import { BookOpen, Plus, Search } from 'lucide-react';
import { useApi, useAction, useDebounced } from '../hooks/useApi.js';
import { knowledgeApi } from '../services/api.js';
import { useAuth } from '../hooks/useAuth.jsx';
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
  Modal,
  Select,
  Textarea,
} from '../components/ui/index.jsx';
import { formatDateTime } from '../utils/format.js';

const CATEGORIES = [
  'SHIPPING',
  'PREMIUM_CUSTOMER',
  'REFUND',
  'CANCELLATION',
  'PAYMENT_FAILURE',
  'COMPENSATION',
  'ESCALATION',
  'PRIVACY',
];

const emptyForm = { slug: '', title: '', category: 'COMPENSATION', content: '' };

/**
 * Policy knowledge base.
 *
 * This is the corpus the agent retrieves from, so editing it changes what the
 * system is willing to authorize. Writes are SUPERVISOR+, enforced by the API.
 */
export default function KnowledgePage() {
  const { hasRole } = useAuth();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);

  const q = useDebounced(search, 300);
  const { data, loading, error, refetch } = useApi(
    () => knowledgeApi.list({ search: q || undefined, category: category || undefined, limit: 30 }),
    [q, category]
  );

  const create = useAction(knowledgeApi.create);
  const update = useAction(knowledgeApi.update);
  const canEdit = hasRole('SUPERVISOR');

  const openNew = () => {
    setForm(emptyForm);
    setEditing('new');
  };

  const openEdit = (doc) => {
    setForm({ slug: doc.slug, title: doc.title, category: doc.category, content: doc.content });
    setEditing(doc);
  };

  const submit = async (e) => {
    e.preventDefault();
    const res =
      editing === 'new'
        ? await create.execute(form)
        : await update.execute(editing.id, { title: form.title, category: form.category, content: form.content });
    if (res.ok) {
      setEditing(null);
      refetch();
    }
  };

  const pending = create.pending || update.pending;
  const formError = create.error ?? update.error;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Policies</h1>
          <p className="mt-0.5 max-w-2xl text-sm text-fg-muted">
            The knowledge base the agent retrieves from. Every recommendation cites a document here.
          </p>
        </div>
        {canEdit && (
          <Button onClick={openNew}>
            <Plus size={15} aria-hidden="true" />
            New policy
          </Button>
        )}
      </header>

      <Card>
        <CardHeader
          title="Knowledge base"
          subtitle="Full-text search — the same retrieval the agent uses"
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
                  placeholder="e.g. delivery delay premium"
                  aria-label="Search policies"
                  className="h-8 w-56 pl-8 text-xs"
                />
              </div>
              <Select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                aria-label="Filter by category"
                className="h-8 w-40 text-xs"
              >
                <option value="">All categories</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c.replace(/_/g, ' ')}
                  </option>
                ))}
              </Select>
            </div>
          }
        />

        {loading ? (
          <LoadingState label="Loading policies…" rows={5} />
        ) : error ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : !data?.length ? (
          <EmptyState title="No policies found" description="Try a different search term." icon={BookOpen} />
        ) : (
          <div className="divide-y divide-border/60">
            {data.map((doc) => (
              <div key={doc.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-brand">{doc.slug}</span>
                      <Badge>{doc.version}</Badge>
                      <Badge>{doc.category.replace(/_/g, ' ')}</Badge>
                      {doc.relevance !== undefined && <Badge>relevance {doc.relevance}</Badge>}
                      {doc.is_active === false && (
                        <Badge tone="text-fg-muted bg-surface-2 border-border">Inactive</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-sm font-medium text-fg">{doc.title}</p>
                    <p className="mt-1 text-sm leading-relaxed text-fg-muted">{doc.excerpt}</p>
                    {doc.updated_at && (
                      <p className="mt-1.5 text-xs text-fg-muted">Updated {formatDateTime(doc.updated_at)}</p>
                    )}
                  </div>
                  {canEdit && doc.content && (
                    <Button size="sm" variant="secondary" onClick={() => openEdit(doc)}>
                      Edit
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'New policy' : 'Edit policy'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button type="submit" form="policy-form" loading={pending}>
              {editing === 'new' ? 'Create policy' : 'Save changes'}
            </Button>
          </>
        }
      >
        <form id="policy-form" onSubmit={submit} className="space-y-4" noValidate>
          {formError && (
            <div role="alert" className="rounded-md border border-high/40 bg-high-soft px-3 py-2 text-sm text-high">
              {formError}
            </div>
          )}

          {editing === 'new' && (
            <Field
              label="Slug"
              htmlFor="policy-slug"
              required
              hint="Lowercase words separated by hyphens — this is what recommendations cite"
            >
              {(a) => (
                <Input
                  {...a}
                  required
                  value={form.slug}
                  onChange={(e) => setForm({ ...form, slug: e.target.value })}
                  placeholder="delivery-compensation-v3"
                  className="font-mono"
                />
              )}
            </Field>
          )}

          <Field label="Title" htmlFor="policy-title" required>
            {(a) => (
              <Input
                {...a}
                required
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            )}
          </Field>

          <Field label="Category" htmlFor="policy-category" required>
            {(a) => (
              <Select {...a} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c.replace(/_/g, ' ')}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field
            label="Content"
            htmlFor="policy-content"
            required
            hint="At least 40 characters. Editing this bumps the version automatically."
          >
            {(a) => (
              <Textarea
                {...a}
                rows={8}
                required
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
              />
            )}
          </Field>
        </form>
      </Modal>
    </div>
  );
}
