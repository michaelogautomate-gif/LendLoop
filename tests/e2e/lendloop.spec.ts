import { expect, test } from "@playwright/test";

test.describe("LendLoop Public Privacy, Auth Routing & Security Headers", () => {
  test("1. renders LendLoop branding, tagline, Clerk Sign-In CTA, and HTTP security headers", async ({
    page,
  }) => {
    const response = await page.goto("/");
    expect(response).not.toBeNull();
    expect(response?.status()).toBe(200);

    const headers = response!.headers();
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toContain("camera=()");
    expect(headers["x-powered-by"]).toBeUndefined();

    await expect(page.getByText("LendLoop", { exact: true }).first()).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: /Borrow what you need\. Lend what you don't\./i,
      })
    ).toBeVisible();

    await expect(
      page.getByRole("link", { name: /Sign in to lend or borrow/i }).or(
        page.getByRole("button", { name: /Sign in to lend or borrow/i })
      ).first()
    ).toBeVisible();
  });

  test("2. public catalog contains zero owner emails, condition labels, or private details", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: /Currently Available Tools/i })
    ).toBeVisible();

    // Ensure loading finishes (either tool cards or empty state)
    await expect(
      page
        .getByTestId("public-tool-card")
        .first()
        .or(page.getByText(/No available tools listed right now\./i))
    ).toBeVisible();

    const mainText = (await page.locator("main").innerText()).trim();
    expect(mainText).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    expect(mainText).not.toMatch(/Trusted Lender/i);
    expect(mainText).not.toMatch(/Condition:/i);
    // Overdue unreturned tool (Bosch Electric Pressure Washer) and unavailable tool (Werner Ladder) must not appear on public catalog
    expect(mainText).not.toContain("Bosch Electric Pressure Washer");
    expect(mainText).not.toContain("Werner 8ft Fiberglass Step Ladder");
  });

  test("3. unauthenticated navigation to /dashboard and /admin fails closed", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/sign-in/);

    await page.goto("/admin");
    await expect(page).toHaveURL(/\/sign-in/);
  });
});

