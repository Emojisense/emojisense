import { ClassicEditor, type EditorConfig, Emoji, Essentials, Paragraph, version } from "ckeditor5";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmojisenseMention } from "../src/index.js";
import { en, engine, stubSemantic } from "./fixture.js";

const editors: ClassicEditor[] = [];

afterEach(async () => {
  await Promise.all(editors.splice(0).map((editor) => editor.destroy()));
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function createEditor(config: EditorConfig): Promise<ClassicEditor> {
  const element = document.createElement("div");
  document.body.append(element);
  const full = { licenseKey: "GPL", plugins: [Essentials, Paragraph, EmojisenseMention], ...config };
  // CKEditor 48 takes the element in the config; 47 takes it as the first argument.
  const create = ClassicEditor.create.bind(ClassicEditor) as (...args: unknown[]) => Promise<ClassicEditor>;
  const editor =
    Number(version.split(".")[0]) >= 48
      ? await create({ ...full, attachTo: element })
      : await create(element, full);
  editors.push(editor);
  return editor;
}

async function type(editor: ClassicEditor, text: string) {
  for (const char of text) {
    editor.execute("insertText", { text: char });
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const items = () =>
  Array.from(document.querySelectorAll<HTMLElement>(".emojisense-mention-item")).map(
    (item) => item.textContent ?? "",
  );

function pressEnter(editor: ClassicEditor) {
  const noop = () => {};
  editor.editing.view.document.fire("keydown", {
    keyCode: 13,
    preventDefault: noop,
    stopPropagation: noop,
    domEvent: { preventDefault: noop, stopPropagation: noop },
  });
}

describe(`EmojisenseMention (CKEditor ${version})`, () => {
  it("lists 🍕 first for :pizza and inserts it as text", async () => {
    const editor = await createEditor({ emojisense: { engine } });
    await type(editor, "I want :pizza");
    await vi.waitFor(() => expect(items()[0]).toBe("🍕 pizza"));
    pressEnter(editor);
    await vi.waitFor(() => expect(editor.getData()).toBe("<p>I want 🍕</p>"));
  });

  it("searches phrases with spaces", async () => {
    const editor = await createEditor({ emojisense: { engine } });
    await type(editor, ":ship it");
    await vi.waitFor(() => expect(items()[0]).toBe("🚀 rocket"));
    pressEnter(editor);
    await vi.waitFor(() => expect(editor.getData()).toBe("<p>🚀</p>"));
  });

  it("stays closed in times and sentences", async () => {
    const editor = await createEditor({ emojisense: { engine } });
    await type(editor, "at 12:30 and :one two three four five");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(items()).toEqual([]);
  });

  it("applies the skin tone", async () => {
    const editor = await createEditor({ emojisense: { engine, skinTone: "medium" } });
    await type(editor, ":thumbs");
    await vi.waitFor(() => expect(items()[0]).toBe("👍🏽 thumbs up"));
  });

  it("waits for search by meaning when the dictionary is unsure", async () => {
    const semantic = stubSemantic();
    const editor = await createEditor({ emojisense: { engine, semantic } });
    await type(editor, ":blastoff");
    await vi.waitFor(() => expect(items()[0]).toBe("🚀 rocket"));
    expect(semantic.calls).toContain("blastoff");
  });

  it("loads the packs from packUrl in the content language", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(JSON.stringify(String(input).includes(".tr.") ? { ...en, locale: "tr" } : en));
    });
    try {
      const editor = await createEditor({
        language: { content: "tr" },
        emojisense: { packUrl: "https://packs.test/0.1.0" },
      });
      await vi.waitFor(() => expect(urls).toContain("https://packs.test/0.1.0/pack.tr.json"));
      await type(editor, ":pizza");
      await vi.waitFor(() => expect(items()[0]).toBe("🍕 pizza"));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("leaves : to the official EmojiMention when both are loaded, with a warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // The emoji feature loads its definitions from the CKEditor CDN: no network in tests.
    vi.stubGlobal("fetch", async () => new Response("[]"));
    const editor = await createEditor({
      plugins: [Essentials, Paragraph, Emoji, EmojisenseMention],
      emoji: { definitionsUrl: "cdn", useCustomFont: true },
      emojisense: { engine },
    });
    const feeds = editor.config.get("mention.feeds") ?? [];
    expect(feeds.filter((feed) => feed.marker === ":")).toHaveLength(1);
    expect(warn.mock.calls.some((call) => String(call[0]).includes("emojisense-marker-conflict"))).toBe(true);
  });
});
