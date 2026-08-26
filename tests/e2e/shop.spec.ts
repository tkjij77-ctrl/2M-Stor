import { test, expect } from "@playwright/test";

test("guest can see shop without login (cats_read using true)", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".shop-grid")).toBeVisible();
});
