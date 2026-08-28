import { useState } from 'react';
import { CheckCircle2, Cpu } from 'lucide-react';
import { useApi, useAction } from '../hooks/useApi.js';
import { authApi, healthApi } from '../services/api.js';
import { useAuth } from '../hooks/useAuth.jsx';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  Field,
  Input,
  LoadingState,
} from '../components/ui/index.jsx';

export default function SettingsPage() {
  const { user, setUser } = useAuth();
  const health = useApi(() => healthApi.check(), []);

  const [profile, setProfile] = useState({ fullName: user?.fullName ?? '', email: user?.email ?? '' });
  const [profileSaved, setProfileSaved] = useState(false);

  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [pwSaved, setPwSaved] = useState(false);
  const [pwMismatch, setPwMismatch] = useState(null);

  const updateProfile = useAction(authApi.updateProfile);
  const changePassword = useAction(authApi.changePassword);

  const saveProfile = async (e) => {
    e.preventDefault();
    setProfileSaved(false);
    const res = await updateProfile.execute(profile);
    if (res.ok) {
      setUser(res.data.data);
      setProfileSaved(true);
    }
  };

  const savePassword = async (e) => {
    e.preventDefault();
    setPwSaved(false);
    // Checked here purely so the user is not told about it by a round trip.
    // The server enforces the real password rules regardless.
    if (pw.newPassword !== pw.confirm) {
      setPwMismatch('The new passwords do not match');
      return;
    }
    setPwMismatch(null);
    const res = await changePassword.execute({
      currentPassword: pw.currentPassword,
      newPassword: pw.newPassword,
    });
    if (res.ok) {
      setPw({ currentPassword: '', newPassword: '', confirm: '' });
      setPwSaved(true);
    }
  };

  const providers = health.data?.aiProviders;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-0.5 text-sm text-fg-muted">Your account and the system's AI configuration.</p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Profile" subtitle={`Signed in as ${user?.role}`} />
          <CardBody>
            <form onSubmit={saveProfile} className="space-y-4" noValidate>
              {updateProfile.error && (
                <div role="alert" className="rounded-md border border-high/40 bg-high-soft px-3 py-2 text-sm text-high">
                  {updateProfile.error}
                </div>
              )}
              {profileSaved && (
                <p className="flex items-center gap-1.5 rounded-md border border-low/40 bg-low-soft px-3 py-2 text-sm text-low">
                  <CheckCircle2 size={14} aria-hidden="true" />
                  Profile updated
                </p>
              )}

              <Field label="Full name" htmlFor="settings-name" required>
                {(a) => (
                  <Input
                    {...a}
                    required
                    value={profile.fullName}
                    onChange={(e) => setProfile({ ...profile, fullName: e.target.value })}
                  />
                )}
              </Field>

              <Field label="Email" htmlFor="settings-email" required>
                {(a) => (
                  <Input
                    {...a}
                    type="email"
                    required
                    autoComplete="username"
                    value={profile.email}
                    onChange={(e) => setProfile({ ...profile, email: e.target.value })}
                  />
                )}
              </Field>

              <Button type="submit" loading={updateProfile.pending}>
                Save profile
              </Button>
            </form>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Change password" />
          <CardBody>
            <form onSubmit={savePassword} className="space-y-4" noValidate>
              {(changePassword.error || pwMismatch) && (
                <div role="alert" className="rounded-md border border-high/40 bg-high-soft px-3 py-2 text-sm text-high">
                  {pwMismatch ?? changePassword.error}
                </div>
              )}
              {pwSaved && (
                <p className="flex items-center gap-1.5 rounded-md border border-low/40 bg-low-soft px-3 py-2 text-sm text-low">
                  <CheckCircle2 size={14} aria-hidden="true" />
                  Password changed
                </p>
              )}

              <Field label="Current password" htmlFor="settings-current-pw" required>
                {(a) => (
                  <Input
                    {...a}
                    type="password"
                    required
                    autoComplete="current-password"
                    value={pw.currentPassword}
                    onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })}
                  />
                )}
              </Field>

              <Field label="New password" htmlFor="settings-new-pw" required hint="At least 8 characters">
                {(a) => (
                  <Input
                    {...a}
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={pw.newPassword}
                    onChange={(e) => setPw({ ...pw, newPassword: e.target.value })}
                  />
                )}
              </Field>

              <Field label="Confirm new password" htmlFor="settings-confirm-pw" required>
                {(a) => (
                  <Input
                    {...a}
                    type="password"
                    required
                    autoComplete="new-password"
                    value={pw.confirm}
                    onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
                  />
                )}
              </Field>

              <Button type="submit" loading={changePassword.pending}>
                Change password
              </Button>
            </form>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="AI configuration"
          subtitle="Provider chain, tried in order, then a deterministic fallback"
        />
        <CardBody>
          {health.loading ? (
            <LoadingState rows={2} />
          ) : health.error ? (
            <ErrorState message={health.error} onRetry={health.refetch} />
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Cpu size={15} className="text-fg-muted" aria-hidden="true" />
                <Badge
                  tone={
                    health.data.aiConfigured
                      ? 'text-low bg-low-soft border-low/40'
                      : 'text-medium bg-medium-soft border-medium/40'
                  }
                >
                  {health.data.aiConfigured ? 'AI configured' : 'Fallback only'}
                </Badge>
                <span className="text-sm text-fg-muted">Environment: {health.data.env}</span>
              </div>

              {providers && (
                <dl className="grid grid-cols-3 gap-3 border-t border-border pt-3 text-sm">
                  {[
                    ['Gemini', providers.gemini],
                    ['Groq', providers.groq],
                    ['OpenRouter', providers.openrouter],
                  ].map(([name, count]) => (
                    <div key={name}>
                      <dt className="text-xs uppercase tracking-wide text-fg-muted">{name}</dt>
                      <dd className="font-mono text-lg tabular">
                        {count} <span className="text-xs text-fg-muted">key{count === 1 ? '' : 's'}</span>
                      </dd>
                    </div>
                  ))}
                </dl>
              )}

              <p className="border-t border-border pt-3 text-xs text-fg-muted">
                API keys live only on the server. The browser never holds a model key, a database
                service-role key, or the JWT signing secret — it only knows this API's URL.
              </p>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
