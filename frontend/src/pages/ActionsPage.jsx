import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ShieldAlert, X } from 'lucide-react';
import { useApi, useAction } from '../hooks/useApi.js';
import { actionsApi } from '../services/api.js';
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
  LoadingState,
  Modal,
  Select,
  Textarea,
} from '../components/ui/index.jsx';
import { GuardrailStatus } from '../components/domain/index.jsx';
import { formatInr, formatRelative, humanize, statusTone } from '../utils/format.js';

/**
 * Approval queue.
 *
 * Approve and reject are visible only to SUPERVISOR+, which mirrors the API's
 * rule. Hiding them is a courtesy, not the control — the server rejects the
 * call either way, and it also refuses when the approver proposed the action.
 */
export default function ActionsPage() {
  const { hasRole, user } = useAuth();
  const [status, setStatus] = useState('PROPOSED');
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState('');

  const { data, loading, error, refetch } = useApi(
    () => actionsApi.list({ status: status || undefined, limit: 50 }),
    [status]
  );
  const guardrails = useApi(() => actionsApi.guardrails(), []);
  const approve = useAction(actionsApi.approve);
  const reject = useAction(actionsApi.reject);

  const canApprove = hasRole('SUPERVISOR');

  const doApprove = async (id) => {
    const res = await approve.execute(id);
    if (res.ok) refetch();
  };

  const doReject = async (e) => {
    e.preventDefault();
    const res = await reject.execute(rejecting.id, { reason: reason || undefined });
    if (res.ok) {
      setRejecting(null);
      setReason('');
      refetch();
    }
  };

  return (
    <div className="space-y-4">
      <header>
        <p className="mb-1 text-xs font-medium uppercase tracking-[0.14em] text-brand">Govern</p>
        <h1 className="text-2xl font-semibold tracking-tight">Approvals</h1>
        <p className="mt-0.5 text-sm text-fg-muted">
          Actions the guardrails would not execute automatically.
          {!canApprove && ' Your role can view these but not approve them.'}
        </p>
      </header>

      {(approve.error || reject.error) && (
        <Card>
          <ErrorState message={approve.error ?? reject.error} />
        </Card>
      )}

      <Card>
        <CardHeader
          title="Action queue"
          action={
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              aria-label="Filter by status"
              className="h-8 w-40 text-xs"
            >
              <option value="">All statuses</option>
              <option value="PROPOSED">Awaiting approval</option>
              <option value="ESCALATED">Escalated</option>
              <option value="EXECUTED">Executed</option>
              <option value="REJECTED">Rejected</option>
              <option value="FAILED">Failed</option>
            </Select>
          }
        />

        {loading ? (
          <LoadingState label="Loading actions…" rows={5} />
        ) : error ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : !data?.length ? (
          <EmptyState
            title="Nothing waiting"
            description={
              status === 'PROPOSED'
                ? 'Every proposed action has been handled. Guardrails auto-executed the rest.'
                : 'No actions match this filter.'
            }
            icon={ShieldAlert}
          />
        ) : (
          <div className="divide-y divide-border/60">
            {data.map((a) => {
              // The API also enforces this; showing it prevents a pointless 403.
              const ownProposal = a.created_by === user?.id;
              return (
                <div key={a.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-fg">{humanize(a.action_type)}</span>
                        <Badge tone={statusTone(a.status)}>{a.status}</Badge>
                        {a.ai_generated && <Badge>AI</Badge>}
                      </div>
                      <p className="mt-0.5 text-sm text-fg-muted">
                        <Link to={`/customers/${a.customer_id}`} className="text-brand hover:underline">
                          {a.customerName}
                        </Link>
                        {' · '}
                        {a.customerSegment} · {formatRelative(a.created_at)}
                      </p>
                      <p className="mt-1.5 text-sm text-fg-muted">{a.reason}</p>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {Number(a.amount) > 0 && (
                        <span className="font-mono text-sm font-medium tabular">{formatInr(a.amount)}</span>
                      )}
                      {canApprove && ['PROPOSED', 'ESCALATED'].includes(a.status) && (
                        <>
                          <Button
                            size="sm"
                            loading={approve.pending}
                            disabled={ownProposal}
                            title={ownProposal ? 'You cannot approve an action you proposed' : undefined}
                            onClick={() => doApprove(a.id)}
                            data-testid="approve-action"
                          >
                            <Check size={14} aria-hidden="true" />
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={ownProposal}
                            onClick={() => setRejecting(a)}
                          >
                            <X size={14} aria-hidden="true" />
                            Reject
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  {ownProposal && ['PROPOSED', 'ESCALATED'].includes(a.status) && canApprove && (
                    <p className="mt-2 text-xs text-medium">
                      You proposed this action, so another supervisor must review it.
                    </p>
                  )}

                  {a.guardrail_result?.reasons?.length > 0 && (
                    <div className="mt-3 max-w-md">
                      <GuardrailStatus
                        verdict={a.guardrail_result}
                        amount={a.amount}
                        autoLimit={guardrails.data?.autoCreditLimit ?? 500}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Modal
        open={Boolean(rejecting)}
        onClose={() => setRejecting(null)}
        title="Reject this action"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejecting(null)}>
              Cancel
            </Button>
            <Button variant="danger" type="submit" form="reject-form" loading={reject.pending}>
              Reject action
            </Button>
          </>
        }
      >
        <form id="reject-form" onSubmit={doReject} className="space-y-3">
          <p className="text-sm text-fg-muted">
            {rejecting && (
              <>
                {humanize(rejecting.action_type)} for {rejecting.customerName}
                {Number(rejecting.amount) > 0 && ` · ${formatInr(rejecting.amount)}`}
              </>
            )}
          </p>
          <Field label="Reason" htmlFor="reject-reason" hint="Recorded in the audit trail">
            {(a) => (
              <Textarea
                {...a}
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why is this being rejected?"
              />
            )}
          </Field>
        </form>
      </Modal>

      {guardrails.data && (
        <Card>
          <CardHeader title="Guardrail thresholds" subtitle="Enforced by the backend" />
          <CardBody>
            <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs uppercase tracking-wide text-fg-muted">Auto-approve up to</dt>
                <dd className="font-mono tabular">{formatInr(guardrails.data.autoCreditLimit)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-fg-muted">Daily cap per customer</dt>
                <dd className="font-mono tabular">{formatInr(guardrails.data.dailyCreditCap)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-fg-muted">Confidence floor</dt>
                <dd className="font-mono tabular">{guardrails.data.confidenceFloor}</dd>
              </div>
            </dl>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
