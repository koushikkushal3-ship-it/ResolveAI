import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import { AppShell } from '../layouts/AppShell.jsx';
import { LoadingState } from '../components/ui/index.jsx';

import LoginPage from '../pages/LoginPage.jsx';
import DashboardPage from '../pages/DashboardPage.jsx';
import CustomersPage from '../pages/CustomersPage.jsx';
import CustomerDetailPage from '../pages/CustomerDetailPage.jsx';
import IncidentsPage from '../pages/IncidentsPage.jsx';
import IncidentDetailPage from '../pages/IncidentDetailPage.jsx';
import AgentPage from '../pages/AgentPage.jsx';
import ActionsPage from '../pages/ActionsPage.jsx';
import AnalyticsPage from '../pages/AnalyticsPage.jsx';
import SimulatorPage from '../pages/SimulatorPage.jsx';
import KnowledgePage from '../pages/KnowledgePage.jsx';
import SettingsPage from '../pages/SettingsPage.jsx';
import NotFoundPage from '../pages/NotFoundPage.jsx';

/**
 * Route guard.
 *
 * A convenience, not a security control: every protected endpoint re-checks
 * the token server-side. This only stops an unauthenticated user from staring
 * at a shell that cannot load any data.
 *
 * The attempted location is preserved so a deep link survives the login
 * detour — landing on the dashboard after clicking a customer link is a small
 * betrayal the user notices.
 */
function RequireAuth({ children }) {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-dvh bg-bg p-8">
        <LoadingState label="Restoring your session…" rows={4} />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/customers/:id" element={<CustomerDetailPage />} />
        <Route path="/incidents" element={<IncidentsPage />} />
        <Route path="/incidents/:id" element={<IncidentDetailPage />} />
        <Route path="/agent" element={<AgentPage />} />
        <Route path="/actions" element={<ActionsPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/simulator" element={<SimulatorPage />} />
        <Route path="/knowledge" element={<KnowledgePage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
