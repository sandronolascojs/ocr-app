import { test, expect } from "@playwright/test";
import JSZip from "jszip";
import * as fs from "fs/promises";
import * as path from "path";
import { JobsStatus, JobStep } from "@/types";
import { setupApiKeyMocking, waitForApiKeyReady } from "./helpers/api-key-setup";
import {
  getOrCreateSharedTestUser,
  signInSharedTestUser,
  cleanupSharedTestUser,
} from "./helpers/shared-test-user";

test.describe("Full Upload and Processing Flow", () => {
  // Cleanup shared test user after all tests
  test.afterAll(async () => {
    await cleanupSharedTestUser();
  });

  test("uploads ZIP, waits for Inngest processing, and verifies filtered ZIP", async ({
    page,
    context,
  }) => {
      const testZipPath = path.join(process.cwd(), "test-input.zip");
      const testZipExists = await fs
        .access(testZipPath)
        .then(() => true)
        .catch(() => false);

      test.skip(!testZipExists, "test-input.zip not found in project root");

      // Setup API key mocking from environment variable
      const apiKeyConfigured = await setupApiKeyMocking(context, page);
      test.skip(
        !apiKeyConfigured,
        "E2E_OPENAI_API_KEY or OPENAI_API_KEY environment variable is required for this test"
      );

      // Ensure shared test user exists and sign in
      await getOrCreateSharedTestUser(page);
      await signInSharedTestUser(page);

    // Navigate to new job page
    await page.goto("/new-job");

    // Wait for page to load
    await expect(
      page.getByRole("heading", { name: /Chinese Subtitle OCR Pipeline/i })
    ).toBeVisible({ timeout: 10000 });

    // Wait for API key to be ready (mocked)
    const apiKeyReady = await waitForApiKeyReady(page);
    test.skip(
      !apiKeyReady,
      "API key setup failed - check E2E_OPENAI_API_KEY environment variable"
    );

    // Upload the ZIP file
    const fileInput = page.getByLabel(/ZIP file/i);
    await fileInput.setInputFiles(testZipPath);

    // Wait for file to be selected
    await expect(
      page.getByText(/Selected:.*test-input\.zip/i)
    ).toBeVisible({ timeout: 5000 });

    // Submit the form
    const submitButton = page.getByRole("button", { name: /Start OCR Job/i });
    await expect(submitButton).toBeEnabled();
    await submitButton.click();

    // Wait for upload to complete and job to be created
    await expect(page.getByText(/Job created/i)).toBeVisible({
      timeout: 30000,
    });

    // Extract job ID from toast or URL
    const jobIdMatch = await page
      .getByText(/Job ID:.*/i)
      .textContent()
      .then((text) => text?.match(/Job ID:\s*([^\s]+)/)?.[1])
      .catch(() => null);

    // Alternative: get job ID from URL if redirected
    const currentUrl = page.url();
    const urlJobId = currentUrl.match(/jobId=([^&]+)/)?.[1];

    const jobId = jobIdMatch || urlJobId;
    expect(jobId).toBeTruthy();

    // Wait for job to be processed by Inngest
    // Poll the job status until it's DONE or ERROR
    let jobStatus: JobsStatus | null = null;
    let attempts = 0;
    const maxAttempts = 240; // 20 minutes max (5s * 240) - Inngest can take time
    const pollInterval = 5000; // 5 seconds

    // Wait for initial job status to appear
    await page.waitForTimeout(2000);

    while (attempts < maxAttempts) {
      // Check job status by looking at the UI badges
      const statusBadges = page.locator('[class*="badge"], [data-status]');
      const statusCount = await statusBadges.count();

      if (statusCount > 0) {
        // Try to find status badge with Done/Processing/Error
        for (let i = 0; i < statusCount; i++) {
          const badge = statusBadges.nth(i);
          const text = await badge.textContent().catch(() => null);
          if (text?.includes("Done") || text?.includes(JobsStatus.DONE)) {
            jobStatus = JobsStatus.DONE;
            break;
          }
          if (text?.includes("Error") || text?.includes(JobsStatus.ERROR)) {
            jobStatus = JobsStatus.ERROR;
            break;
          }
        }
      }

      // Also check for step indicators
      const stepText = await page
        .getByText(new RegExp(`Documents built|${JobStep.DOCS_BUILT}`, "i"))
        .isVisible()
        .catch(() => false);

      if (stepText) {
        jobStatus = JobsStatus.DONE;
        break;
      }

      if (jobStatus === JobsStatus.DONE || jobStatus === JobsStatus.ERROR) {
        break;
      }

      // Wait before next poll
      await page.waitForTimeout(pollInterval);
      attempts++;

      // Refresh the page periodically to get latest status (every 30 seconds)
      if (attempts % 6 === 0) {
        await page.reload();
        await page.waitForTimeout(2000);
      }
    }

    expect(jobStatus).toBe(JobsStatus.DONE);
    expect(attempts).toBeLessThan(maxAttempts);

    // Verify all steps are completed
    await expect(page.getByText(/Documents built/i)).toBeVisible({
      timeout: 10000,
    });

    // Download the filtered ZIP
    const downloadZipButton = page.getByRole("button", {
      name: /Download ZIP/i,
    });
    await expect(downloadZipButton).toBeVisible({ timeout: 10000 });
    await expect(downloadZipButton).toBeEnabled();

    const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
    await downloadZipButton.click();
    const download = await downloadPromise;

    // Verify ZIP was downloaded
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();

    // Read and verify ZIP contents
    if (downloadPath) {
      const zipBuffer = await fs.readFile(downloadPath);
      const zip = await JSZip.loadAsync(zipBuffer);

      // Get all image files (png, jpg, jpeg)
      const fileNames = Object.keys(zip.files)
        .filter((name) => !name.endsWith("/"))
        .filter((name) => /\.(png|jpg|jpeg)$/i.test(name))
        .map((name) => path.basename(name));

      // Verify we have files
      expect(fileNames.length).toBeGreaterThan(0);

      // Verify all filenames are canonical integers (1, 2, 3, etc.)
      // Should NOT contain variants like 1-1, 1.1, 5-1, etc.
      for (const fileName of fileNames) {
        const nameWithoutExt = fileName.replace(/\.(png|jpg|jpeg)$/i, "");
        // Should match pure integer pattern: ^\d+$
        expect(nameWithoutExt).toMatch(/^\d+$/);
      }

      // Verify no variants exist
      const hasVariants = fileNames.some(
        (name) => /-\d+\./.test(name) || /\.\d+\./.test(name)
      );
      expect(hasVariants).toBe(false);

      // Verify files are in order (1, 2, 3, ...)
      const sortedNames = [...fileNames].sort((a, b) => {
        const numA = parseInt(a.replace(/\.(png|jpg|jpeg)$/i, ""), 10);
        const numB = parseInt(b.replace(/\.(png|jpg|jpeg)$/i, ""), 10);
        return numA - numB;
      });
      expect(fileNames).toEqual(sortedNames);
    }

    // Also verify TXT and DOCX downloads work
    const downloadTxtButton = page.getByRole("button", {
      name: /Download TXT/i,
    });
    await expect(downloadTxtButton).toBeVisible();
    await expect(downloadTxtButton).toBeEnabled();

    const downloadDocxButton = page.getByRole("button", {
      name: /Download DOCX/i,
    });
    await expect(downloadDocxButton).toBeVisible();
    await expect(downloadDocxButton).toBeEnabled();
  });
});

