import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, CreditCard, Loader2, PackageX, Truck } from 'lucide-react';
import { useAction } from '../hooks/useApi.js';
import { simulatorApi } from '../services/api.js';
import { Button, Card, CardBody, CardHeader, ErrorState, cx } from '../components/ui/index.jsx';

/**
 * Incident simulator.
 *
 * Every result on this page comes from the backend. Nothing is faked in the
 * browser — the counts shown are the counts that were written to the database,
 * so what the demo claims and what the system did are the same thing.
 */

const SCENARIOS = [
  {
    slug: 'delivery-delay',
    title: 'Delivery Delay',
    icon: Truck,
    testId: 'simulate-delivery-delay',
    primary: true,
    description: 'A carrier hub backlog delays 17 in-flight orders by up to 72 hours.',
    expect: '17 orders · 17 customers · 5 high risk',
  },
  {
    slug: 'payment-failure',
    title: 'Payment Failure',
    icon: CreditCard,
    testId: 'simulate-payment-failure',
    description: 'The payment provider returns authorization timeouts on UPI.',
    expect: 'Orders held 48h · human approval required',
  },
  {
    slug: 'inventory-shortage',
    title: 'Inventory Shortage',
    icon: PackageX,
    testId: 'simulate-inventory-shortage',
    description: 'A delayed supplier shipment leaves several SKUs oversold.',
    expect: 'Fulfilment blocked · proactive options offered',
  },
];

/** The pipeline the backend actually walks, surfaced so the demo is legible. */
const PIPELINE = [
  'Incident detected',
  'Affected orders resolved',
  'Affected customers identified',
  'CX risk calculated',
  'Policy retrieved',
  'Ready for AI recommendation',
];

export default function SimulatorPage() {
  const navigate = useNavigate();
  const [running, setRunning] = useState(null);
  const [result, setResult] = useState(null);
  const { execute, error } = useAction(simulatorApi.run);

  const run = async (scenario) => {
    setRunning(scenario.slug);
    setResult(null);
    const res = await execute(scenario.slug);
    setRunning(null);
    if (res.ok) setResult({ ...res.data.data, scenario });
  };

  return (
    <div className="space-y-6" data-testid="simulator">
      <header>
        <p className="mb-1 text-xs font-medium uppercase tracking-[0.14em] text-brand">Detect</p>
        <h1 className="text-2xl font-semibold tracking-tight">Incident Simulator</h1>
        <p className="mt-0.5 max-w-2xl text-sm text-fg-muted">
          Simulates the upstream operational event a logistics or payments provider would normally
          report. Everything after the trigger — affected orders, customers, risk scores, policy — is
          real and written to the database.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        {SCENARIOS.map((s) => {
          const Icon = s.icon;
          const busy = running === s.slug;
          return (
            <Card
              key={s.slug}
              className={cx('flex flex-col', s.primary && 'ring-1 ring-brand/30')}
            >
              <CardBody className="flex flex-1 flex-col">
                <div className="flex items-start gap-2.5">
                  <span
                    className={cx(
                      'flex h-9 w-9 shrink-0 items-center justify-center rounded-md',
                      s.primary ? 'bg-brand-fill text-on-brand' : 'bg-surface-2 text-fg-muted'
                    )}
                  >
                    <Icon size={17} aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-fg">{s.title}</h2>
                    {s.primary && <span className="text-xs text-brand">Primary demo scenario</span>}
                  </div>
                </div>

                <p className="mt-3 flex-1 text-sm text-fg-muted">{s.description}</p>
                <p className="mt-2 font-mono text-xs text-fg-muted">{s.expect}</p>

                <Button
                  className="mt-4 w-full"
                  variant={s.primary ? 'primary' : 'secondary'}
                  loading={busy}
                  disabled={Boolean(running)}
                  onClick={() => run(s)}
                  data-testid={s.testId}
                >
                  {busy ? 'Simulating…' : `Simulate ${s.title}`}
                </Button>
              </CardBody>
            </Card>
          );
        })}
      </div>

      {error && (
        <Card>
          <ErrorState message={error} />
        </Card>
      )}

      {/* Progress is shown only while a run is in flight — a permanently
          visible pipeline would imply work that is not happening. */}
      {running && (
        <Card>
          <CardHeader title="Running scenario" subtitle="Processing on the server" />
          <CardBody>
            <ol className="space-y-2" role="status" aria-live="polite">
              {PIPELINE.map((step) => (
                <li key={step} className="flex items-center gap-2 text-sm text-fg-muted">
                  <Loader2 size={13} className="animate-spin text-brand" aria-hidden="true" />
                  {step}
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      )}

      {result && (
        <Card data-testid="simulator-result">
          <CardHeader
            title={`${result.scenario.title} simulated`}
            subtitle="Incident created and customers scored"
            action={
              <Button size="sm" onClick={() => navigate(`/incidents/${result.incidentId}`)} data-testid="view-incident">
                View incident
              </Button>
            }
          />
          <CardBody className="space-y-4">
            <ol className="space-y-1.5">
              {PIPELINE.slice(0, 5).map((step) => (
                <li key={step} className="flex items-center gap-2 text-sm text-fg">
                  <CheckCircle2 size={14} className="text-low" aria-hidden="true" />
                  {step}
                </li>
              ))}
            </ol>

            <div className="grid grid-cols-2 gap-3 border-t border-border pt-4 sm:grid-cols-5">
              <div>
                <p className="text-xs uppercase tracking-wide text-fg-muted">Orders</p>
                <p className="font-mono text-xl font-semibold tabular" data-testid="sim-orders">
                  {result.affectedOrders}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-fg-muted">Customers</p>
                <p className="font-mono text-xl font-semibold tabular" data-testid="sim-customers">
                  {result.affectedCustomers}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-fg-muted">High</p>
                <p className="font-mono text-xl font-semibold tabular text-high" data-testid="sim-high">
                  {result.high}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-fg-muted">Medium</p>
                <p className="font-mono text-xl font-semibold tabular text-medium">{result.medium}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-fg-muted">Low</p>
                <p className="font-mono text-xl font-semibold tabular text-low">{result.low}</p>
              </div>
            </div>

            {/* A count, not a score. A risk badge rendered this as "5/100 HIGH",
                which reads as one customer's risk score rather than a total. */}
            <p className="border-t border-border pt-4 text-sm text-fg-muted">
              <span className="font-mono font-semibold text-high tabular">{result.high}</span>{' '}
              {result.high === 1 ? 'customer needs' : 'customers need'} attention before they contact
              support.
            </p>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
