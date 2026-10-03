import { $createListItemNode, $createListNode, ListItemNode, ListNode } from "@lexical/list";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { EditorRefPlugin } from "@lexical/react/LexicalEditorRefPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { TablePlugin } from "@lexical/react/LexicalTablePlugin";
import { $createTableNodeWithDimensions, TableCellNode, TableNode, TableRowNode } from "@lexical/table";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { type AliasEngine, createEngine } from "emojisense";
import {
  $createTextNode,
  $getRoot,
  $isElementNode,
  COMMAND_PRIORITY_LOW,
  CONTROLLED_TEXT_INSERTION_COMMAND,
  type ElementNode,
  type LexicalEditor,
} from "lexical";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmojiAutocompletePlugin, type EmojiAutocompletePluginProps } from "../src/index.js";
import { en, engine, pt, stubSemantic, tr } from "./fixture.js";

afterEach(() => {
  vi.restoreAllMocks();
});

type EditorProps = Partial<EmojiAutocompletePluginProps> & {
  editorRef: React.RefObject<LexicalEditor | null>;
  /** Rich text with list and table support, starting from this content. */
  richContent?: () => void;
};

function Editor(props: EditorProps) {
  const { editorRef, richContent, ...plugin } = props;
  const contentEditable = <ContentEditable aria-label="Message" />;
  return (
    <LexicalComposer
      initialConfig={{
        namespace: "test",
        nodes: [ListNode, ListItemNode, TableNode, TableRowNode, TableCellNode],
        ...(richContent ? { editorState: richContent } : {}),
        onError: (error) => {
          throw error;
        },
      }}
    >
      {richContent ? (
        <>
          <RichTextPlugin contentEditable={contentEditable} ErrorBoundary={LexicalErrorBoundary} />
          <ListPlugin />
          <TablePlugin />
        </>
      ) : (
        <PlainTextPlugin contentEditable={contentEditable} ErrorBoundary={LexicalErrorBoundary} />
      )}
      <EditorRefPlugin editorRef={editorRef} />
      <EmojiAutocompletePlugin engine={engine} {...plugin} />
    </LexicalComposer>
  );
}

function setup(props: Omit<EditorProps, "editorRef"> = {}) {
  const editorRef = createRef<LexicalEditor>();
  const view = render(<Editor editorRef={editorRef} {...props} />);
  const editor = editorRef.current as LexicalEditor;
  act(() => editor.update(() => $getRoot().selectEnd(), { discrete: true }));
  return { ...view, editor, root: editor.getRootElement() as HTMLElement };
}

/** A one-row, two-cell table with the caret in the first cell. */
function setupTable(props: Partial<EmojiAutocompletePluginProps> = {}) {
  const view = setup({
    ...props,
    richContent: () => {
      $getRoot().append($createTableNodeWithDimensions(1, 2, false));
    },
  });
  const selectFirstCell = () => {
    const firstCell = $getRoot().getFirstDescendant();
    if ($isElementNode(firstCell)) firstCell.selectEnd();
  };
  act(() => view.editor.update(selectFirstCell, { discrete: true }));
  return view;
}

/** Type like the browser does: each character is a controlled text insertion. */
async function type(editor: LexicalEditor, text: string) {
  for (const char of text) {
    await act(async () => {
      editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, char);
    });
  }
}

async function press(root: HTMLElement, key: string, init: KeyboardEventInit = {}) {
  let prevented = false;
  await act(async () => {
    prevented = !fireEvent.keyDown(root, { key, ...init });
  });
  return prevented;
}

const text = (editor: LexicalEditor) => editor.getEditorState().read(() => $getRoot().getTextContent());

const childTexts = (element: ElementNode) => element.getChildren().map((child) => child.getTextContent());
const listItems = (editor: LexicalEditor) =>
  editor.getEditorState().read(() => childTexts($getRoot().getFirstChildOrThrow<ListNode>()));
/** The cells of a one-row table. */
const tableCells = (editor: LexicalEditor) =>
  editor
    .getEditorState()
    .read(() =>
      childTexts($getRoot().getFirstChildOrThrow<TableNode>().getFirstChildOrThrow<TableRowNode>()),
    );
const ROW = 40;

/**
 * happy-dom has no layout. Give the menu's scrolling list room for `rows` options of 40 px,
 * 100 px below the viewport top, drawn at `scale` (a CSS transform scales the rects only).
 */
function stubMenuLayout(rows: number, scale = 1) {
  const isList = (element: Element) => element.classList.contains("emojisense-menu");
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
    return isList(this) ? rows * ROW : 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
    return isList(this) ? rows * ROW : 0;
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (isList(this)) return new DOMRect(0, 100, 200, rows * ROW * scale);
    const list = this.parentElement;
    if (this.getAttribute("role") !== "option" || !list) return new DOMRect();
    const top = [...list.children].indexOf(this) * ROW - list.scrollTop;
    return new DOMRect(0, 100 + top * scale, 200, ROW * scale);
  });
}

/** Everything that would move the page or the host's containers instead of the menu. */
function spyOnPageScroll() {
  return [
    vi.spyOn(Element.prototype, "scrollIntoView"),
    vi.spyOn(window, "scrollTo"),
    vi.spyOn(window, "scrollBy"),
  ];
}

const options = () => [...document.querySelectorAll<HTMLElement>("[role=option]")];
const shown = () => options().map((option) => option.querySelector(".emojisense-menu__emoji")?.textContent);
const selected = () => options().find((option) => option.getAttribute("aria-selected") === "true");

describe("EmojiAutocompletePlugin (Lexical)", () => {
  it("typing :jurassic shows 🦖 first, and Enter inserts it", async () => {
    const { editor, root } = setup();
    await type(editor, "hi :jurassic");

    expect(shown()[0]).toBe("🦖");
    expect(selected()?.textContent).toContain("T-Rex");
    const listbox = document.querySelector("[role=listbox]");
    expect(listbox?.contains(options()[0] as Node)).toBe(true);
    expect(root.getAttribute("aria-controls")).toBe(listbox?.id);
    expect(root.getAttribute("aria-activedescendant")).toBe(selected()?.id);
    expect(document.querySelector("[role=group]")?.getAttribute("aria-label")).toBe("Emoji suggestions");

    expect(await press(root, "Enter")).toBe(true);
    expect(text(editor)).toBe("hi 🦖");
    expect(options()).toHaveLength(0);
    await type(editor, "!");
    expect(text(editor)).toBe("hi 🦖!");
  });

  it("updates the results on every keystroke", async () => {
    const { editor } = setup();
    await type(editor, ":d");
    expect(shown()).toContain("🦕");
    await type(editor, "ino");
    expect(shown().slice(0, 2).sort()).toEqual(["🦕", "🦖"]);
    await type(editor, " :ro");
    expect(shown()).toEqual(["🚀"]);
  });

  it("moves with the arrow keys (wrapping) and inserts with Tab", async () => {
    const { editor, root } = setup();
    await type(editor, ":jurassic");
    const count = options().length;
    expect(count).toBeGreaterThan(1);
    await press(root, "ArrowUp");
    expect(selected()?.id).toBe(options()[count - 1]?.id);
    await press(root, "ArrowDown");
    await press(root, "ArrowDown");
    expect(selected()?.id).toBe(options()[1]?.id);
    expect(root.getAttribute("aria-activedescendant")).toBe(options()[1]?.id);
    const second = shown()[1];
    expect(await press(root, "Tab")).toBe(true);
    expect(text(editor)).toBe(second);
  });

  it.each([1, 0.5])("scrolls only the menu to the active option (scale %s)", async (scale) => {
    stubMenuLayout(1, scale);
    const pageScroll = spyOnPageScroll();
    const { editor, root } = setup();
    await type(editor, ":jurassic");
    const list = document.querySelector(".emojisense-menu") as HTMLElement;
    const last = options().length - 1;
    expect(last).toBeGreaterThan(0);
    expect(list.scrollTop).toBe(0);

    await press(root, "ArrowDown");
    expect(list.scrollTop).toBe(ROW);
    await press(root, "ArrowUp");
    expect(list.scrollTop).toBe(0);
    await press(root, "ArrowUp");
    expect(list.scrollTop).toBe(last * ROW);
    for (const spy of pageScroll) expect(spy).not.toHaveBeenCalled();
  });

  it("inserts without asking Lexical to scroll the caret into view", async () => {
    const { editor, root } = setup();
    await type(editor, ":jurassic");
    const updates: Set<string>[] = [];
    editor.registerUpdateListener(({ tags }) => {
      updates.push(tags);
    });
    await press(root, "Enter");
    expect(text(editor)).toBe("🦖");
    expect(updates[0]?.has("skip-scroll-into-view")).toBe(true);
  });

  it("Escape closes the menu, keeps the typed text and stays closed for that word", async () => {
    const { editor, root } = setup();
    await type(editor, ":jurassic");
    expect(options().length).toBeGreaterThan(0);
    expect(await press(root, "Escape")).toBe(true);
    expect(options()).toHaveLength(0);
    expect(text(editor)).toBe(":jurassic");
    await type(editor, "p");
    expect(options()).toHaveLength(0);
    await type(editor, " :fir");
    expect(shown()[0]).toBe("🔥");
  });

  it("closes when nothing matches and leaves the keys to the editor", async () => {
    const { editor, root } = setup();
    await type(editor, ":jur");
    expect(options().length).toBeGreaterThan(0);
    await type(editor, "zzz");
    expect(options()).toHaveLength(0);
    expect(await press(root, "ArrowDown")).toBe(false);
    expect(await press(root, "Escape")).toBe(false);
    await press(root, "Enter");
    expect(text(editor)).toBe(":jurzzz\n");
  });

  it("opens only after a space, a parenthesis or the line start", async () => {
    const { editor } = setup();
    await type(editor, "12:fire");
    expect(options()).toHaveLength(0);
    await type(editor, " (:fire");
    expect(shown()[0]).toBe("🔥");
  });

  it("keeps shortcode characters (+, _, -) in the query", async () => {
    const { editor } = setup();
    await type(editor, ":+1");
    expect(shown()[0]).toBe("👍️");
  });

  it("inserts with the skin tone and shows toned emoji", async () => {
    const { editor, root } = setup({ skinTone: "dark" });
    await type(editor, ":lgtm");
    expect(shown()[0]).toBe("👍🏿");
    await press(root, "Enter");
    await type(editor, " :+1:");
    expect(text(editor)).toBe("👍🏿 👍🏿");
  });

  it("completes a typed :shortcode: (exact shortcode or name only)", async () => {
    const { editor } = setup();
    await type(editor, ":trex: :fire: :sweat_smile: :jurassic: :nope:");
    expect(text(editor)).toBe("🦖 🔥 😅 :jurassic: :nope:");
    expect(options()).toHaveLength(0);
  });

  it("leaves :shortcode: alone when shortcodes are off", async () => {
    const { editor } = setup({ shortcodes: false });
    await type(editor, ":trex:");
    expect(text(editor)).toBe(":trex:");
  });

  it("inserts the clicked option without taking focus from the editor", async () => {
    const { editor } = setup();
    await type(editor, ":jurassic");
    const target = options()[0] as HTMLElement;
    expect(fireEvent.mouseDown(target)).toBe(false);
    await act(async () => {
      fireEvent.click(target);
    });
    expect(text(editor)).toBe("🦖");
  });

  it("fuses semantic results into the menu later", async () => {
    const semantic = stubSemantic();
    // Long enough that typing through act() never outlasts it, so the first check sees no menu.
    const { editor, root } = setup({ semantic, debounceMs: 100 });
    await type(editor, ":blastoff");
    expect(options()).toHaveLength(0);
    await waitFor(() => expect(shown()).toEqual(["🚀"]));
    expect(options()[0]?.dataset.source).toBe("semantic");
    await press(root, "Enter");
    expect(text(editor)).toBe("🚀");
  });

  it("stays inactive until the engine is loaded", async () => {
    const editorRef = createRef<LexicalEditor>();
    const view = render(<Editor editorRef={editorRef} engine={undefined as AliasEngine | undefined} />);
    const editor = editorRef.current as LexicalEditor;
    act(() => editor.update(() => $getRoot().selectEnd(), { discrete: true }));
    await type(editor, ":fire");
    expect(options()).toHaveLength(0);
    view.rerender(<Editor editorRef={editorRef} engine={engine} />);
    // The query typed while the packs loaded opens its menu when they arrive.
    await waitFor(() => expect(shown()[0]).toBe("🔥"));
  });

  it("matches only phrases of the user's languages", async () => {
    const multilingual = createEngine([en, tr, pt]);
    const theirs = setup({ engine: multilingual, locales: ["tr", "en"] });
    await type(theirs.editor, ":foguete");
    expect(options()).toHaveLength(0);
    await type(theirs.editor, " :roket");
    expect(shown()[0]).toBe("🚀");
    theirs.unmount();
    const everyPack = setup({ engine: multilingual });
    await type(everyPack.editor, ":foguete");
    expect(shown()[0]).toBe("🚀");
  });

  describe("menuContainer", () => {
    const listbox = () => document.querySelector<HTMLElement>("[role=listbox]");
    function createFrame() {
      const frame = document.createElement("section");
      document.body.append(frame);
      return frame;
    }

    it("mounts the menu on <body> by default", async () => {
      const { editor } = setup();
      await type(editor, ":jurassic");
      expect(listbox()?.parentElement).toBe(document.body);
      expect(listbox()?.contains(options()[0] as Node)).toBe(true);
    });

    it("mounts the menu inside the given element and removes it on close", async () => {
      const frame = createFrame();
      const { editor, root } = setup({ menuContainer: frame });
      await type(editor, ":jurassic");
      expect(listbox()?.parentElement).toBe(frame);
      expect(shown()[0]).toBe("🦖");
      await press(root, "Enter");
      expect(text(editor)).toBe("🦖");
      expect(frame.children).toHaveLength(0);
    });

    it("moves to an element that appears after the editor (null until then)", async () => {
      const editorRef = createRef<LexicalEditor>();
      const view = render(<Editor editorRef={editorRef} menuContainer={null} />);
      const editor = editorRef.current as LexicalEditor;
      act(() => editor.update(() => $getRoot().selectEnd(), { discrete: true }));
      const frame = createFrame();
      view.rerender(<Editor editorRef={editorRef} menuContainer={frame} />);
      await type(editor, ":jurassic");
      expect(listbox()?.parentElement).toBe(frame);
    });
  });

  it("the open menu takes Enter in a list item, and leaves it to the list when closed", async () => {
    const { editor, root } = setup({
      richContent: () => {
        const first = $createListItemNode().append($createTextNode("first"));
        $getRoot().append($createListNode("bullet").append(first, $createListItemNode()));
      },
    });
    await type(editor, ":jurassic");
    expect(await press(root, "Enter")).toBe(true);
    expect(listItems(editor)).toEqual(["first", "🦖"]);
    await press(root, "Enter");
    expect(listItems(editor)).toEqual(["first", "🦖", ""]);
  });

  it("the open menu takes Tab in a table cell, and leaves it to the table when closed", async () => {
    const { editor, root } = setupTable();
    await type(editor, ":jurassic");
    expect(shown()[0]).toBe("🦖");
    // The table's own Tab handler runs at COMMAND_PRIORITY_HIGH.
    expect(await press(root, "Tab")).toBe(true);
    await type(editor, "!");
    expect(tableCells(editor)).toEqual(["🦖!", ""]);
    await press(root, "Tab");
    await type(editor, "x");
    expect(tableCells(editor)).toEqual(["🦖!", "x"]);
  });

  it("uses commandPriority for the menu's keys", async () => {
    const { editor, root } = setupTable({ commandPriority: COMMAND_PRIORITY_LOW });
    await type(editor, ":jurassic");
    await press(root, "Tab");
    await type(editor, "x");
    expect(tableCells(editor)).toEqual([":jurassic", "x"]);
  });

  it("accepts a custom menu, rendered only while there are results", async () => {
    const menuRenderFn = vi.fn(() => null);
    const { editor } = setup({ menuRenderFn });
    await type(editor, ":rock");
    const [, itemProps, query] = menuRenderFn.mock.calls.at(-1) as unknown as [
      unknown,
      { options: { suggestion: { emoji: string } }[] },
      string,
    ];
    expect(query).toBe("rock");
    expect(itemProps.options.map((option) => option.suggestion.emoji)).toEqual(["🚀"]);
    menuRenderFn.mockClear();
    await type(editor, "zz");
    expect(menuRenderFn).not.toHaveBeenCalled();
  });
});
