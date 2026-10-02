import "@fontsource-variable/bricolage-grotesque/opsz.css";
import "@fontsource-variable/hanken-grotesk/index.css";
import "@fontsource/dm-mono/latin-400.css";
import "@fontsource/dm-mono/latin-500.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/shell.css";
import "./styles/pages.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ClerkAuth } from "./auth/ClerkAuth";
import { CLERK_PUBLISHABLE_KEY, MOCK_MODE } from "./lib/config";

async function start() {
  const root = document.getElementById("root");
  if (!root) throw new Error("index.html has no #root element");
  // Development only. `import.meta.env.DEV` is the literal `false` in production builds, so the
  // bundler drops this branch and the mock module with it (vite.config.ts also refuses VITE_MOCK).
  if (import.meta.env.DEV && MOCK_MODE) {
    const { installMockApi } = await import("./mock/install");
    installMockApi();
  }
  createRoot(root).render(
    <StrictMode>
      {CLERK_PUBLISHABLE_KEY ? (
        <ClerkAuth publishableKey={CLERK_PUBLISHABLE_KEY}>
          <App />
        </ClerkAuth>
      ) : (
        <App />
      )}
    </StrictMode>,
  );
}

void start();
