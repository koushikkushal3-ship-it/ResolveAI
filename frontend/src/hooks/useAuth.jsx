import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authApi, tokenStore, setUnauthorizedHandler, errorMessage } from '../services/api.js';

const AuthContext = createContext(null);

const RANK = { AGENT: 1, SUPERVISOR: 2, ADMIN: 3 };

/**
 * Authentication state.
 *
 * Context plus a hook, not a state library: there is exactly one piece of
 * global state in this app and it changes twice per session.
 *
 * The session is confirmed by calling /auth/me on mount rather than trusting
 * the stored token's contents. A JWT is signed but readable and editable by
 * anyone holding it, so the role it claims is not evidence of anything — the
 * server's answer is.
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  /** The backend is asleep or restarting; the session is probably still fine. */
  const [waking, setWaking] = useState(false);
  /** Retries exhausted. The token is kept; the UI shows a real error. */
  const [connectionError, setConnectionError] = useState(false);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));

    if (!tokenStore.get()) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    /**
     * Restore the session, distinguishing "your token is bad" from "the server
     * did not answer".
     *
     * Treating both as unauthenticated silently logs the user out whenever the
     * API is briefly unreachable — which on a free-tier host is *every* cold
     * start. The token is still perfectly valid; only the network failed.
     *
     * A 401/403 clears the session. Anything else is retried while the backend
     * wakes, and the token is kept.
     */
    const restore = async (attempt = 0) => {
      try {
        const { data } = await authApi.me();
        if (!cancelled) {
          setUser(data);
          setWaking(false);
          setLoading(false);
        }
      } catch (error) {
        if (cancelled) return;
        const status = error?.response?.status;

        if (status === 401 || status === 403) {
          tokenStore.clear();
          setUser(null);
          setWaking(false);
          setLoading(false);
          return;
        }

        // No response: the server is asleep, restarting, or unreachable.
        // Render's free tier takes 30-60s to wake, so back off and keep trying.
        if (attempt < 3) {
          setWaking(true);
          setTimeout(() => restore(attempt + 1), 4000 * (attempt + 1));
          return;
        }

        // Out of retries. Keep the token — it is probably still valid — but
        // stop blocking the UI so the user sees a real error instead of a
        // spinner that never resolves.
        setWaking(false);
        setLoading(false);
        setConnectionError(true);
      }
    };

    restore();

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email, password) => {
    try {
      const { data } = await authApi.login({ email, password });
      tokenStore.set(data.token);
      setUser(data.user);
      setConnectionError(false);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  }, []);

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      waking,
      connectionError,
      login,
      logout,
      setUser,
      isAuthenticated: Boolean(user),
      /**
       * Role check for SHOWING controls. Never a security boundary — the API
       * re-checks every one of these server-side, and hiding a button only
       * saves the user a pointless 403.
       */
      hasRole: (minimum) => (RANK[user?.role] ?? 0) >= (RANK[minimum] ?? 99),
    }),
    [user, loading, waking, connectionError, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
