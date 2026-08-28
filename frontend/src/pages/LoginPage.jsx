import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { useAuth } from '../hooks/useAuth.jsx';
import { AuthLayout } from '../layouts/AppShell.jsx';
import { Button, Card, CardBody, Field, Input } from '../components/ui/index.jsx';

const DEMO = [
  { role: 'Supervisor', email: 'supervisor@resolveai.demo', note: 'can approve actions' },
  { role: 'Agent', email: 'agent@resolveai.demo', note: 'read and propose only' },
];
const DEMO_PASSWORD = 'ResolveAI#2026';

export default function LoginPage() {
  const { login, isAuthenticated, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  if (loading) return null;
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    const result = await login(email.trim(), password);
    setPending(false);
    if (result.ok) {
      // Return to wherever they were headed before the login detour.
      navigate(location.state?.from?.pathname ?? '/dashboard', { replace: true });
    } else {
      setError(result.error);
    }
  };

  const useDemo = (demoEmail) => {
    setEmail(demoEmail);
    setPassword(DEMO_PASSWORD);
    setError(null);
  };

  return (
    <AuthLayout>
      <div className="mb-7 text-center">
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-fill text-on-brand shadow-lift">
          <ShieldCheck size={23} aria-hidden="true" />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">ResolveAI</h1>
        <p className="mt-1.5 text-sm text-fg-muted">Customer Experience Command Center</p>
        <p className="mt-3 text-xs text-fg-muted/80">
          Resolve problems before customers have to ask.
        </p>
      </div>

      <Card>
        <CardBody>
          <form onSubmit={submit} className="space-y-4" noValidate>
            {/* One error summary, focusable and announced, above the fields. */}
            {error && (
              <div
                role="alert"
                tabIndex={-1}
                className="rounded-md border border-high/40 bg-high-soft px-3 py-2 text-sm text-high"
              >
                {error}
              </div>
            )}

            <Field label="Email" htmlFor="login-email" required>
              {(a) => (
                <Input
                  {...a}
                  data-testid="login-email"
                  type="email"
                  name="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                />
              )}
            </Field>

            <Field label="Password" htmlFor="login-password" required>
              {(a) => (
                <Input
                  {...a}
                  data-testid="login-password"
                  type="password"
                  name="password"
                  // Password managers must be allowed to work.
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              )}
            </Field>

            <Button type="submit" className="w-full" loading={pending} data-testid="login-submit">
              {pending ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </CardBody>
      </Card>

      {/* Judges need working credentials; the hackathon brief requires them. */}
      <div className="mt-4 rounded-lg border border-border bg-surface-2 p-3">
        <p className="text-xs font-medium text-fg-muted">Demo accounts</p>
        <div className="mt-2 space-y-1.5">
          {DEMO.map((d) => (
            <button
              key={d.email}
              type="button"
              onClick={() => useDemo(d.email)}
              className="flex w-full cursor-pointer items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-surface"
            >
              <span>
                <span className="font-medium text-fg">{d.role}</span>
                <span className="ml-2 font-mono text-fg-muted">{d.email}</span>
              </span>
              <span className="shrink-0 text-fg-muted">{d.note}</span>
            </button>
          ))}
        </div>
        <p className="mt-2 border-t border-border pt-2 font-mono text-xs text-fg-muted">
          Password: {DEMO_PASSWORD}
        </p>
      </div>
    </AuthLayout>
  );
}
