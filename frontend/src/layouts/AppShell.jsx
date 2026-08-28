import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  BarChart3,
  BookOpen,
  Bot,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Settings,
  ShieldCheck,
  Sun,
  Users,
  Zap,
  X,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth.jsx';
import { Button, cx } from '../components/ui/index.jsx';
import { initials } from '../utils/format.js';
import { LogoMark } from '../components/Logo.jsx';

/**
 * Navigation, grouped by the stage of the loop each screen belongs to.
 *
 * A flat list of nine links makes the reader scan all nine. Grouping by
 * Monitor / Resolve / Configure means the eye lands in the right third first.
 */
const NAV_GROUPS = [
  {
    label: 'Monitor',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, testId: 'nav-dashboard' },
      { to: '/incidents', label: 'Incidents', icon: Activity, testId: 'nav-incidents' },
      { to: '/customers', label: 'Customers', icon: Users, testId: 'nav-customers' },
    ],
  },
  {
    label: 'Resolve',
    items: [
      { to: '/agent', label: 'AI Agent', icon: Bot, testId: 'nav-agent' },
      { to: '/actions', label: 'Approvals', icon: ShieldCheck, testId: 'nav-actions' },
      { to: '/simulator', label: 'Simulator', icon: Zap, testId: 'nav-simulator' },
    ],
  },
  {
    label: 'Configure',
    items: [
      { to: '/analytics', label: 'Analytics', icon: BarChart3, testId: 'nav-analytics' },
      { to: '/knowledge', label: 'Policies', icon: BookOpen, testId: 'nav-knowledge' },
      { to: '/settings', label: 'Settings', icon: Settings, testId: 'nav-settings' },
    ],
  },
];

const THEME_KEY = 'resolveai-theme';

/**
 * Theme toggle.
 *
 * Three states collapse to two here: an explicit choice is stored, and the
 * absence of one follows the OS. index.html applies the class before first
 * paint so there is no flash of the wrong theme on load.
 */
function ThemeToggle() {
  const [dark, setDark] = useState(() =>
    typeof document !== 'undefined' ? document.documentElement.classList.contains('dark') : true
  );

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem(THEME_KEY, next ? 'dark' : 'light');
    } catch {
      /* preference is session-only if storage is blocked */
    }
  };

  return (
    <Button variant="ghost" size="sm" onClick={toggle} aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}>
      {dark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
    </Button>
  );
}

function NavItems({ onNavigate }) {
  return (
    <nav aria-label="Main" className="space-y-5">
      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-muted">
            {group.label}
          </p>
          <div className="space-y-0.5">
            {group.items.map(({ to, label, icon: Icon, testId }) => (
              <NavLink
                key={to}
                to={to}
                data-testid={testId}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cx(
                    'relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors duration-150',
                    isActive
                      ? 'bg-brand/10 font-medium text-brand'
                      : 'text-fg-muted hover:bg-surface-2 hover:text-fg'
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {/* An accent rail, not just a tint: the current location
                        stays obvious at a glance and in high-contrast modes. */}
                    {isActive && (
                      <span
                        className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-brand"
                        aria-hidden="true"
                      />
                    )}
                    <Icon size={16} aria-hidden="true" />
                    {label}
                    {/* Current location must be announced, not only coloured. */}
                    {isActive && <span className="sr-only">(current page)</span>}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

/**
 * Application shell.
 *
 * Sidebar at >=1024px, slide-over drawer below. Navigation stays in the same
 * place on every page — moving it by page type is the fastest way to make an
 * app feel unreliable.
 */
export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close the drawer on navigation, so a tap on a link does not leave the
  // overlay covering the page it just opened.
  useEffect(() => setDrawerOpen(false), [location.pathname]);

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-dvh bg-bg text-fg">
      {/* Keyboard users should not have to tab through the whole nav first. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-brand-fill focus:px-3 focus:py-2 focus:text-on-brand"
      >
        Skip to main content
      </a>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-border bg-surface lg:flex">
        <div className="flex h-16 items-center gap-2.5 border-b border-border px-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-fill text-on-brand">
            <LogoMark size={19} />
          </span>
          <div className="min-w-0 leading-tight">
            <p className="font-semibold tracking-tight">ResolveAI</p>
            <p className="text-[10px] uppercase tracking-[0.12em] text-fg-muted">Command Center</p>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <NavItems />
        </div>
        <div className="border-t border-border p-3">
          <div className="mb-2 flex items-center gap-2.5 rounded-lg bg-surface-2 px-2.5 py-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-fill text-[11px] font-semibold text-on-brand">
              {initials(user?.fullName)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm text-fg">{user?.fullName}</p>
              <p className="text-[11px] uppercase tracking-wider text-fg-muted">{user?.role}</p>
            </div>
          </div>
          {/* Separated from navigation: a destructive control should not sit
              inline with ordinary links. */}
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            onClick={handleLogout}
            data-testid="logout"
          >
            <LogOut size={15} aria-hidden="true" />
            Sign out
          </Button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-border bg-surface px-4 lg:hidden">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation menu"
            aria-expanded={drawerOpen}
          >
            <Menu size={18} aria-hidden="true" />
          </Button>
          <span className="font-semibold tracking-tight">ResolveAI</span>
        </div>
        <ThemeToggle />
      </header>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-[var(--rai-scrim)]"
            aria-label="Close navigation menu"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="relative flex h-full w-64 flex-col border-r border-border bg-surface">
            <div className="flex h-14 items-center justify-between border-b border-border px-4">
              <span className="font-semibold">ResolveAI</span>
              <Button variant="ghost" size="sm" onClick={() => setDrawerOpen(false)} aria-label="Close">
                <X size={16} aria-hidden="true" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              <NavItems onNavigate={() => setDrawerOpen(false)} />
            </div>
            <div className="border-t border-border p-3">
              <p className="mb-2 px-1 text-xs text-fg-muted">
                {user?.fullName} · {user?.role}
              </p>
              <Button variant="ghost" size="sm" className="w-full justify-start" onClick={handleLogout}>
                <LogOut size={15} aria-hidden="true" />
                Sign out
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Desktop header sits inside the content column, beside the sidebar. */}
      <div className="lg:pl-64">
        <div className="sticky top-0 z-20 hidden h-16 items-center justify-between gap-2 border-b border-border bg-surface/85 px-6 backdrop-blur-md lg:flex">
          <span className="inline-flex items-center gap-2 text-xs text-fg-muted">
            <span className="pulse-dot bg-low" aria-hidden="true" />
            Live operational data
          </span>
          <ThemeToggle />
        </div>
        <main id="main" className="mx-auto max-w-[1440px] p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/** Minimal shell for the login screen. */
export function AuthLayout({ children }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg p-4">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
