import type { Editor, TinyMCE, Ui } from "tinymce";
import { describe, expect, it, vi } from "vitest";
import { PLUGIN_NAME, registerEmojisense } from "../src/plugin.js";
import { engine, stubSemantic } from "./fixture.js";

type Spec = Ui.InlineContent.AutocompleterSpec;

/** The parts of TinyMCE the plugin uses, with the editor's `init` and `remove` events. */
function fakeTinyMce(settings: Record<string, unknown>, plugins: string[] = []) {
  const handlers: Record<string, (() => void)[]> = {};
  const autocompleters: Record<string, Spec> = {};
  const defaults: Record<string, unknown> = {};
  const commands: string[] = [];
  const editor = {
    removed: false,
    options: {
      register: (name: string, spec: { default?: unknown }) => {
        defaults[name] = spec.default;
      },
      get: (name: string) => (name in settings ? settings[name] : defaults[name]),
    },
    on: (event: string, handler: () => void) => {
      handlers[event] = [...(handlers[event] ?? []), handler];
    },
    ui: {
      registry: {
        addAutocompleter: (name: string, spec: Spec) => {
          autocompleters[name] = spec;
        },
      },
    },
    hasPlugin: (name: string) => plugins.includes(name),
    queryCommandState: () => false,
    execCommand: (name: string) => commands.push(name),
    selection: { setRng: vi.fn() },
    insertContent: vi.fn(),
  };
  let factory: ((editor: Editor, url: string) => unknown) | undefined;
  const tinymce = {
    PluginManager: { add: (_name: string, fn: typeof factory) => (factory = fn) },
  } as unknown as TinyMCE;
  registerEmojisense(tinymce);
  const metadata = factory?.(editor as unknown as Editor, "");
  const fire = (event: string) => {
    for (const handler of handlers[event] ?? []) handler();
  };
  return { editor, autocompleters, metadata, fire, commands };
}

describe("registerEmojisense", () => {
  it("registers the plugin with its metadata", () => {
    const { metadata } = fakeTinyMce({ emojisense_engine: engine });
    expect(PLUGIN_NAME).toBe("emojisense");
    expect((metadata as { getMetadata(): { name: string } }).getMetadata().name).toBe("Emojisense");
  });

  it("adds the : autocompleter on init and inserts the chosen emoji", async () => {
    const { editor, autocompleters, fire } = fakeTinyMce({ emojisense_engine: engine });
    fire("init");
    const spec = autocompleters.emojisense;
    expect(spec?.trigger).toBe(":");
    const items = await spec?.fetch("pizza", 8, {});
    expect(items?.[0]).toMatchObject({ value: "🍕" });

    const range = document.createRange();
    spec?.onAction({ hide: vi.fn(), reload: vi.fn() }, range, "🍕", {});
    expect(editor.selection.setRng).toHaveBeenCalledWith(range);
    expect(editor.insertContent).toHaveBeenCalledWith("🍕");
  });

  it("takes over the emoticons plugin's : menu, unless told not to", () => {
    const replaced = fakeTinyMce({ emojisense_engine: engine }, ["emoticons"]);
    replaced.fire("init");
    expect(Object.keys(replaced.autocompleters)).toEqual(["emoticons"]);

    const kept = fakeTinyMce({ emojisense_engine: engine, emojisense_replace_emoticons: false }, [
      "emoticons",
    ]);
    kept.fire("init");
    expect(Object.keys(kept.autocompleters)).toEqual(["emojisense"]);
  });

  it("uses the configured semantic provider and skin tone", async () => {
    const semantic = stubSemantic();
    const { autocompleters, fire } = fakeTinyMce({
      emojisense_engine: engine,
      emojisense_semantic: semantic,
      emojisense_skin_tone: "dark",
    });
    fire("init");
    const spec = autocompleters.emojisense;
    await expect(spec?.fetch("thumbs", 8, {})).resolves.toMatchObject([{ value: "👍🏿" }]);
    await spec?.fetch("blastoff", 8, {});
    expect(semantic.calls).toEqual(["blastoff"]);
  });

  it("loads the packs from emojisense_pack_url in the editor's language", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      urls.push(String(input));
      const { en } = await import("./fixture.js");
      return new Response(JSON.stringify(String(input).includes(".tr.") ? { ...en, locale: "tr" } : en));
    });
    try {
      const { autocompleters, fire } = fakeTinyMce({
        emojisense_pack_url: "https://packs.test/0.1.0",
        language: "tr_TR",
      });
      fire("init");
      await vi.waitFor(async () => {
        const items = await autocompleters.emojisense?.fetch("pizza", 8, {});
        expect(items?.[0]).toMatchObject({ value: "🍕" });
      });
      expect(urls.slice(0, 2)).toEqual([
        "https://packs.test/0.1.0/pack.en.json",
        "https://packs.test/0.1.0/pack.tr.json",
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("warns and stays off without packs", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { autocompleters, fire } = fakeTinyMce({});
    fire("init");
    expect(warn).toHaveBeenCalled();
    return expect(autocompleters.emojisense?.fetch("pizza", 8, {})).resolves.toEqual([]);
  });
});
