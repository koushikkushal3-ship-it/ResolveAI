import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '../services/api.js';

/**
 * Data fetching for a page or panel.
 *
 * Deliberately not a caching library. Every screen here reads live operational
 * state that a simulator run or an approval can change a second later, so a
 * stale-while-revalidate cache would show numbers that are quietly wrong —
 * which is precisely the failure mode this product exists to prevent.
 *
 * Returns loading / error / data so a caller can render all three states, and
 * `refetch` so an action can refresh what it changed.
 *
 * @param {() => Promise<{data: unknown, meta?: unknown}>} fetcher
 * @param {Array} deps
 * @param {{ enabled?: boolean }} [options]
 */
export function useApi(fetcher, deps = [], { enabled = true } = {}) {
  const [state, setState] = useState({ data: null, meta: null, loading: enabled, error: null });

  // Held in a ref so a new fetcher identity on every render does not re-run the
  // effect; deps control that instead.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const run = useCallback(async (signal) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const result = await fetcherRef.current();
      if (signal?.aborted) return;
      setState({ data: result?.data ?? result, meta: result?.meta ?? null, loading: false, error: null });
    } catch (error) {
      if (signal?.aborted) return;
      setState({ data: null, meta: null, loading: false, error: errorMessage(error) });
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setState({ data: null, meta: null, loading: false, error: null });
      return undefined;
    }
    // Guards against a slow response landing after the user has navigated away
    // or changed a filter — the classic out-of-order render.
    const controller = new AbortController();
    run(controller.signal);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  const refetch = useCallback(() => run(), [run]);

  /**
   * Close the enabled-transition gap.
   *
   * While disabled the state is { data: null, loading: false }. When `enabled`
   * flips true, React re-renders BEFORE the effect runs — so for one render the
   * caller sees loading:false alongside data:null and takes its "loaded"
   * branch, which then dereferences null and throws.
   *
   * That is not hypothetical: selecting a customer on /agent crashed the whole
   * app with "Cannot read properties of null (reading 'customer')", unmounting
   * React entirely and leaving a blank page.
   *
   * Deriving loading rather than storing it means there is no window in which
   * "enabled, no data, no error" reads as loaded.
   */
  const loading = state.loading || (enabled && state.data === null && state.error === null);

  return { ...state, loading, refetch };
}

/**
 * A one-shot action (approve, resolve, simulate) with its own pending state.
 *
 * Separate from useApi because a mutation must not clear the data already on
 * screen while it runs — the user needs to see what they are acting on.
 *
 * @param {(...args: any[]) => Promise<any>} action
 */
export function useAction(action) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  const execute = useCallback(
    async (...args) => {
      setPending(true);
      setError(null);
      try {
        return { ok: true, data: await action(...args) };
      } catch (err) {
        const message = errorMessage(err);
        setError(message);
        return { ok: false, error: message };
      } finally {
        setPending(false);
      }
    },
    [action]
  );

  return { execute, pending, error, clearError: () => setError(null) };
}

/**
 * Debounce a rapidly changing value, so a search box does not fire a request
 * per keystroke.
 *
 * @param {any} value
 * @param {number} delay
 */
export function useDebounced(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
