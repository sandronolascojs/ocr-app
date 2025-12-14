import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.integration.test.ts"],
    reporters: ["default"],
    coverage: {
      reporter: ["text", "lcov"],
    },
    // Separate test files by type
    testTimeout: 30000, // 30 seconds for integration tests
  },
});

