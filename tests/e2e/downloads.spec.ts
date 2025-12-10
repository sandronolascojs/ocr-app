import { test, expect } from "@playwright/test";
import JSZip from "jszip";
import {
  getOrCreateSharedTestUser,
  signInSharedTestUser,
  cleanupSharedTestUser,
} from "./helpers/shared-test-user";

test.describe("Download Flows", () => {
  // Cleanup shared test user after all tests
  test.afterAll(async () => {
    await cleanupSharedTestUser();
  });

  test("downloads trigger single navigation without double downloads", async ({
    page,
    context,
  }) => {
    // Ensure shared test user exists and sign in
    await getOrCreateSharedTestUser(page);
    await signInSharedTestUser(page);
    // Track navigation events
    let navigationCount = 0;
    context.on("request", (request) => {
      if (request.url().includes("download") || request.url().includes("signed")) {
        navigationCount++;
      }
    });

    // Mock a completed job with results
    await context.route("**/api/trpc/ocr.listJobs*", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          result: {
            data: {
              json: {
                jobs: [
                  {
                    jobId: "test-job-123",
                    status: "DONE",
                    step: "DOCS_BUILT",
                    hasResults: true,
                    totalImages: 3,
                    processedImages: 3,
                  },
                ],
                total: 1,
                limit: 50,
                offset: 0,
              },
            },
          },
        }),
      });
    });

    await context.route("**/api/trpc/ocr.getResult*", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          result: {
            data: {
              json: {
                txt: {
                  url: "https://example.com/test.txt",
                  expiresAt: new Date(Date.now() + 3600000).toISOString(),
                  key: "txt-key",
                },
                docx: {
                  url: "https://example.com/test.docx",
                  expiresAt: new Date(Date.now() + 3600000).toISOString(),
                  key: "docx-key",
                },
                rawZip: {
                  url: "https://example.com/test.zip",
                  expiresAt: new Date(Date.now() + 3600000).toISOString(),
                  key: "zip-key",
                },
              },
            },
          },
        }),
      });
    });

    // Mock download URLs to prevent actual navigation
    await context.route("https://example.com/*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/octet-stream",
        body: "mock-file-content",
      });
    });

    await page.goto("/history");

    // Wait for job to appear
    await expect(page.getByText("test-job-123")).toBeVisible({ timeout: 10000 });

    // Open menu and download TXT
    const menuButton = page.getByRole("button", { name: /Open menu/i }).first();
    await menuButton.click();

    const initialCount = navigationCount;
    await page.getByRole("menuitem", { name: /Download TXT/i }).click();

    // Wait a bit to ensure no double navigation
    await page.waitForTimeout(500);
    expect(navigationCount).toBeGreaterThan(initialCount);
    const txtCount = navigationCount;

    // Go back and download DOCX
    await page.goBack();
    await page.waitForTimeout(500);
    await menuButton.click();
    await page.getByRole("menuitem", { name: /Download DOCX/i }).click();
    await page.waitForTimeout(500);
    expect(navigationCount).toBeGreaterThan(txtCount);

    // Go back and download ZIP
    await page.goBack();
    await page.waitForTimeout(500);
    await menuButton.click();
    await page.getByRole("menuitem", { name: /Download ZIP/i }).click();
    await page.waitForTimeout(500);
    expect(navigationCount).toBeGreaterThan(txtCount + 1);
  });

  test("download button in new job view works correctly", async ({
    page,
    context,
  }) => {
    // Ensure shared test user exists and sign in
    await getOrCreateSharedTestUser(page);
    await signInSharedTestUser(page);
    // Sign in with shared test user
    await signInSharedTestUser(page);
    await context.route("**/api/trpc/ocr.getJob*", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          result: {
            data: {
              json: {
                jobId: "test-job-456",
                status: "DONE",
                step: "DOCS_BUILT",
                hasResults: true,
                totalImages: 5,
                processedImages: 5,
              },
            },
          },
        }),
      });
    });

    await context.route("**/api/trpc/ocr.getResult*", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          result: {
            data: {
              json: {
                txt: {
                  url: "https://example.com/test.txt",
                  expiresAt: new Date(Date.now() + 3600000).toISOString(),
                  key: "txt-key",
                },
                docx: {
                  url: "https://example.com/test.docx",
                  expiresAt: new Date(Date.now() + 3600000).toISOString(),
                  key: "docx-key",
                },
                rawZip: {
                  url: "https://example.com/test.zip",
                  expiresAt: new Date(Date.now() + 3600000).toISOString(),
                  key: "zip-key",
                },
              },
            },
          },
        }),
      });
    });

    await context.route("https://example.com/*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/octet-stream",
        body: "mock-content",
      });
    });

    await page.goto("/new-job?jobId=test-job-456");

    // Wait for results to be available
    await expect(page.getByText(/Documents built/i)).toBeVisible({
      timeout: 10000,
    });

    // Test download buttons
    const downloadTxtButton = page.getByRole("button", { name: /Download TXT/i });
    await expect(downloadTxtButton).toBeVisible();
    await downloadTxtButton.click();
    await page.waitForTimeout(500);

    const downloadDocxButton = page.getByRole("button", { name: /Download DOCX/i });
    await expect(downloadDocxButton).toBeVisible();
    await downloadDocxButton.click();
    await page.waitForTimeout(500);

    const downloadZipButton = page.getByRole("button", { name: /Download ZIP/i });
    await expect(downloadZipButton).toBeVisible();
    await downloadZipButton.click();
    await page.waitForTimeout(500);
  });
});
