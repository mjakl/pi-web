import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@\/(.*)$/,
        replacement: `${path.resolve(rootDir, "src")}/$1`,
      },
      {
        find: /^@core\/(.*)$/,
        replacement: `${path.resolve(rootDir, "src/core")}/$1`,
      },
      {
        find: /^@adapters\/(.*)$/,
        replacement: `${path.resolve(rootDir, "src/adapters")}/$1`,
      },
      {
        find: /^@web\/(.*)$/,
        replacement: `${path.resolve(rootDir, "src/web")}/$1`,
      },
      {
        find: /^#\/(.*)$/,
        replacement: `${path.resolve(rootDir, "tests")}/$1`,
      },
    ],
  },
  oxc: { jsx: { runtime: "automatic", importSource: "hono/jsx" } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx", "src/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      // The smoke test packs and installs the package, so it runs only when
      // `just smoke` asks for it.
      ...(process.env["WEB_PI_SMOKE"] === undefined ? ["tests/smoke/**"] : []),
    ],
    coverage: { provider: "v8" },
    sequence: { shuffle: true },
    pool: "threads",
    testTimeout: 20_000,
  },
});
