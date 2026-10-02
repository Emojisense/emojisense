import type { ClientMessage, PickerItem, ServerMessage } from "../shared/messages";
import { DEFAULT_SETTINGS, resolveLocale, type Settings } from "../shared/settings";
import { pasteShortcut, STRINGS } from "../shared/strings";
import { copyText } from "./clipboard";
import { focusDocsEditor, pasteIntoDocs } from "./docs";
import { insertText, restoreTarget } from "./insert";
import { createPicker, type Picker } from "./overlay";
import { captureTarget, type EditableTarget, type Rect, targetRect } from "./target";
import { pageTheme } from "./theme";
import { showToast } from "./toast";

/** A connection to the service worker's search. Reopened on demand: the worker may sleep. */
export interface SearchChannel {
  send(message: ClientMessage): void;
  close(): void;
}

export interface ControllerDeps {
  window: Window;
  /** Throws when the extension was reloaded or removed ("Extension context invalidated"). */
  openChannel(onMessage: (message: ServerMessage) => void, onDisconnect: () => void): SearchChannel;
  loadSettings(): Promise<Settings>;
  /** Registers the bundled fonts; never rejects. The first open waits for it briefly. */
  loadFonts?(): Promise<void>;
  uiLanguage: string;
  platform: string;
}

export interface Controller {
  /** Open the picker for the focused field, or close it when it is open. */
  toggle(): Promise<void>;
  isOpen(): boolean;
  dispose(): void;
}

/** Containers that often trap focus; the picker mounts inside them so focus may enter it. */
const DIALOG_SELECTOR = 'dialog[open], [aria-modal="true"], [role="dialog"]';

/**
 * How long the first open waits for the fonts, so the text does not change font in front of the
 * user. They come from the extension package, so this is rarely reached; then the system font shows.
 */
export const FONT_WAIT_MS = 150;

export function createController(deps: ControllerDeps): Controller {
  const view = deps.window;
  const doc = view.document;
  let close: ((restoreFocus: boolean) => void) | undefined;
  let opening = false;

  async function toggle(): Promise<void> {
    if (close) {
      close(true);
      return;
    }
    if (opening) return;
    opening = true;
    // Capture before any await: the caret must be read while the field still has focus.
    const target = captureTarget(doc);
    try {
      const [settings] = await Promise.all([
        deps.loadSettings().catch(() => DEFAULT_SETTINGS),
        deps.loadFonts ? atMost(deps.loadFonts(), FONT_WAIT_MS) : undefined,
      ]);
      close = open(target, settings);
    } finally {
      opening = false;
    }
  }

  function atMost(task: Promise<void>, ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = view.setTimeout(resolve, ms);
      const done = () => {
        view.clearTimeout(timer);
        resolve();
      };
      task.then(done, done);
    });
  }

  function open(target: EditableTarget, settings: Settings): (restoreFocus: boolean) => void {
    const strings = STRINGS[resolveLocale(settings.locale, deps.uiLanguage)];
    const pasteKey = pasteShortcut(deps.platform);
    const mode = target.kind === "text-control" || target.kind === "contenteditable" ? "insert" : "copy";
    const mount = mountFor(target, doc);
    const theme = pageTheme(target.kind === "google-docs" ? target.frame : target.element, view);
    let channel: SearchChannel | undefined;
    let closed = false;

    const send = (message: ClientMessage) => {
      try {
        channel ??= deps.openChannel(
          (reply) => onReply(reply),
          () => {
            // The worker went to sleep or restarted; the next keystroke reconnects.
            channel = undefined;
          },
        );
        channel.send(message);
      } catch {
        channel = undefined;
        picker.setUnavailable();
      }
    };

    const onReply = (reply: ServerMessage) => {
      if (reply.type === "results") picker.setResults(reply.query, reply.status, reply.items);
      else picker.setUnavailable();
    };

    const picker: Picker = createPicker({
      document: doc,
      mount,
      strings,
      mode,
      pasteKey,
      theme,
      onQuery: (query) => send({ type: "query", query }),
      onPick: (item, how) => void pick(item, how.copy || mode === "copy"),
      onDismiss: (reason) => finish(reason === "escape"),
    });

    let frame = 0;
    const reposition = () => {
      if (frame !== 0) return;
      frame = view.requestAnimationFrame(() => {
        frame = 0;
        picker.position(targetRect(target));
      });
    };

    function finish(restoreFocus: boolean): void {
      if (closed) return;
      closed = true;
      close = undefined;
      view.removeEventListener("scroll", reposition, true);
      view.removeEventListener("resize", reposition);
      if (frame !== 0) view.cancelAnimationFrame(frame);
      picker.destroy();
      channel?.close();
      channel = undefined;
      if (restoreFocus) refocus(target);
    }

    async function pick(item: PickerItem, copy: boolean): Promise<void> {
      send({ type: "picked", id: item.id });
      const anchor = targetRect(target);
      if (copy) {
        // Copy while the search box still has focus and the keypress still counts as a gesture.
        const copied = copyText(doc, item.emoji);
        finish(true);
        const pasted =
          target.kind === "google-docs" &&
          settings.docsDirectInsert &&
          pasteIntoDocs(target.frame, item.emoji);
        const ok = await copied;
        notify(anchor, item.emoji, pasted ? strings.insertedDocs(pasteKey) : copyMessage(ok));
        return;
      }
      finish(false);
      if (insertText(target, item.emoji).ok) return;
      // The field disappeared or refused the text: the clipboard is the fallback.
      refocus(target);
      notify(anchor, item.emoji, copyMessage(await copyText(doc, item.emoji)));
    }

    function copyMessage(ok: boolean): string {
      return ok ? strings.copied(pasteKey) : strings.copyFailed;
    }

    function notify(anchor: Rect | null, emoji: string, message: string): void {
      showToast({
        document: doc,
        mount: mountFor(target, doc),
        anchor,
        emoji,
        message,
        theme,
        durationMs: 4000,
      });
    }

    picker.position(targetRect(target));
    picker.focus();
    view.addEventListener("scroll", reposition, { capture: true, passive: true });
    view.addEventListener("resize", reposition, { passive: true });
    send({ type: "query", query: "" });
    return finish;
  }

  return {
    toggle,
    isOpen: () => close !== undefined,
    dispose: () => close?.(false),
  };
}

function mountFor(target: EditableTarget, doc: Document): Element {
  const element = "element" in target ? target.element : null;
  return (element?.isConnected && element.closest(DIALOG_SELECTOR)) || doc.documentElement;
}

function refocus(target: EditableTarget): void {
  if (target.kind === "google-docs") focusDocsEditor(target.frame);
  else if (target.kind === "none") target.element?.focus({ preventScroll: true });
  else restoreTarget(target);
}
