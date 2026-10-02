import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "../../src/app/App";
import type { CustomEmoji, CustomEmojiListResponse } from "../../src/shared/contract";
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

function openEmojiPage(routes: Parameters<typeof stubApi>[0]) {
  window.history.replaceState(null, "", "/apps/app_1/emoji");
  const fake = stubApi({
    "GET /api/me": { body: me() },
    "GET /api/apps": { body: { apps: [PRO_APP] } },
    "GET /api/apps/app_1": { body: { app: PRO_APP, keys: [] } },
    ...routes,
  });
  render(<App />);
  return fake;
}

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
