import axios from 'axios';

const TOKEN_KEY = 'resolveai-token';

/**
 * Token storage.
 *
 * localStorage is XSS-reachable. It is chosen here because the SPA and API are
 * on different origins (Vercel and Render), where an httpOnly cookie needs
 * SameSite=None plus credentialed CORS — more moving parts than a one-day build
 * should carry. Mitigations: short token lifetime, no dangerouslySetInnerHTML
 * anywhere, React's default escaping, CSP from helmet. Documented as a residual
 * risk in docs/SECURITY.md rather than hidden.
 *
 * Every accessor is guarded: private mode and blocked site data both throw.
 */
export const tokenStore = {
  get() {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token) {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* session-only if storage is unavailable */
    }
  },
  clear() {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* nothing to clean up */
    }
  },
};

export const api = axios.create({
  baseURL: `${import.meta.env.VITE_API_URL ?? 'http://localhost:5000'}/api`,
  // Generous, because Render's free tier cold-starts in 30-60s and an AI
  // analyze can walk a provider chain. The UI shows a waking state rather than
  // failing a request the backend would have answered.
  timeout: 60_000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = tokenStore.get();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/** Set by the auth provider so a 401 can bounce the user to /login. */
let onUnauthorized = null;
export const setUnauthorizedHandler = (fn) => {
  onUnauthorized = fn;
};

api.interceptors.response.use(
  (res) => res,
  (error) => {
    // An expired or revoked token must not leave the user staring at a broken
    // page. Clear it and let the app route to login.
    if (error.response?.status === 401) {
      tokenStore.clear();
      onUnauthorized?.();
    }
    return Promise.reject(error);
  }
);

/**
 * Turn any axios failure into a message safe to render.
 *
 * The backend already returns { error: { code, message } } with nothing
 * sensitive in it. This only has to cover the cases where no response arrived.
 *
 * @param {unknown} error
 * @returns {string}
 */
export function errorMessage(error) {
  const payload = error?.response?.data?.error;
  if (payload?.message) {
    const details = payload.details;
    if (Array.isArray(details) && details.length) {
      return `${payload.message}: ${details.map((d) => d.message ?? d).join(', ')}`;
    }
    return payload.message;
  }
  if (error?.code === 'ECONNABORTED') {
    return 'The request timed out. The server may be waking up — please try again.';
  }
  if (error?.message === 'Network Error') {
    return 'Cannot reach the server. Check your connection and try again.';
  }
  return 'Something went wrong. Please try again.';
}

// --- resource helpers --------------------------------------------------------
// Thin wrappers so pages never assemble URLs by hand and a route change has one
// place to land.

const unwrap = (p) => p.then((r) => r.data);

export const authApi = {
  login: (body) => unwrap(api.post('/auth/login', body)),
  me: () => unwrap(api.get('/auth/me')),
  updateProfile: (body) => unwrap(api.patch('/auth/me', body)),
  changePassword: (body) => unwrap(api.post('/auth/change-password', body)),
};

export const customersApi = {
  list: (params) => unwrap(api.get('/customers', { params })),
  get: (id) => unwrap(api.get(`/customers/${id}`)),
};

export const ordersApi = {
  list: (params) => unwrap(api.get('/orders', { params })),
  get: (id) => unwrap(api.get(`/orders/${id}`)),
};

export const incidentsApi = {
  list: (params) => unwrap(api.get('/incidents', { params })),
  get: (id) => unwrap(api.get(`/incidents/${id}`)),
  create: (body) => unwrap(api.post('/incidents', body)),
  update: (id, body) => unwrap(api.patch(`/incidents/${id}`, body)),
  archive: (id) => unwrap(api.delete(`/incidents/${id}`)),
};

export const agentApi = {
  analyze: (body) => unwrap(api.post('/agent/analyze', body)),
  resolve: (body) => unwrap(api.post('/agent/resolve', body)),
  chat: (body) => unwrap(api.post('/agent/chat', body)),
  context: (params) => unwrap(api.get('/agent/context', { params })),
};

export const actionsApi = {
  list: (params) => unwrap(api.get('/actions', { params })),
  get: (id) => unwrap(api.get(`/actions/${id}`)),
  guardrails: () => unwrap(api.get('/actions/guardrails')),
  approve: (id) => unwrap(api.post(`/actions/${id}/approve`)),
  reject: (id, body) => unwrap(api.post(`/actions/${id}/reject`, body)),
};

export const knowledgeApi = {
  list: (params) => unwrap(api.get('/knowledge', { params })),
  get: (id) => unwrap(api.get(`/knowledge/${id}`)),
  create: (body) => unwrap(api.post('/knowledge', body)),
  update: (id, body) => unwrap(api.patch(`/knowledge/${id}`, body)),
  deactivate: (id) => unwrap(api.delete(`/knowledge/${id}`)),
};

export const analyticsApi = {
  overview: () => unwrap(api.get('/analytics/overview')),
  incidents: (params) => unwrap(api.get('/analytics/incidents', { params })),
};

export const simulatorApi = {
  run: (scenario) => unwrap(api.post(`/simulator/${scenario}`)),
};

export const healthApi = {
  check: () => unwrap(api.get('/health')),
};
