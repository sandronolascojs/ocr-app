import { Page, BrowserContext } from "@playwright/test";
import { ApiKeyProvider } from "@/types/enums/apiKeyProvider.enum";

/**
 * Sets up API key mocking for E2E tests.
 * Reads OPENAI_API_KEY from environment and mocks TRPC calls to simulate
 * that the user has an active API key configured.
 */
export async function setupApiKeyMocking(
  context: BrowserContext
): Promise<boolean> {
  const openaiApiKey = process.env.E2E_OPENAI_API_KEY || process.env.OPENAI_API_KEY;

  if (!openaiApiKey) {
    return false;
  }

  // Mock getApiKeys to return an active OpenAI key
  await context.route("**/api/trpc/apiKeys.getApiKeys*", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        result: {
          data: {
            json: [
              {
                id: "test-api-key-id",
                provider: ApiKeyProvider.OPENAI,
                keyPrefix: openaiApiKey.substring(0, 7),
                keySuffix: openaiApiKey.substring(openaiApiKey.length - 4),
                isActive: true,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            ],
          },
        },
      }),
    });
  });

  // Mock createApiKey to succeed (in case the UI tries to create one)
  await context.route("**/api/trpc/apiKeys.createApiKey*", async (route) => {
    const request = route.request();
    const method = request.method();

    if (method === "POST") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          result: {
            data: {
              json: {
                id: "test-api-key-id",
                provider: ApiKeyProvider.OPENAI,
                keyPrefix: openaiApiKey.substring(0, 7),
                keySuffix: openaiApiKey.substring(openaiApiKey.length - 4),
                isActive: true,
                createdAt: new Date().toISOString(),
              },
            },
          },
        }),
      });
    } else {
      await route.continue();
    }
  });

  return true;
}

/**
 * Waits for the API key alert to disappear, indicating the user has an active key.
 * If the alert is still visible after setup, the test should be skipped.
 */
export async function waitForApiKeyReady(page: Page): Promise<boolean> {
  try {
    // Wait a bit for the page to load and check API keys
    await page.waitForTimeout(2000);

    // Check if API key alert is visible
    const apiKeyAlert = page.getByText(/You must add an OpenAI API key/i);
    const alertVisible = await apiKeyAlert.isVisible().catch(() => false);

    return !alertVisible;
  } catch {
    return false;
  }
}

