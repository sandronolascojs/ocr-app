import { test, expect } from "@playwright/test";
import {
  getOrCreateSharedTestUser,
  signInSharedTestUser,
  cleanupSharedTestUser,
} from "./helpers/shared-test-user";

test.describe("Navigation and Views", () => {
  // Cleanup shared test user after all tests
  test.afterAll(async () => {
    await cleanupSharedTestUser();
  });

  test("can navigate between all main views", async ({ page, context }) => {
    // Setup API mocks BEFORE navigation/login
    await context.route("**/api/trpc/**", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          result: {
            data: {
              json: { jobs: [], total: 0, limit: 50, offset: 0 },
            },
          },
        }),
      });
    });

    // Ensure shared test user exists and sign in
    await getOrCreateSharedTestUser(page);
    await signInSharedTestUser(page);

    // Wait for page to fully load after login
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000); // Give UI time to render

    // Test History view
    await page.goto("/history", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: /Job History/i })).toBeVisible({
      timeout: 10000,
    });

    // Test New Job view
    await page.goto("/new-job", { waitUntil: "networkidle" });
    await expect(
      page.getByRole("heading", { name: /Chinese Subtitle OCR Pipeline/i })
    ).toBeVisible({ timeout: 10000 });

    // Test Documents view
    await page.goto("/documents", { waitUntil: "networkidle" });
    await expect(
      page.getByRole("heading", { name: /Documents/i })
    ).toBeVisible({ timeout: 10000 });

    // Test Images view
    await page.goto("/images", { waitUntil: "networkidle" });
    await expect(
      page.getByRole("heading", { name: /Images/i })
    ).toBeVisible({ timeout: 10000 });
  });

  test("sidebar navigation works correctly", async ({ page, context }) => {
    // Setup API mocks BEFORE navigation/login
    await context.route("**/api/trpc/**", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          result: {
            data: {
              json: { jobs: [], total: 0, limit: 50, offset: 0 },
            },
          },
        }),
      });
    });

    // Ensure shared test user exists and sign in
    await getOrCreateSharedTestUser(page);
    await signInSharedTestUser(page);

    // Wait for page to fully load after login
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000); // Give UI time to render

    // Navigate to new-job page
    await page.goto("/new-job", { waitUntil: "networkidle" });
    await page.waitForTimeout(500); // Wait for sidebar to be ready

    // Navigate via sidebar
    // History is in the "OCR Processing" collapsible menu
    // First, we need to find and click the "OCR Processing" menu to expand it, then click "History"
    const ocrProcessingMenu = page.getByRole("button", { name: /OCR Processing/i });
    await expect(ocrProcessingMenu).toBeVisible({ timeout: 10_000 });
    
    // Check if History link is already visible (menu might already be open)
    const historyLink = page.getByRole("link", { name: /History/i });
    const isHistoryVisible = await historyLink.isVisible().catch(() => false);
    
    // If History is not visible, click to expand the menu
    if (!isHistoryVisible) {
      await ocrProcessingMenu.click();
      await page.waitForTimeout(500); // Wait for menu animation
    }
    
    // Wait for the History link to be visible (this ensures the menu has expanded)
    await expect(historyLink).toBeVisible({ timeout: 10_000 });
    await historyLink.click();
    await expect(page).toHaveURL(/.*\/history/, { timeout: 10_000 });
    await page.waitForLoadState("networkidle");

    // Documents is in its own collapsible menu
    const documentsMenu = page.getByRole("button", { name: /Documents/i });
    await expect(documentsMenu).toBeVisible({ timeout: 10_000 });
    
    // Check if All Documents link is already visible
    const allDocumentsLink = page.getByRole("link", { name: /All Documents/i });
    const isAllDocumentsVisible = await allDocumentsLink.isVisible().catch(() => false);
    
    // If not visible, click to expand the menu
    if (!isAllDocumentsVisible) {
      await documentsMenu.click();
      await page.waitForTimeout(500); // Wait for menu animation
    }
    
    // Wait for All Documents link to be visible
    await expect(allDocumentsLink).toBeVisible({ timeout: 10_000 });
    await allDocumentsLink.click();
    await expect(page).toHaveURL(/.*\/documents/, { timeout: 10_000 });
    await page.waitForLoadState("networkidle");

    // Images is in its own collapsible menu
    const imagesMenu = page.getByRole("button", { name: /Images/i });
    await expect(imagesMenu).toBeVisible({ timeout: 10_000 });
    
    // Check if Processed link is already visible
    const processedLink = page.getByRole("link", { name: /Processed/i });
    const isProcessedVisible = await processedLink.isVisible().catch(() => false);
    
    // If not visible, click to expand the menu
    if (!isProcessedVisible) {
      await imagesMenu.click();
      await page.waitForTimeout(500); // Wait for menu animation
    }
    
    // Wait for Processed link to be visible
    await expect(processedLink).toBeVisible({ timeout: 10_000 });
    await processedLink.click();
    await expect(page).toHaveURL(/.*\/images/, { timeout: 10_000 });
    await page.waitForLoadState("networkidle");

    // New Job is in the "OCR Processing" collapsible menu
    const ocrProcessingMenu2 = page.getByRole("button", { name: /OCR Processing/i });
    await expect(ocrProcessingMenu2).toBeVisible({ timeout: 10_000 });
    
    // Check if New Job link is already visible
    const newJobLink = page.getByRole("link", { name: /New Job/i });
    const isNewJobVisible = await newJobLink.isVisible().catch(() => false);
    
    // If not visible, click to expand the menu
    if (!isNewJobVisible) {
      await ocrProcessingMenu2.click();
      await page.waitForTimeout(500); // Wait for menu animation
    }
    
    // Wait for New Job link to be visible
    await expect(newJobLink).toBeVisible({ timeout: 10_000 });
    await newJobLink.click();
    await expect(page).toHaveURL(/.*\/new-job/, { timeout: 10_000 });
  });
});

