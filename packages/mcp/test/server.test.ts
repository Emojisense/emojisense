import { InMemoryTransport, type JSONRPCMessage } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { engine } from "./fixture.js";

/** A minimal JSON-RPC client on the other end of an in-memory pipe: tests the wire contract. */
async function connect() {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createServer({ engine });
  await server.connect(serverSide);
  const waiting = new Map<number, (message: Record<string, unknown>) => void>();
  clientSide.onmessage = (message: JSONRPCMessage) => {
    const { id } = message as { id?: number };
    if (id !== undefined) waiting.get(id)?.(message as Record<string, unknown>);
  };
  await clientSide.start();
  let nextId = 0;
  const request = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<Record<string, unknown>>((resolve) => {
      const id = ++nextId;
      waiting.set(id, resolve);
      void clientSide.send({ jsonrpc: "2.0", id, method, params });
    });

  const init = await request("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "test", version: "0" },
  });
  await clientSide.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  return { init, request, close: () => server.close() };
}

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});

describe("MCP server", () => {
  it("lists the three tools with input and output schemas", async () => {
    const client = await connect();
    close = client.close;
    expect(client.init.result).toMatchObject({ serverInfo: { name: "emojisense" } });

    const { result } = (await client.request("tools/list")) as {
      result: {
        tools: {
          name: string;
          inputSchema: { properties: object };
          outputSchema?: object;
          annotations?: object;
        }[];
      };
    };
    expect(result.tools.map((t) => t.name)).toEqual(["search_emoji", "emoji_for_text", "suggest_reactions"]);
    for (const tool of result.tools) {
      expect(tool.outputSchema).toBeDefined();
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    }
    expect(Object.keys(result.tools[0]?.inputSchema.properties ?? {})).toEqual(["query", "locale", "limit"]);
  });

  it("returns short text plus structured content", async () => {
    const client = await connect();
    close = client.close;
    const { result } = (await client.request("tools/call", {
      name: "search_emoji",
      arguments: { query: "jurassic park", limit: 1 },
    })) as {
      result: { content: { type: string; text: string }[]; structuredContent: { results: unknown[] } };
    };

    expect(result.content).toEqual([{ type: "text", text: "🦖 T-Rex — jurassic park" }]);
    expect(result.structuredContent.results).toEqual([
      {
        emoji: "🦖",
        id: "1F996",
        label: "T-Rex",
        score: expect.any(Number),
        source: "alias",
        match: "jurassic park",
      },
    ]);
  });

  it("rejects a locale that no bundled pack provides", async () => {
    const client = await connect();
    close = client.close;
    const { result } = (await client.request("tools/call", {
      name: "suggest_reactions",
      arguments: { text: "hi", locale: "de" },
    })) as { result: { isError?: boolean; content: { text: string }[] } };
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("locale");
  });
});
