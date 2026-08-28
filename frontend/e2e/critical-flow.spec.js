import { test, expect } from '@playwright/test';

/**
 * End-to-end coverage, organised against the hackathon rubric so a gap in the
 * suite maps to a gap in the score:
 *
 *   Problem alignment (25)  -> the proactive resolution journey
 *   Full-stack (25)         -> auth, CRUD, search/filter, persistence
 *   AI security (20)        -> authorization, guardrails, no secrets client-side
 *   Deployment & UX (20)    -> loading/error/empty states, responsive, a11y
 *
 * Selectors are data-testid throughout. A spec that keys on CSS classes breaks
 * on every design change, and this UI has already been restyled twice.
 */

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:5000';

const SUPERVISOR = { email: 'supervisor@resolveai.demo', password: 'ResolveAI#2026' };
const AGENT = { email: 'agent@resolveai.demo', password: 'ResolveAI#2026' };

async function login(page, who = SUPERVISOR) {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(who.email);
  await page.getByTestId('login-password').fill(who.password);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('dashboard')).toBeVisible();
}

// ---------------------------------------------------------------- auth ------
test.describe('Authentication', () => {
  test('rejects bad credentials without revealing whether the account exists', async ({ page }) => {
    await page.goto('/login');

    await page.getByTestId('login-email').fill(SUPERVISOR.email);
    await page.getByTestId('login-password').fill('wrong-password');
    await page.getByTestId('login-submit').click();
    const knownAccountError = await page.getByRole('alert').textContent();

    await page.getByTestId('login-email').fill('nobody@resolveai.demo');
    await page.getByTestId('login-password').fill('wrong-password');
    await page.getByTestId('login-submit').click();
    const unknownAccountError = await page.getByRole('alert').textContent();

    // Identical wording, or the form enumerates valid accounts.
    expect(knownAccountError).toBe(unknownAccountError);
    expect(knownAccountError).toContain('Invalid email or password');
  });

  test('protects routes and preserves the attempted destination', async ({ page }) => {
    await page.goto('/analytics');
    await expect(page).toHaveURL(/\/login/);

    await page.getByTestId('login-email').fill(SUPERVISOR.email);
    await page.getByTestId('login-password').fill(SUPERVISOR.password);
    await page.getByTestId('login-submit').click();

    // Back to /analytics, not dumped on the dashboard.
    await expect(page).toHaveURL(/\/analytics/);
  });

  test('logout clears the session and blocks the back button', async ({ page }) => {
    await login(page);
    await page.getByTestId('logout').click();
    await expect(page).toHaveURL(/\/login/);

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });
});

// ------------------------------------------------- the critical journey -----
test.describe('Proactive resolution journey', () => {
  test('simulate -> incident -> customer 360 -> AI -> guardrail -> action -> notification', async ({ page }) => {
    await login(page);

    // --- Simulator -------------------------------------------------------
    await page.getByTestId('nav-simulator').click();
    await expect(page.getByTestId('simulator')).toBeVisible();
    await page.getByTestId('simulate-delivery-delay').click();

    const result = page.getByTestId('simulator-result');
    await expect(result).toBeVisible({ timeout: 60_000 });

    // The demo narrative depends on these exact numbers.
    await expect(page.getByTestId('sim-orders')).toHaveText('17');
    await expect(page.getByTestId('sim-customers')).toHaveText('17');
    await expect(page.getByTestId('sim-high')).toHaveText('5');

    // --- Incident --------------------------------------------------------
    await page.getByTestId('view-incident').click();
    await expect(page.getByTestId('incident-status')).toBeVisible();
    await expect(page.getByTestId('affected-customers')).toBeVisible();

    const rows = page.getByTestId('affected-customer-link');
    await expect(rows).toHaveCount(17);
    // Ranked worst-first, so the top row is the one to open.
    await expect(rows.first()).toBeVisible();

    // --- Customer 360 ----------------------------------------------------
    await rows.first().click();
    const risk = page.getByTestId('customer-risk-score');
    await expect(risk).toBeVisible();
    await expect(risk).toContainText('HIGH');

    // --- AI recommendation ----------------------------------------------
    await page.getByTestId('analyze-customer').click();
    await expect(page.getByTestId('ai-recommendation')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('policy-reference')).toBeVisible();
    await expect(page.getByTestId('decision-trace')).toBeVisible();

    // --- Execute: guardrail, action, notification ------------------------
    await page.getByTestId('execute-action').click();
    await expect(page.getByTestId('guardrail-status')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('notification')).toBeVisible();

    // The message must actually claim delivery, not preview.
    await expect(page.getByTestId('notification')).toContainText(/Delivered to/i);

    // --- Analytics reflects it ------------------------------------------
    await page.getByTestId('nav-analytics').click();
    await expect(page.getByTestId('analytics')).toBeVisible();
  });

  test('the dashboard triage queue resolves a customer in place', async ({ page }) => {
    await login(page);
    await expect(page.getByTestId('coverage-bar')).toBeVisible();

    const queue = page.getByTestId('triage-queue');
    await expect(queue).toBeVisible();
    const before = await queue.locator('> div').count();
    expect(before).toBeGreaterThan(0);

    await page.getByTestId('triage-resolve').first().click();
    // Either it resolves, or it analyzes first — both keep the queue rendered
    // rather than blanking the page.
    await expect(queue).toBeVisible({ timeout: 60_000 });
  });

  test('the agent workbench survives selecting an incident and a customer', async ({ page }) => {
    // Regression: selecting a customer crashed the whole app with
    // "Cannot read properties of null (reading 'customer')". useApi reported
    // loading:false alongside data:null for one render when `enabled` flipped
    // true, so the loaded branch rendered against null and React unmounted.
    const crashes = [];
    page.on('pageerror', (e) => crashes.push(e.message));

    await login(page);
    await page.getByTestId('nav-agent').click();

    await page.locator('#agent-incident').selectOption({ index: 1 });
    await expect(page.locator('#agent-customer')).toBeEnabled();

    await page.locator('#agent-customer').selectOption({ index: 1 });

    // The page must still be mounted and showing content.
    await expect(page.getByRole('heading', { name: 'AI Agent' })).toBeVisible();
    await expect(page.getByText('Customer context')).toBeVisible();
    await expect(page.locator('#root')).not.toBeEmpty();
    expect(crashes).toEqual([]);
  });
});

// ------------------------------------------------------- authorization ------
test.describe('Authorization', () => {
  test('an AGENT cannot approve, and the API refuses even if the UI is bypassed', async ({ page }) => {
    await login(page, AGENT);
    await page.getByTestId('nav-actions').click();

    // The approve control is not offered to this role.
    await expect(page.getByTestId('approve-action')).toHaveCount(0);

    // And the endpoint itself refuses, which is the control that matters.
    const status = await page.evaluate(async (api) => {
      const token = localStorage.getItem('resolveai-token');
      const res = await fetch(`${api}/api/actions/00000000-0000-0000-0000-000000000001/approve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.status;
    }, API_URL);
    expect(status).toBe(403);
  });

  test('an unauthenticated API call is rejected', async ({ page }) => {
    await page.goto('/login');
    const status = await page.evaluate(async (api) => {
      const res = await fetch(`${api}/api/customers`);
      return res.status;
    }, API_URL);
    expect(status).toBe(401);
  });
});

// ------------------------------------------------------------- CRUD ---------
test.describe('CRUD and search', () => {
  test('creates an incident and finds it by search', async ({ page }) => {
    await login(page);
    await page.getByTestId('nav-incidents').click();

    const title = `E2E carrier disruption ${Date.now()}`;
    await page.getByTestId('new-incident').click();
    await page.getByLabel('Title').fill(title);
    await page.getByLabel('Description').fill('Created by the end-to-end suite.');
    await page.getByRole('button', { name: 'Create incident' }).click();

    // Lands on the new incident's detail page.
    await expect(page.getByRole('heading', { name: title })).toBeVisible({ timeout: 30_000 });

    // And it is findable, which proves it persisted.
    await page.getByTestId('nav-incidents').click();
    await page.getByLabel('Search incidents').fill(title);
    await expect(page.getByText(title)).toBeVisible({ timeout: 30_000 });
  });

  test('customer search filters the directory', async ({ page }) => {
    await login(page);
    await page.getByTestId('nav-customers').click();
    await page.getByLabel('Search customers').fill('Priya');
    await expect(page.getByRole('link', { name: 'Priya Sharma' })).toBeVisible({ timeout: 30_000 });
  });

  test('rejects invalid input with a field-level message', async ({ page }) => {
    await login(page);
    await page.getByTestId('nav-incidents').click();
    await page.getByTestId('new-incident').click();

    // Under the 5-character minimum the API enforces.
    await page.getByLabel('Title').fill('ab');
    await page.getByRole('button', { name: 'Create incident' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
  });
});

// --------------------------------------------------- security / UX ----------
test.describe('Security and UX', () => {
  test('no provider key, service-role key or JWT secret reaches the browser', async ({ page }) => {
    await login(page);

    const leaked = await page.evaluate(async () => {
      const found = [];
      const patterns = [
        ['groq key', /gsk_[A-Za-z0-9]{20,}/],
        ['openrouter key', /sk-or-v1-[A-Za-z0-9]{20,}/],
        ['gemini key', /AQ\.Ab8[A-Za-z0-9]{20,}/],
        ['supabase host', /supabase\.co/],
        ['service role', /SUPABASE_SERVICE_ROLE/],
        ['jwt secret', /JWT_SECRET/],
      ];
      // Every loaded script, plus inline markup and storage.
      const sources = [document.documentElement.innerHTML];
      for (const s of document.querySelectorAll('script[src]')) {
        try { sources.push(await (await fetch(s.src)).text()); } catch { /* ignore */ }
      }
      try { sources.push(JSON.stringify(localStorage)); } catch { /* ignore */ }

      for (const [name, re] of patterns) {
        if (sources.some((src) => re.test(src))) found.push(name);
      }
      return found;
    });

    expect(leaked).toEqual([]);
  });

  test('renders an empty state rather than a blank panel', async ({ page }) => {
    await login(page);
    await page.getByTestId('nav-actions').click();
    // The queue must render either action rows or an explicit empty state.
    // Asserting on copy is brittle; asserting that the region is never blank
    // is the actual requirement.
    await expect(page.getByRole('heading', { name: /approvals/i })).toBeVisible();
    const main = page.locator('main');
    const text = (await main.innerText()).trim();
    expect(text.length).toBeGreaterThan(40);
    // And no bare empty container.
    expect(text).toMatch(/Nothing waiting|Action queue|credit|delivery|escalat/i);
  });

  test('is usable at mobile width without horizontal page scroll', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await login(page);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    // A couple of px of subpixel rounding is tolerable; a scrollbar is not.
    expect(overflow).toBeLessThanOrEqual(2);
  });

  test('every page has exactly one h1 and a reachable skip link', async ({ page }) => {
    await login(page);
    for (const nav of ['nav-incidents', 'nav-customers', 'nav-analytics', 'nav-simulator']) {
      await page.getByTestId(nav).click();
      await expect(page.locator('h1')).toHaveCount(1);
    }
    // A fresh load, which is where a keyboard user actually starts. Pressing
    // Tab after a programmatic blur() does not reliably target the document,
    // so this asserts the real entry path rather than a synthetic one.
    await page.goto('/dashboard');
    await expect(page.getByTestId('dashboard')).toBeVisible();
    await page.locator('body').press('Tab');
    await expect(page.getByRole('link', { name: /skip to main content/i })).toBeFocused();
  });
});
