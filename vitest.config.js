import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.js", "src/**/*.spec.js"],
    exclude: ["node_modules"],
    setupFiles: [],
    testTimeout: 10000,
    hookTimeout: 10000,
    sequence: {
      concurrent: false,
    },
  },
});
