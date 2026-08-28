import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-bg p-6 text-center">
      <p className="font-mono text-4xl font-semibold text-fg-muted">404</p>
      <div>
        <h1 className="text-lg font-semibold">Page not found</h1>
        <p className="mt-1 text-sm text-fg-muted">That route does not exist in ResolveAI.</p>
      </div>
      <Link
        to="/dashboard"
        className="inline-flex h-10 items-center rounded-md bg-brand-fill px-4 text-sm font-medium text-on-brand transition-opacity hover:opacity-90"
      >
        Back to dashboard
      </Link>
    </div>
  );
}
