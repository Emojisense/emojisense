#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createEngine } from "emojisense";
import { apiFromEnv } from "./api.js";
import { loadBundledPacks } from "./packs.js";
import { createServer } from "./server.js";

// stdout carries the JSON-RPC stream, so every diagnostic goes to stderr.
const log = (message: string) => console.error(`emojisense-mcp: ${message}`);

async function main(): Promise<void> {
  const engine = createEngine(loadBundledPacks());
  const api = apiFromEnv(process.env, {
    warn: log,
    onError: (error) => log(`API unavailable, using offline results (${(error as Error).message})`),
  });
  const server = createServer({ engine, api });
  await server.connect(new StdioServerTransport());
  log(
    `ready: pack ${engine.packVersion}, locales ${engine.locales.join("+")}, ${api ? "online" : "offline"}`,
  );
}

main().catch((error: unknown) => {
  log(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
