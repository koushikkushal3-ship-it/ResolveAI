import { Component } from 'react';
import { AlertTriangle } from 'lucide-react';

/**
 * Error boundary.
 *
 * Without one, a single render-time throw anywhere in the tree unmounts React
 * completely and leaves a blank white page with no explanation and no way
 * forward. That is exactly what a null dereference on the agent page did.
 *
 * Fixing the specific bug was necessary; this makes the *class* of bug
 * survivable. A crash now degrades to a message and a reload, not a void.
 *
 * Class component because React has no hook equivalent for componentDidCatch.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Server-side reporting would go here. Logging locally at least means the
    // stack is recoverable from a user's console rather than lost entirely.
    console.error('[ErrorBoundary]', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg p-6">
        <div className="w-full max-w-md text-center">
          <AlertTriangle size={26} className="mx-auto text-high" aria-hidden="true" />
          <h1 className="t-title mt-4">Something broke on this screen</h1>
          <p className="t-body mt-2 text-fg-muted">
            The rest of the application is unaffected. Reloading usually clears it.
          </p>

          <div className="mt-5 flex justify-center gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex h-8 cursor-pointer items-center rounded-md bg-brand-fill px-3 text-[13px] font-medium text-on-brand transition-[filter] duration-100 hover:brightness-110"
            >
              Reload
            </button>
            <button
              type="button"
              onClick={() => window.location.assign('/dashboard')}
              className="inline-flex h-8 cursor-pointer items-center rounded-md border border-border-strong px-3 text-[13px] font-medium text-fg transition-colors duration-100 hover:bg-surface-2"
            >
              Back to dashboard
            </button>
          </div>

          {/* The message, but never the stack — a stack trace on screen is
              noise to a user and detail to an attacker. */}
          <p className="mt-5 font-mono text-[11px] text-fg-muted wrap-anywhere">
            {String(this.state.error?.message ?? this.state.error).slice(0, 160)}
          </p>
        </div>
      </div>
    );
  }
}
