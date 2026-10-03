/**
 * The MCP server's own API client (packages/mcp/src/api.ts), pointed at the website's key. The
 * server sends a secret key as a Bearer header; a browser may only send a publishable key, as
 * `?key=`. So the client's requests are rewritten on the way out, and the rest (the semantic mode,
 * the text limits, the timeout, the parsing) is the code an MCP client runs.
 */
import { createApiClient, type EmojisenseApi } from "../../../../../packages/mcp/src/api";
import { API_URL, PUBLISHABLE_KEY } from "../../config";

const withPublishableKey: typeof fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  url.searchParams.set("key", PUBLISHABLE_KEY);
  const headers = new Headers(init?.headers);
  headers.delete("Authorization");
  return fetch(url, { ...init, headers });
};

let api: EmojisenseApi | undefined;

export function browserApi(): EmojisenseApi {
  api ??= createApiClient({ baseUrl: API_URL, secretKey: "", fetch: withPublishableKey });
  return api;
}
