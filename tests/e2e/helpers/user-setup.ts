import { Page } from "@playwright/test";
import { Client } from "pg";
import { createId } from "@paralleldrive/cuid2";

const DEFAULT_FIRST_NAME = "Test";
const DEFAULT_LAST_NAME = "User";

export type TestUserCredentials = {
  email: string;
  password: string;
};

/**
 * Generates random test user credentials.
 * Email format: test-{randomId}@e2e.test
 * Password: Random secure password
 */
export const generateTestUserCredentials = (): TestUserCredentials => {
  const randomId = createId();
  const email = `test-${randomId}@e2e.test`;
  const password = `TestPassword${randomId.substring(0, 8)}!`;

  return { email, password };
};

/**
 * Gets database connection string from environment variables.
 */
const getDatabaseConnectionString = (): string | null => {
  return (
    process.env.E2E_DATABASE_URL ||
    process.env.DATABASE_URL ||
    process.env.TEST_DATABASE_URL ||
    null
  );
};

/**
 * Enables a user in the database (sets is_enabled and email_verified to true).
 */
export const enableUserInDb = async (email: string): Promise<boolean> => {
  const connectionString = getDatabaseConnectionString();

  if (!connectionString) {
    console.warn("No database connection string found, skipping user enable");
    return false;
  }

  const client = new Client({ connectionString });
  try {
    await client.connect();
    await client.query(
      `UPDATE users SET is_enabled = true, email_verified = true WHERE email = $1`,
      [email]
    );
    return true;
  } catch (error) {
    console.error(`Failed to enable user ${email}:`, error);
    return false;
  } finally {
    await client.end();
  }
};

/**
 * Deletes a user and all related data from the database.
 * This includes: accounts, sessions, verifications, api_keys, ocr_jobs, etc.
 */
export const deleteUserFromDb = async (email: string): Promise<boolean> => {
  const connectionString = getDatabaseConnectionString();

  if (!connectionString) {
    console.warn("No database connection string found, skipping user deletion");
    return false;
  }

  const client = new Client({ connectionString });
  try {
    await client.connect();

    // Get user ID first
    const userResult = await client.query(
      `SELECT id FROM users WHERE email = $1`,
      [email]
    );

    if (userResult.rows.length === 0) {
      // User doesn't exist, nothing to delete
      return true;
    }

    const userId = userResult.rows[0].id;

    // Delete in order to respect foreign key constraints
    // CASCADE will handle most dependencies, but we'll be explicit
    await client.query(`DELETE FROM users WHERE id = $1`, [userId]);

    return true;
  } catch (error) {
    console.error(`Failed to delete user ${email}:`, error);
    return false;
  } finally {
    await client.end();
  }
};

const signUpViaUI = async (
  page: Page,
  credentials: TestUserCredentials
): Promise<void> => {
  await page.goto("/sign-up");

  await page.getByLabel(/First name/i).fill(DEFAULT_FIRST_NAME);
  await page.getByLabel(/Last name/i).fill(DEFAULT_LAST_NAME);
  await page.getByLabel(/Email address/i).fill(credentials.email);
  await page.getByLabel(/Password/i).fill(credentials.password);

  await page.getByRole("button", { name: /Continue/i }).click();

  // Wait for redirect to email-otp page or success
  await page.waitForTimeout(3000);
};

const loginViaUI = async (
  page: Page,
  credentials: TestUserCredentials
): Promise<boolean> => {
  await page.goto("/login");

  await page.getByLabel(/Email/i).fill(credentials.email);
  await page.getByLabel(/Password/i).fill(credentials.password);

  await page.getByRole("button", { name: /Sign in/i }).click();

  // Wait for navigation away from login page
  const success = await page
    .waitForURL((url) => !url.pathname.includes("/login"), {
      timeout: 10_000,
    })
    .then(() => true)
    .catch(() => false);

  return success;
};

/**
 * Creates a test user, enables them in DB, and signs them in.
 * Returns the credentials used so the test can clean up later.
 */
export const createAndSignInTestUser = async (
  page: Page
): Promise<TestUserCredentials> => {
  const credentials = generateTestUserCredentials();

  // Sign up via UI
  await signUpViaUI(page, credentials);

  // Enable user in database
  const enabled = await enableUserInDb(credentials.email);
  if (!enabled) {
    console.warn(
      `Failed to enable user ${credentials.email} in DB, login may fail`
    );
  }

  // Login
  const loginSuccess = await loginViaUI(page, credentials);
  if (!loginSuccess) {
    throw new Error(
      `Failed to login user ${credentials.email} after signup and enable`
    );
  }

  return credentials;
};

/**
 * Cleans up test user by deleting from database.
 * Should be called in test teardown/afterEach.
 */
export const cleanupTestUser = async (
  credentials: TestUserCredentials
): Promise<void> => {
  await deleteUserFromDb(credentials.email);
};
