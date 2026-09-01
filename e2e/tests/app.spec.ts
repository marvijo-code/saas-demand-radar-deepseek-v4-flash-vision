import { test, expect, type Page } from "@playwright/test";

const ADMIN = { email: "admin@acme.test", password: "AcmeAdmin!2026" };
const MEMBER = { email: "member@acme.test", password: "AcmeMember!2026" };

async function signIn(
  page: Page,
  account: { email: string; password: string } = ADMIN
): Promise<void> {
  await page.goto("/login");
  const form = page.getByTestId("login-form");
  await form.getByLabel("Email").fill(account.email);
  await form.getByLabel("Password").fill(account.password);
  await form.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("dashboard")).toBeVisible();
}

function nav(page: Page, name: string) {
  return page
    .getByTestId("app-shell")
    .locator(".app-nav")
    .getByRole("link", { name, exact: true });
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const width = Math.max(doc.scrollWidth, body.scrollWidth);
    return width - window.innerWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);
}

// Every interactive control (links, buttons, fields) must be at least 44px
// high with no horizontal document overflow. Off-screen controls inside the
// horizontally-scrollable nav are still measured so a zoomed-out page (which
// would shrink every tap target) is caught.
async function expectTouchTargets(page: Page): Promise<void> {
  const offenders = await page.evaluate(() => {
    const bad: string[] = [];
    document.querySelectorAll("a, button, input, select, textarea").forEach((el) => {
      const box = (el as HTMLElement).getBoundingClientRect();
      if (box.height > 0 && box.height < 44) {
        const label = (el as HTMLElement).textContent?.trim().slice(0, 20) || el.tagName;
        bad.push(`${el.tagName}.${el.className || ""}[${Math.round(box.height)}px] ${label}`);
      }
    });
    return bad;
  });
  expect(offenders, "interactive controls below 44px").toEqual([]);
}

test.describe("SaaS Demand Radar", () => {
  test("signs in and renders the overview dashboard", async ({ page }) => {
    await signIn(page);

    await expect(page.getByTestId("app-shell")).toBeVisible();
    await expect(page.getByTestId("dashboard")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /Top needs/ })).toBeVisible();
    await expect(page.getByTestId("app-shell").locator(".stat")).toHaveCount(4);

    const rows = page.locator(".need-row");
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeGreaterThan(0);
  });

  test("exposes all required data-testid hooks", async ({ page }) => {
    await signIn(page);
    await expect(page.getByTestId("dashboard")).toBeVisible();

    await page.goto("/login");
    await expect(page.getByTestId("login-form")).toBeVisible();

    await page.goto("/");
    await expect(page.getByTestId("dashboard")).toBeVisible();

    await page.goto("/needs");
    await expect(page.getByTestId("needs-list").first()).toBeVisible();

    await page.goto("/sources");
    await expect(page.getByTestId("source-runs")).toBeVisible();

    await page.goto("/feedback");
    await expect(page.getByTestId("feedback-learning")).toBeVisible();

    await page.goto("/settings");
    await expect(page.getByTestId("team-settings")).toBeVisible();

    await page.goto("/audit");
    await expect(page.getByTestId("audit-trail")).toBeVisible();
  });

  test("lists needs, filters them, and opens the need detail page", async ({ page }) => {
    await signIn(page);
    await nav(page, "Needs").click();
    await expect(page.getByTestId("needs-list").first()).toBeVisible();

    const initialCount = await page.locator(".need-row").count();
    expect(initialCount).toBeGreaterThan(0);

    // Platform filter narrows the list to in-window Reddit evidence and drops
    // the X-only need plus needs with no evidence in the 30d window.
    await page.getByLabel("Platform").selectOption("reddit");
    await expect(page.locator(".need-row")).toHaveCount(2);
    await expect(page.getByText("Reddit prospect finder for cold outreach")).toBeVisible();
    await expect(page.getByText("AI chatbot usage tracking")).toBeVisible();
    await expect(page.getByText("Recipe suggestion from food photo")).toHaveCount(0);

    // Reset the platform filter and search by keyword.
    await page.getByLabel("Platform").selectOption("");
    await page.getByLabel("Search").fill("Reddit");
    await expect(page.locator(".need-row")).toHaveCount(1);
    await expect(page.getByText("Reddit prospect finder for cold outreach")).toBeVisible();

    // Clear the search and open the top-ranked need's detail page.
    await page.getByLabel("Search").fill("");
    await page.locator(".need-title-link").first().click();
    await expect(page.getByTestId("need-detail")).toBeVisible();

    await expect(page.getByRole("heading", { name: /Score explanation/ })).toBeVisible();
    await expect(page.locator(".score-table")).toBeVisible();
    await expect(page.getByRole("heading", { name: /Trend history/ })).toBeVisible();
    await expect(page.locator(".trend-grid")).toBeVisible();
    await expect(page.getByRole("heading", { name: /Source evidence/ })).toBeVisible();
    expect(await page.locator(".evidence-row").count()).toBeGreaterThan(0);
    await expect(page.getByRole("heading", { name: /Feedback history/ })).toBeVisible();

    await nav(page, "Needs").click();
    await expect(page.getByTestId("needs-list").first()).toBeVisible();
  });

  test("ingests a source snapshot from the UI and records a run", async ({ page }) => {
    await signIn(page);
    await nav(page, "Sources").click();
    await expect(page.getByTestId("source-runs")).toBeVisible();

    // The "snapshot" adapter and a sample records payload are prefilled.
    await expect(page.getByLabel("Adapter")).toHaveValue("snapshot");
    await page.getByRole("button", { name: "Run ingestion" }).click();

    await expect(page.getByText(/new records/)).toBeVisible();
    expect(await page.locator("table.table tbody tr").count()).toBeGreaterThanOrEqual(1);
    await expect(page.locator("table.table tbody tr").first()).toContainText("snapshot");
  });

  test("saves evidence feedback, re-scores, and records a model version", async ({ page }) => {
    await signIn(page);
    await nav(page, "Needs").click();
    await expect(page.getByTestId("needs-list").first()).toBeVisible();

    // Open a need that has evidence so we can mark a row.
    await page.locator(".need-title-link").first().click();
    await expect(page.getByTestId("need-detail")).toBeVisible();
    expect(await page.locator(".evidence-row").count()).toBeGreaterThan(0);

    const evidence = page.locator("li.evidence-row").first();
    await evidence.getByRole("button", { name: "Irrelevant" }).click();
    await evidence.getByRole("button", { name: "Save feedback" }).click();
    await expect(page.locator(".toast")).toContainText("Feedback saved");

    await nav(page, "Feedback").click();
    await expect(page.getByTestId("feedback-learning")).toBeVisible();
    await expect(page.locator("ul.feedback-list li.feedback-row").first()).toBeVisible();

    await page.getByRole("button", { name: "Re-score model" }).click();
    await expect(page.getByText(/Saved ranking model/)).toBeVisible();
    await expect(page.locator("table.table tbody tr").first()).toBeVisible();
  });

  test("a member retains read access but cannot ingest sources (admin-only)", async ({ page }) => {
    await signIn(page, MEMBER);
    await expect(page.getByTestId("dashboard")).toBeVisible();

    await nav(page, "Sources").click();
    await expect(page.getByTestId("source-runs")).toBeVisible();
    await expect(page.getByLabel("Adapter")).toBeVisible();

    await page.getByRole("button", { name: "Run ingestion" }).click();
    await expect(page.getByText(/Admin role required/)).toBeVisible();
  });

  test("provides useful page titles, landmarks, associated labels, and keyboard focus", async ({ page }) => {
    await signIn(page);
    await expect(page).toHaveTitle(/Dashboard · SaaS Demand Radar/);
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("navigation")).toBeVisible();

    await nav(page, "Needs").click();
    await expect(page).toHaveTitle(/Needs · SaaS Demand Radar/);
    await expect(page.getByLabel("Search")).toBeVisible();
    await page.getByLabel("Search").focus();
    await expect(page.getByLabel("Search")).toBeFocused();

    await page.locator(".need-title-link").first().click();
    await expect(page).toHaveTitle(/Need detail · SaaS Demand Radar/);
  });

});

// Mobile emulation (not just a narrow desktop window) reproduces real device
// viewport behavior. Runs every required route and asserts that every
// interactive control is at least 44px high with no horizontal document
// overflow, at 390x844.
test.describe("mobile 390x844 touch targets and overflow", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });

  test("every interactive control on the required routes is at least 44px with no horizontal overflow", async ({ page }) => {
    await signIn(page);

    const routes: Array<{ path: string; ready: string }> = [
      { path: "/", ready: "dashboard" },
      { path: "/needs", ready: "needs-list" },
      { path: "/sources", ready: "source-runs" },
      { path: "/feedback", ready: "feedback-learning" },
      { path: "/settings", ready: "team-settings" },
      { path: "/audit", ready: "audit-trail" },
    ];

    for (const { path, ready } of routes) {
      await page.goto(path);
      await expect(page.getByTestId(ready).first()).toBeVisible();
      if (path === "/settings") {
        // The schedule card renders only after its data loads.
        await expect(page.getByRole("button", { name: "Save schedule" })).toBeVisible();
      }
      await expectTouchTargets(page);
      await expectNoHorizontalOverflow(page);
    }

    // Need detail has the widest content (score explanation table), so it is
    // the most likely page to force the viewport to zoom out.
    await page.goto("/needs");
    await expect(page.getByTestId("needs-list").first()).toBeVisible();
    await page.locator(".need-title-link").first().click();
    await expect(page.getByTestId("need-detail")).toBeVisible();
    await expectTouchTargets(page);
    await expectNoHorizontalOverflow(page);
  });
});
