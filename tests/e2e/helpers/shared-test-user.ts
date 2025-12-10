import { Page } from "@playwright/test";
import {
  generateTestUserCredentials,
  enableUserInDb,
  deleteUserFromDb,
  type TestUserCredentials,
} from "./user-setup";

// Singleton pattern to ensure only one test user is created
let sharedTestUser: TestUserCredentials | null = null;
let isCreating = false;
let creationPromise: Promise<TestUserCredentials> | null = null;

const signUpViaUI = async (
  page: Page,
  credentials: TestUserCredentials
): Promise<void> => {
  await page.goto("/sign-up", { waitUntil: "networkidle" });

  await page.getByLabel(/First name/i).fill("Test");
  await page.getByLabel(/Last name/i).fill("User");
  await page.getByLabel(/Email address/i).fill(credentials.email);
  await page.getByLabel(/Password/i).fill(credentials.password);

  await page.getByRole("button", { name: /Continue/i }).click();

  // Wait for redirect to email-otp page or success
  await page.waitForURL(
    (url) => url.pathname.includes("/email-otp") || url.pathname === "/",
    { timeout: 15_000 }
  ).catch(() => {
    // If redirect doesn't happen, wait a bit more
    return page.waitForTimeout(2000);
  });
};

const loginViaUI = async (
  page: Page,
  credentials: TestUserCredentials
): Promise<boolean> => {
  // Ensure we're on the login page (not email-otp or any other page)
  const currentUrl = page.url();
  if (!currentUrl.includes("/login")) {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
  }

  // Wait for the page to be fully loaded
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {
    // If networkidle times out, continue anyway
  });

  // Wait for form fields using more flexible selectors
  // Try multiple strategies to find the email field
  try {
    // First try by label (most reliable)
    await page.getByLabel(/Email/i).waitFor({ state: "visible", timeout: 10_000 });
    await page.getByLabel(/Password/i).waitFor({ state: "visible", timeout: 10_000 });
  } catch (error) {
    // Fallback to input selectors
    await page.waitForSelector('input[type="email"]', { state: "visible", timeout: 10_000 });
    await page.waitForSelector('input[type="password"]', { state: "visible", timeout: 10_000 });
  }

  // Fill in credentials
  await page.getByLabel(/Email/i).fill(credentials.email);
  await page.getByLabel(/Password/i).fill(credentials.password);

  // Click login button and wait for navigation
  const navigationPromise = page.waitForURL(
    (url) => !url.pathname.includes("/login") && !url.pathname.includes("/email-otp"),
    { timeout: 15_000 }
  );

  await page.getByRole("button", { name: /Continue/i }).click();

  // Wait for navigation away from login page
  try {
    await navigationPromise;
    // Wait for page to be fully loaded
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    return true;
  } catch (error) {
    // Check if we're on an authenticated page (login might have succeeded but redirect is slow)
    await page.waitForTimeout(2000); // Give it a moment
    const finalUrl = page.url();
    if (!finalUrl.includes("/login") && !finalUrl.includes("/email-otp") && !finalUrl.includes("/sign-up")) {
      await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
      return true;
    }
    return false;
  }
};

/**
 * Gets or creates the shared test user.
 * This ensures only one test user exists across all tests.
 * Thread-safe: if multiple tests call this simultaneously, only one user is created.
 */
export const getOrCreateSharedTestUser = async (
  page: Page
): Promise<TestUserCredentials> => {
  // If user already exists, return it
  if (sharedTestUser) {
    return sharedTestUser;
  }

  // If creation is in progress, wait for it
  if (isCreating && creationPromise) {
    return await creationPromise;
  }

  // Start creation process
  isCreating = true;
  creationPromise = (async () => {
    try {
      // Generate unique credentials
      const credentials = generateTestUserCredentials();

      // Sign up via UI (this will redirect to /email-otp)
      await signUpViaUI(page, credentials);

      // Wait a moment for the redirect to complete
      await page.waitForTimeout(2000);

      // Enable user in database (this allows access without email verification)
      const enabled = await enableUserInDb(credentials.email);
      if (!enabled) {
        throw new Error(
          `Failed to enable user ${credentials.email} in DB. Check E2E_DATABASE_URL environment variable.`
        );
      }

      // After enabling, the user might already be logged in from signup
      // Try navigating to a private page to check if already authenticated
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1000);

      // Check if we're already on an authenticated page (not redirected to login)
      const currentUrl = page.url();
      const isAuthenticated = !currentUrl.includes("/login") && 
                              !currentUrl.includes("/sign-up") && 
                              !currentUrl.includes("/email-otp");

      if (!isAuthenticated) {
        // User is not logged in, need to login
        await page.goto("/login", { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(500);

        const loginSuccess = await loginViaUI(page, credentials);
        if (!loginSuccess) {
          throw new Error(
            `Failed to login user ${credentials.email} after signup and enable`
          );
        }
      } else {
        // User is already logged in, just wait for page to load
        await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
      }

      // Store as shared user
      sharedTestUser = credentials;
      return credentials;
    } finally {
      isCreating = false;
      creationPromise = null;
    }
  })();

  return await creationPromise;
};

/**
 * Signs in the shared test user.
 * Should be called at the start of each test that needs authentication.
 */
export const signInSharedTestUser = async (
  page: Page
): Promise<TestUserCredentials> => {
  // Ensure user exists (this will create it if needed)
  const credentials = await getOrCreateSharedTestUser(page);

  // Check if we're already logged in by checking current URL
  const currentUrl = page.url();
  if (!currentUrl.includes("/login") && !currentUrl.includes("/sign-up") && !currentUrl.includes("/email-otp")) {
    // Already on an authenticated page, verify we're logged in
    try {
      // Wait a bit and check if we're still on an authenticated page
      await page.waitForTimeout(1000);
      const newUrl = page.url();
      if (!newUrl.includes("/login") && !newUrl.includes("/sign-up") && !newUrl.includes("/email-otp")) {
        // Likely already logged in, wait for page to be ready
        await page.waitForLoadState("networkidle").catch(() => {});
        return credentials;
      }
    } catch {
      // Fall through to login
    }
  }

  // Sign in
  const loginSuccess = await loginViaUI(page, credentials);
  if (!loginSuccess) {
    throw new Error(
      `Failed to login shared test user ${credentials.email}. User may have been deleted.`
    );
  }

  // Wait for page to fully load after login
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1000); // Give UI time to render

  return credentials;
};

/**
 * Cleans up the shared test user.
 * Should be called in afterAll hook after all tests complete.
 */
export const cleanupSharedTestUser = async (): Promise<void> => {
  if (sharedTestUser) {
    await deleteUserFromDb(sharedTestUser.email);
    sharedTestUser = null;
  }
};

/**
 * Gets the current shared test user credentials (if created).
 * Returns null if user hasn't been created yet.
 */
export const getSharedTestUser = (): TestUserCredentials | null => {
  return sharedTestUser;
};

