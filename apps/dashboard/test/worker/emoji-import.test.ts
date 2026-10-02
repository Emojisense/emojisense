import { afterEach, describe, expect, it, vi } from "vitest";
import type { EmojiImportResponse } from "../../src/shared/contract";
import {
  DISCORD_API,
  parseDiscordEmojiList,
  parseSlackEmojiList,
  SLACK_EMOJI_LIST_URL,
} from "../../src/worker/emoji-sources";
import type { Deps } from "../../src/worker/env";
import { IMPORT_BATCH } from "../../src/worker/routes/emoji-import";
import { emojiHarness, IMAGES } from "./emoji-fixtures";
import { body, type Harness } from "./harness";

const SLACK_TOKEN = "xoxp-1111111111-2222222222-secretsecret";
const BOT_TOKEN = "MTAxMjM0NTY3ODkw.Gabcde.secret-bot-token-value";
const GUILD = "123456789012345678";
const CDN = "https://emoji.slack-edge.com/T0001";

type Route = (url: string, init?: RequestInit) => Response | Promise<Response>;

/** Stubs the network: each URL answers from `routes`; anything else fails the test. */
function network(h: Harness, routes: Record<string, Route>) {
  h.fetchMock.mockImplementation(async (url, init) => {
    const route = routes[url];
    if (!route) throw new Error(`unexpected fetch ${url}`);
    return route(url, init);
  });
}

const json =
  (data: unknown, status = 200) =>
  () =>
    Response.json(data, { status });
const bytes = (data: Uint8Array) => () => new Response(data.slice());
const fetchedUrls = (h: Harness) => h.fetchMock.mock.calls.map(([url]) => url);
const headersOf = (init: RequestInit | undefined) => new Headers(init?.headers);

/** Every value in every table, to prove a token was never stored. */
function databaseDump(h: Harness): string {
  const tables = h.db.rows<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'");
  return JSON.stringify(tables.map(({ name }) => h.db.rows(`SELECT * FROM "${name}"`)));
}

async function slackImport(plan = "pro") {
  const harness = await emojiHarness(plan);
  const run = (input: Record<string, unknown> = { token: SLACK_TOKEN }, cookie = harness.cookie) =>
    harness.h.call("POST", `/api/apps/${harness.appId}/emoji/import/slack`, { cookie, body: input });
  return { ...harness, run };
}

async function discordImport(plan = "pro") {
  const harness = await emojiHarness(plan);
  const run = (input: Record<string, unknown> = { botToken: BOT_TOKEN, guildId: GUILD }) =>
    harness.h.call("POST", `/api/apps/${harness.appId}/emoji/import/discord`, {
      cookie: harness.cookie,
      body: input,
    });
  return { ...harness, run };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseSlackEmojiList", () => {
  it("keeps images on Slack's CDN, counts aliases, and drops anything else", () => {
    expect(
      parseSlackEmojiList({
        ok: true,
        emoji: {
          parrot: `${CDN}/parrot/a.gif`,
          parrot2: "alias:parrot",
          tracker: "https://evil.example/pixel.png",
          plain: "http://emoji.slack-edge.com/T0001/plain/a.png",
          odd: 42,
        },
      }),
    ).toEqual({ candidates: [{ name: "parrot", url: `${CDN}/parrot/a.gif` }], aliases: 1, invalid: 3 });
  });

  it("reads a body without emoji as empty", () => {
    expect(parseSlackEmojiList(null)).toEqual({ candidates: [], aliases: 0, invalid: 0 });
  });
});

describe("parseDiscordEmojiList", () => {
  it("builds CDN URLs: GIF for animated emoji, PNG otherwise", () => {
    expect(
      parseDiscordEmojiList([
        { id: "111111111111111111", name: "PartyBlob", animated: true },
        { id: "222222222222222222", name: "ok_hand" },
        { id: "../../etc", name: "bad" },
        { name: "no_id" },
      ]),
    ).toEqual({
      candidates: [
        { name: "PartyBlob", url: "https://cdn.discordapp.com/emojis/111111111111111111.gif?size=128" },
        { name: "ok_hand", url: "https://cdn.discordapp.com/emojis/222222222222222222.png?size=128" },
      ],
      aliases: 0,
      invalid: 2,
    });
    expect(parseDiscordEmojiList({ message: "nope" })).toEqual({ candidates: [], aliases: 0, invalid: 0 });
  });
});

describe("POST /api/apps/:id/emoji/import/slack", () => {
  it("imports the images, skips aliases and bad names, and never keeps the token", async () => {
    const { h, run } = await slackImport();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    network(h, {
      [SLACK_EMOJI_LIST_URL]: json({
        ok: true,
        emoji: {
          parrot: `${CDN}/parrot/a.gif`,
          shipit: `${CDN}/shipit/b.png`,
          parrot_alias: "alias:parrot",
          "Bad Name": `${CDN}/bad/c.png`,
          tracker: "https://evil.example/pixel.png",
        },
      }),
      [`${CDN}/parrot/a.gif`]: bytes(IMAGES.gif),
      [`${CDN}/shipit/b.png`]: bytes(IMAGES.png),
    });

    const response = await run();
    expect(response.status).toBe(200);
    expect(await body<EmojiImportResponse>(response)).toEqual({
      imported: 2,
      skipped: 3,
      remaining: 0,
      skippedBy: { alias: 1, exists: 0, invalid: 2, limit: 0, failed: 0 },
    });
    const [listCall] = h.fetchMock.mock.calls;
    expect(headersOf(listCall?.[1]).get("authorization")).toBe(`Bearer ${SLACK_TOKEN}`);
    expect(fetchedUrls(h)).not.toContain("https://evil.example/pixel.png");
    expect(h.db.rows("SELECT shortcode, source FROM custom_emoji ORDER BY shortcode")).toEqual([
      { shortcode: "parrot", source: "slack" },
      { shortcode: "shipit", source: "slack" },
    ]);
    expect(databaseDump(h)).not.toContain("secretsecret");
    expect(JSON.stringify(log.mock.calls)).not.toContain("secretsecret");
  });

  it("answers 402 below Pro and 403 to viewers", async () => {
    const solo = await slackImport("solo");
    const refused = await solo.run();
    expect(refused.status).toBe(402);
    expect(await body(refused)).toMatchObject({ error: { code: "plan_required", plan: "pro" } });

    const pro = await slackImport("pro");
    const viewer = await pro.member("vic", "viewer");
    expect((await pro.run({ token: SLACK_TOKEN }, viewer)).status).toBe(403);
    expect(pro.h.fetchMock).not.toHaveBeenCalled();
  });

  it.each([[{}], [{ token: "" }], [{ token: "not-a-token" }], [{ token: "xoxp-short" }], [{ token: 42 }]])(
    "rejects %j",
    async (input) => {
      const { h, run } = await slackImport();
      const response = await run(input);
      expect(response.status).toBe(400);
      expect(await body(response)).toMatchObject({ error: { code: "invalid_request", field: "token" } });
      expect(h.fetchMock).not.toHaveBeenCalled();
    },
  );

  it("reports a refused token without echoing it", async () => {
    const { h, run } = await slackImport();
    network(h, { [SLACK_EMOJI_LIST_URL]: json({ ok: false, error: "invalid_auth" }) });
    const response = await run();
    expect(response.status).toBe(400);
    const error = await body<{ error: { code: string; field: string; message: string } }>(response);
    expect(error.error).toMatchObject({ code: "import_auth_failed", field: "token" });
    expect(error.error.message).toContain("invalid_auth");
    expect(error.error.message).not.toContain(SLACK_TOKEN);
  });

  it("maps Slack outages and rate limits", async () => {
    const { h, run } = await slackImport();
    network(h, { [SLACK_EMOJI_LIST_URL]: json({ ok: false, error: "fatal_error" }) });
    expect((await run()).status).toBe(502);
    network(h, { [SLACK_EMOJI_LIST_URL]: json({}, 429) });
    const limited = await run();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    h.fetchMock.mockRejectedValue(new TypeError("network down"));
    expect(await body(await run())).toMatchObject({ error: { code: "import_unavailable" } });
  });

  it("skips existing shortcodes, failed downloads and files that are not images", async () => {
    const { h, run, upload } = await slackImport();
    const form = { file: new File([IMAGES.png.slice()], "a.png"), shortcode: "taken" };
    expect((await upload(form)).status).toBe(201);
    network(h, {
      [SLACK_EMOJI_LIST_URL]: json({
        ok: true,
        emoji: {
          taken: `${CDN}/taken/a.png`,
          gone: `${CDN}/gone/a.png`,
          text: `${CDN}/text/a.png`,
          huge: `${CDN}/huge/a.png`,
        },
      }),
      [`${CDN}/gone/a.png`]: () => new Response("not found", { status: 404 }),
      [`${CDN}/text/a.png`]: bytes(IMAGES.text),
      [`${CDN}/huge/a.png`]: bytes(new Uint8Array(256 * 1024 + 1)),
    });
    expect(await body<EmojiImportResponse>(await run())).toMatchObject({
      imported: 0,
      skippedBy: { exists: 1, failed: 1, invalid: 2 },
    });
  });

  it("stops at the plan limit", async () => {
    const { h, run, fill } = await slackImport("pro");
    fill(1999);
    network(h, {
      [SLACK_EMOJI_LIST_URL]: json({ ok: true, emoji: { a: `${CDN}/a.png`, b: `${CDN}/b.png` } }),
      [`${CDN}/a.png`]: bytes(IMAGES.png),
    });
    expect(await body<EmojiImportResponse>(await run())).toMatchObject({
      imported: 1,
      remaining: 0,
      skippedBy: { limit: 1 },
    });
  });

  it(`stores at most ${IMPORT_BATCH} per call and finishes on the next call`, async () => {
    const { h, run } = await slackImport();
    const emoji = Object.fromEntries(
      Array.from({ length: IMPORT_BATCH + 5 }, (_, i) => [
        `e${String(i).padStart(3, "0")}`,
        `${CDN}/${i}.png`,
      ]),
    );
    h.fetchMock.mockImplementation(async (url: string) =>
      url === SLACK_EMOJI_LIST_URL ? Response.json({ ok: true, emoji }) : new Response(IMAGES.png.slice()),
    );
    expect(await body<EmojiImportResponse>(await run())).toMatchObject({
      imported: IMPORT_BATCH,
      remaining: 5,
    });
    expect(await body<EmojiImportResponse>(await run())).toMatchObject({
      imported: 5,
      remaining: 0,
      skippedBy: { exists: IMPORT_BATCH },
    });
  });
});

describe("POST /api/apps/:id/emoji/import/discord", () => {
  it("imports the server's emoji from the CDN with a bot token", async () => {
    const { h, run } = await discordImport();
    const list = `${DISCORD_API}/guilds/${GUILD}/emojis`;
    network(h, {
      [list]: json([
        { id: "111111111111111111", name: "PartyBlob", animated: true },
        { id: "222222222222222222", name: "partyblob" },
      ]),
      "https://cdn.discordapp.com/emojis/111111111111111111.gif?size=128": bytes(IMAGES.gif),
    });
    expect(await body<EmojiImportResponse>(await run())).toMatchObject({
      imported: 1,
      skippedBy: { exists: 1 },
    });
    const listCall = h.fetchMock.mock.calls.find(([url]) => url === list) as Parameters<Deps["fetch"]>;
    expect(headersOf(listCall[1]).get("authorization")).toBe(`Bot ${BOT_TOKEN}`);
    expect(h.db.rows("SELECT shortcode, source, content_type FROM custom_emoji")).toEqual([
      { shortcode: "partyblob", source: "discord", content_type: "image/gif" },
    ]);
    expect(databaseDump(h)).not.toContain(BOT_TOKEN);
  });

  it.each([
    [{ guildId: GUILD }, "botToken"],
    [{ botToken: "short", guildId: GUILD }, "botToken"],
    [{ botToken: BOT_TOKEN }, "guildId"],
    [{ botToken: BOT_TOKEN, guildId: "../../users/@me" }, "guildId"],
  ])("rejects %j", async (input, field) => {
    const { h, run } = await discordImport();
    const response = await run(input);
    expect(response.status).toBe(400);
    expect(await body(response)).toMatchObject({ error: { code: "invalid_request", field } });
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [401, 400, "import_auth_failed", "botToken"],
    [403, 400, "import_auth_failed", "guildId"],
    [404, 400, "invalid_request", "guildId"],
    [500, 502, "import_unavailable", undefined],
  ])("maps Discord %i to %i %s", async (upstream, status, code, field) => {
    const { h, run } = await discordImport();
    network(h, { [`${DISCORD_API}/guilds/${GUILD}/emojis`]: json({ message: "x" }, upstream) });
    const response = await run();
    expect(response.status).toBe(status);
    expect(await body(response)).toMatchObject({ error: { code, ...(field ? { field } : {}) } });
  });

  it("needs Pro", async () => {
    const { run, h } = await discordImport("solo");
    expect((await run()).status).toBe(402);
    expect(h.fetchMock).not.toHaveBeenCalled();
  });
});
