import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "../../src/app/App";
import type { CustomEmoji, CustomEmojiListResponse, EmojiImportResponse } from "../../src/shared/contract";
import { APP, me, stubApi } from "./fake-api";

const PRO_APP = { ...APP, plan: "pro" as const };

function emoji(shortcode: string, overrides: Partial<CustomEmoji> = {}): CustomEmoji {
  return {
    id: `emo_${shortcode}`,
    shortcode,
    aliases: [],
    imageUrl: `http://localhost:8788/v1/custom/app_1/emo_${shortcode}`,
    tenantId: null,
    source: "upload",
    bytes: 812,
    createdAt: 1,
    ...overrides,
  };
}

const png = (name: string) =>
  new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type: "image/png" });

function openEmojiPage(routes: Parameters<typeof stubApi>[0], app: typeof APP = PRO_APP) {
  window.history.replaceState(null, "", "/apps/app_1/emoji");
  const fake = stubApi({
    "GET /api/me": { body: me() },
    "GET /api/apps": { body: { apps: [app] } },
    "GET /api/apps/app_1": { body: { app, keys: [] } },
    ...routes,
  });
  render(<App />);
  return fake;
}

describe("custom emoji usage", () => {
  it("shows the account's used and limit, and this app's part of it", async () => {
    openEmojiPage({
      "GET /api/apps/app_1/emoji": {
        body: { emoji: [emoji("shipit"), emoji("lgtm")], used: 1_203, limit: 2_000 },
      },
    });

    const meter = await screen.findByRole("meter", { name: "Custom emoji used" });
    expect(meter.getAttribute("aria-valuetext")).toBe("1,203 of 2,000");
    expect(screen.getByText("This app: 2 of 1,203. The limit counts every app of the account.")).toBeTruthy();
    expect(screen.queryByText(/Delete some to add new ones/)).toBeNull();
    expect((screen.getByRole("button", { name: "Upload emoji" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("turns uploads off at the account's limit and says why", async () => {
    openEmojiPage({
      "GET /api/apps/app_1/emoji": { body: { emoji: [emoji("shipit")], used: 2_000, limit: 2_000 } },
    });

    expect(
      await screen.findByText(
        "All 2,000 custom emoji of the Pro plan are in use across the account’s apps. Delete some to add new ones.",
      ),
    ).toBeTruthy();
    expect((screen.getByRole("button", { name: "Upload emoji" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps emoji left after a downgrade listed, so they can be deleted", async () => {
    openEmojiPage(
      { "GET /api/apps/app_1/emoji": { body: { emoji: [emoji("shipit")], used: 1, limit: 0 } } },
      { ...APP, plan: "free" },
    );

    expect(await screen.findByRole("button", { name: ":shipit:" })).toBeTruthy();
    expect(
      screen.getByText(/^Custom emoji are not part of the Free plan\. You can still edit and delete these\./),
    ).toBeTruthy();
  });
});

describe("custom emoji upload", () => {
  it("names the file the API refused as image_too_large, and can skip it", async () => {
    const list: CustomEmojiListResponse = { emoji: [], used: 7, limit: 2_000 };
    const { calls } = openEmojiPage({
      "GET /api/apps/app_1/emoji": { body: list },
      "POST /api/apps/app_1/emoji": ({ body }) =>
        (body as FormData).get("shortcode") === "huge"
          ? {
              status: 413,
              body: {
                error: {
                  code: "image_too_large",
                  message: "The image is larger than 256 KB.",
                  field: "file",
                },
              },
            }
          : { status: 201, body: emoji("shipit") },
    });

    const input = await screen.findByLabelText(/choose files/);
    fireEvent.change(input, { target: { files: [png("huge.png"), png("shipit.png")] } });
    const dialog = await screen.findByRole("dialog", { name: "Upload a custom emoji" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Upload and next" }));

    expect((await within(dialog).findByRole("alert")).textContent).toBe(
      "huge.png is too large. The limit is 256 KB.",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Skip this image" }));
    expect(within(dialog).getByText("shipit.png")).toBeTruthy();
    expect(within(dialog).queryByRole("alert")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Upload emoji" }));

    expect(await screen.findByRole("button", { name: ":shipit:" })).toBeTruthy();
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(2);
  });
});

const importAnswer = (
  imported: number,
  remaining: number,
  skippedBy: Partial<EmojiImportResponse["skippedBy"]> = {},
): EmojiImportResponse => {
  const reasons = { alias: 0, exists: 0, invalid: 0, limit: 0, failed: 0, ...skippedBy };
  return {
    imported,
    remaining,
    skipped: Object.values(reasons).reduce((a, b) => a + b, 0),
    skippedBy: reasons,
  };
};

async function startSlackImport(token: string) {
  fireEvent.click(await screen.findByRole("button", { name: "Import" }));
  fireEvent.click(screen.getByRole("button", { name: /From Slack/ }));
  const dialog = await screen.findByRole("dialog", { name: "Import from Slack" });
  fireEvent.change(within(dialog).getByLabelText("Slack user token"), { target: { value: token } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Import emoji" }));
  return dialog;
}

describe("custom emoji import", () => {
  it("calls again with the same token while emoji remain, then sums up the whole import", async () => {
    const answers = [
      importAnswer(50, 62, { alias: 4, exists: 2 }),
      importAnswer(50, 12, { alias: 4, exists: 52 }),
      importAnswer(12, 0, { alias: 4, exists: 102, limit: 1 }),
    ];
    const { calls } = openEmojiPage({
      "GET /api/apps/app_1/emoji": { body: { emoji: [], used: 0, limit: 2_000 } },
      "POST /api/apps/app_1/emoji/import/slack": () => ({ body: answers.shift() }),
    });

    const dialog = await startSlackImport("xoxp-test-token");

    expect(await within(dialog).findByText("Imported 112 emoji.")).toBeTruthy();
    expect(
      within(dialog).getByText(
        "Skipped 7: 2 already in this app, 4 aliases of other emoji, 1 over your plan’s limit.",
      ),
    ).toBeTruthy();
    const imports = calls.filter((call) => call.path.endsWith("/import/slack"));
    expect(imports).toHaveLength(3);
    expect(imports.every((call) => (call.body as { token: string }).token === "xoxp-test-token")).toBe(true);
    // The page lists the emoji again once the import stored new ones.
    expect(calls.filter((call) => call.path === "/api/apps/app_1/emoji").length).toBeGreaterThan(1);
  });

  it("keeps what an import stored when a later batch fails, and continues it", async () => {
    const answers: { status?: number; body: unknown }[] = [
      { body: importAnswer(50, 30) },
      {
        status: 429,
        body: {
          error: { code: "import_rate_limited", message: "Slack is limiting requests. Wait a minute." },
        },
      },
      { body: importAnswer(30, 0, { exists: 50 }) },
    ];
    const { calls } = openEmojiPage({
      "GET /api/apps/app_1/emoji": { body: { emoji: [], used: 0, limit: 2_000 } },
      "POST /api/apps/app_1/emoji/import/slack": () => answers.shift() ?? { status: 500, body: null },
    });

    const dialog = await startSlackImport("xoxp-test-token");

    expect((await within(dialog).findByRole("alert")).textContent).toBe(
      "Slack is limiting requests. Wait a minute.",
    );
    expect(within(dialog).getByText("Imported 50 emoji so far.")).toBeTruthy();
    expect(within(dialog).getByText("30 more wait. Continue to import them.")).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Continue import" }));
    expect(await within(dialog).findByText("Imported 80 emoji.")).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Continue import" })).toBeNull();
    expect(calls.filter((call) => call.path.endsWith("/import/slack"))).toHaveLength(3);
  });
});
