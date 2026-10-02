import { Extension } from "@tiptap/core";
import { type EditorState, Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export interface PresenceState {
  /** Name on the teammate's caret, shown at the selection while the autoplay types. */
  ghost: string | null;
  /** Show the "type :" hint on the empty last line. */
  hint: boolean;
}

export const presenceKey = new PluginKey<PresenceState>("docPresence");

export interface PresenceOptions {
  placeholder: string;
  hint: boolean;
}

function caret(name: string): HTMLElement {
  const caretElement = document.createElement("span");
  caretElement.className = "doc-ghost";
  caretElement.setAttribute("aria-hidden", "true");
  const flag = document.createElement("span");
  flag.className = "doc-ghost-flag";
  flag.textContent = name;
  caretElement.append(flag);
  return caretElement;
}

/** The empty paragraph that gets the hint: the focused one, or the last one in the doc. */
function hintTarget(
  state: EditorState,
  focused: boolean,
  hint: boolean,
): { from: number; to: number } | null {
  const { $from, empty } = state.selection;
  const parent = $from.parent;
  if (focused && empty && parent.type.name === "paragraph" && parent.content.size === 0) {
    return { from: $from.before(), to: $from.after() };
  }
  const last = state.doc.lastChild;
  if (!focused && hint && last?.type.name === "paragraph" && last.content.size === 0) {
    return { from: state.doc.content.size - last.nodeSize, to: state.doc.content.size };
  }
  return null;
}

/** A teammate's caret for the autoplay, and the placeholder hint on empty lines. */
export const Presence = Extension.create<PresenceOptions>({
  name: "docPresence",

  addOptions: () => ({ placeholder: "", hint: false }),

  addProseMirrorPlugins() {
    const { editor, options } = this;
    return [
      new Plugin<PresenceState>({
        key: presenceKey,
        state: {
          init: () => ({ ghost: null, hint: options.hint }),
          apply: (tr, value) => ({
            ...value,
            ...(tr.getMeta(presenceKey) as Partial<PresenceState> | undefined),
          }),
        },
        props: {
          decorations: (state) => {
            const presence = presenceKey.getState(state);
            if (!presence) return null;
            const decorations: Decoration[] = [];
            if (presence.ghost) {
              const name = presence.ghost;
              decorations.push(
                Decoration.widget(state.selection.head, () => caret(name), { side: 1, key: name }),
              );
            } else {
              const target = hintTarget(state, editor.isFocused, presence.hint);
              if (target) {
                decorations.push(
                  Decoration.node(target.from, target.to, {
                    class: "doc-empty",
                    "data-placeholder": options.placeholder,
                  }),
                );
              }
            }
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
