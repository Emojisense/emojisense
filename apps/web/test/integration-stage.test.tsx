// @vitest-environment happy-dom
/**
 * The integration stage on /integrations/: tabs, the ":" field on the real engine, and the
 * WCAG 2.2.2 stop control. Skipped until `pnpm data:build` has produced the packs.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createEngine, type Pack } from "emojisense";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PACK_VERSION } from "../src/config";
import { SKINS, type SkinId } from "../src/demos/stage/skins";
import en from "../src/i18n/en.json";
import { IntegrationStage } from "../src/islands/IntegrationStage";

const PACK_DIR = join(process.cwd(), "../../packages/data/dist/packs", PACK_VERSION);
const built = existsSync(join(PACK_DIR, "pack.en.json"));
const pack = (name: string) => JSON.parse(readFileSync(join(PACK_DIR, `pack.${name}.json`), "utf8")) as Pack;
const packs = built ? [pack("en"), pack("en.ext")] : [];
const engine = built ? createEngine(packs) : undefined;

// The real engine on the built packs, without network: no meaning search, English pages.
vi.mock("../src/lib/engine-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/engine-client")>()),
  useEngine: () => ({ engine, ready: "all" }),
  sharedSemantic: () => undefined,
  pageLocale: () => "en",
}));

// The React tab's `useEmojisense`, ready with the same engine.
vi.mock("@emojisense/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@emojisense/react")>()),
  useEmojisense: () => ({
    engine,
    semantic: undefined,
    packs,
    locale: "en",
    status: "ready",
    extended: true,
  }),
}));

const names = Object.fromEntries(
  SKINS.map((skin) => [skin.id, en.integrations.items[skin.key].name]),
) as Record<SkinId, string>;

function renderStage() {
  return render(
    <IntegrationStage
      messages={en.integrations.stage}
      names={names}
      statusLabels={en.integrations.status}
      lang="en"
    />,
  );
}

beforeAll(() => {
  // The stage is on screen at once, so the autoplay may start.
  globalThis.IntersectionObserver = class {
    constructor(private readonly callback: IntersectionObserverCallback) {}
    observe(target: Element) {
      this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as never);
    }
    disconnect() {}
    unobserve() {}
    takeRecords() {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
});

afterEach(cleanup);

describe.skipIf(!built)("integration stage", () => {
  it("has a tab for every tool and moves between them with the arrow keys", () => {
    renderStage();
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(SKINS.length);
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("heading", { name: names.react })).toBeTruthy();

    fireEvent.keyDown(tabs[0] as HTMLElement, { key: "ArrowRight" });
    expect(screen.getAllByRole("tab")[1]?.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("heading", { name: names.tiptap })).toBeTruthy();

    fireEvent.keyDown(screen.getAllByRole("tab")[1] as HTMLElement, { key: "End" });
    expect(screen.getByRole("heading", { name: names.mcp })).toBeTruthy();
  });

  it("shows Stop demo while the tool plays, and stops on the finished state", () => {
    renderStage();
    fireEvent.click(screen.getByRole("button", { name: en.integrations.stage.stop }));
    const message = screen.getByLabelText(en.integrations.stage.skins.react.label) as HTMLInputElement;
    expect(message.value).toBe(`${en.integrations.stage.skins.react.line} 🐐 `);
    expect(screen.queryByRole("button", { name: en.integrations.stage.stop })).toBeNull();
  });

  it("opens with the React picker, whose search ranks by meaning and inserts the pick", () => {
    renderStage();
    const message = screen.getByLabelText(en.integrations.stage.skins.react.label) as HTMLInputElement;
    const search = screen.getByPlaceholderText(en.integrations.stage.skins.react.search);
    fireEvent.focusIn(search);
    fireEvent.change(search, { target: { value: "greatest of all time" } });

    const first = within(screen.getByRole("listbox")).getAllByRole("option")[0];
    expect(first?.textContent).toBe("🐐");
    fireEvent.click(first as HTMLElement);
    expect(message.value).toBe("🐐 ");
  });

  it("completes a ':' query from the engine and inserts the picked emoji", () => {
    renderStage();
    fireEvent.click(screen.getByRole("tab", { name: /Tiptap/ }));
    const field = screen.getByLabelText(en.integrations.stage.skins.tiptap.label) as HTMLTextAreaElement;
    // The visitor's first touch hands the field over to them.
    fireEvent.focusIn(field);
    const text = "We ship today :ship it";
    fireEvent.change(field, {
      target: { value: text, selectionStart: text.length, selectionEnd: text.length },
    });

    const list = screen.getByRole("listbox");
    const first = within(list).getAllByRole("option")[0];
    expect(first?.textContent).toContain("🚀");

    fireEvent.keyDown(field, { key: "Enter" });
    expect(field.value).toBe("We ship today 🚀 ");
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
