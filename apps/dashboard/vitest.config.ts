import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "worker",
          include: ["test/worker/**/*.test.ts"],
          environment: "node",
          // The D1 fake uses node:sqlite, which prints an ExperimentalWarning in every worker.
          execArgv: ["--disable-warning=ExperimentalWarning"],
        },
      },
      {
        extends: true,
        test: {
          name: "ui",
          include: ["test/ui/**/*.test.tsx"],
          environment: "happy-dom",
          setupFiles: ["./test/ui/setup.ts"],
        },
      },
    ],
  },
});
