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

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));

    if (!tokenStore.get()) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    authApi
      .me()
      .then(({ data }) => {
        if (!cancelled) setUser(data);
      })
      .catch(() => {
        // Expired or revoked. The interceptor has already cleared the token.
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email, password) => {
    try {
      const { data } = await authApi.login({ email, password });
      tokenStore.set(data.token);
      setUser(data.user);
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
    [user, loading, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
