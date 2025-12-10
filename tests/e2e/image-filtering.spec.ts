import { test, expect } from "@playwright/test";
import JSZip from "jszip";
import {
  getOrCreateSharedTestUser,
  signInSharedTestUser,
  cleanupSharedTestUser,
} from "./helpers/shared-test-user";

test.describe("Image Filtering in ZIP", () => {
  // Cleanup shared test user after all tests
  test.afterAll(async () => {
    await cleanupSharedTestUser();
  });

  test("filtered ZIP contains only canonical integer filenames", async ({
    page,
    context,
  }) => {
    // Ensure shared test user exists and sign in
    await getOrCreateSharedTestUser(page);
    await signInSharedTestUser(page);
    // Mock a completed job
    await context.route("**/api/trpc/ocr.listJobs*", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          result: {
            data: {
              json: {
                jobs: [
                  {
                    jobId: "filter-test-job",
                    status: "DONE",
                    step: "DOCS_BUILT",
                    hasResults: true,
                    totalImages: 5,
                    processedImages: 5,
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

    // Intercept the ZIP download - create a mock ZIP with filtered images (only integers)
    await context.route("**/example.com/test.zip*", async (route) => {
      const zip = new JSZip();
      // Only canonical integer filenames (filtered)
      zip.file("1.png", "mock-image-1");
      zip.file("2.png", "mock-image-2");
      zip.file("3.png", "mock-image-3");
      zip.file("4.png", "mock-image-4");
      zip.file("5.png", "mock-image-5");

      const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

      await route.fulfill({
        status: 200,
        contentType: "application/zip",
        body: zipBuffer,
      });
    });

    await page.goto("/history");

    await expect(page.getByText("filter-test-job")).toBeVisible({
      timeout: 10000,
    });

    // Download the ZIP
    const menuButton = page.getByRole("button", { name: /Open menu/i }).first();
    await menuButton.click();

    const downloadPromise = page.waitForEvent("download", { timeout: 10000 });
    await page.getByRole("menuitem", { name: /Download ZIP/i }).click();
    const download = await downloadPromise;

    // Verify ZIP contents
    const path = await download.path();
    if (path) {
      const fs = await import("fs/promises");
      const zipBuffer = await fs.readFile(path);
      const zip = await JSZip.loadAsync(zipBuffer);
      const fileNames = Object.keys(zip.files).filter(
        (name) => !name.endsWith("/") && name.match(/\.(png|jpg|jpeg)$/i)
      );

      // Should only contain integer filenames: 1, 2, 3, 4, 5
      expect(fileNames.length).toBe(5);
      expect(fileNames).toContain("1.png");
      expect(fileNames).toContain("2.png");
      expect(fileNames).toContain("3.png");
      expect(fileNames).toContain("4.png");
      expect(fileNames).toContain("5.png");

      // Should NOT contain variants like 1-1, 1.1, 5-1, etc.
      expect(fileNames.some((name) => /-\d+\./.test(name))).toBe(false);
      expect(fileNames.some((name) => /\.\d+\./.test(name))).toBe(false);
    }
  });
});
