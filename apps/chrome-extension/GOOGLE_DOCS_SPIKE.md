# Google Docs spike: can an MV3 extension insert an emoji at the caret?

Date: 2026-10-02. Scope: public documentation and source knowledge only. No Google account was
used, so nothing below was tested against a signed-in document.

## Short answer

**Not reliably, today.** The extension ships the safe path: copy the emoji, give the keyboard back
to Docs, and show "Copied — press ⌘V to paste". A direct insertion attempt exists behind an
experimental switch (off by default) until a signed-in test confirms it.

## How Docs takes text

Docs has drawn the document on a `<canvas>` since 2021
([Google Workspace Updates](https://workspaceupdates.googleblog.com/2021/05/Google-Docs-Canvas-Based-Rendering-Update.html)).
There are no text nodes to edit. Keystrokes go to a hidden, same-origin iframe, and Docs' own
scripts apply them to the document model:

```
keyboard ──▶ iframe.docs-texteventtarget-iframe ──▶ div[contenteditable] ──▶ Docs model ──▶ canvas
                (top document: activeElement)        (key, input, paste,
                                                      composition events)
```

| Fact | Consequence for the extension |
| ---- | ----------------------------- |
| The top document's `activeElement` is `iframe.docs-texteventtarget-iframe` | Detection is cheap and exact (`src/content/docs.ts`) |
| The iframe is about:blank and same-origin | The top-frame content script can focus it and dispatch events into it |
| The caret is still a DOM element (`.kix-cursor-caret`) | The picker and the sticker card can sit next to the caret |
| The visible text is canvas pixels | `execCommand`, `setRangeText` and Range edits on the page change nothing visible |
| Docs listens for events it did not create | Whether it accepts *untrusted* (script-made) events is the open question |

## Options

| # | Option | How | Status | Risk | Verdict |
| - | ------ | --- | ------ | ---- | ------- |
| A | **Clipboard + paste hint** | Copy via a filled `copy` event (or the Clipboard API), focus the hidden editor again, show a sticker card with ⌘V / Ctrl+V | Works: paste is a trusted user action Docs supports everywhere | One extra keystroke | **Shipped, default** |
| B | Synthetic `paste` event | `ClipboardEvent("paste", { clipboardData })` on the hidden `contenteditable`; `defaultPrevented` shows that Docs' handler took it | Unverified | Docs may ignore untrusted events | **Shipped behind "experimental", off** |
| C | `execCommand("insertText")` inside the hidden iframe | Native editing in the hidden editor fires a *trusted* `input` event, the same path IME and the OS emoji panel use | Unverified | No success signal; may confuse Docs' composition state; double insert if combined with B | Next candidate to test |
| D | Synthetic key events | `keypress` with `charCode` per character (older libraries such as [google-docs-utils](https://github.com/Amaimersion/google-docs-utils)) | That library documents it stopped working with canvas rendering | Emoji are 2+ UTF-16 units; deprecated events | Rejected |
| E | Annotated canvas | `window._docs_annotate_canvas_by_ext = <extension id>` after Google allowlists the extension | Needs Google's approval; developers report no answer for months ([chromium-extensions thread](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/OP03CIUfews)) | Opaque process; aimed at reading text (grammar tools), not at a write API | Not now |
| F | Workspace add-on | Apps Script `DocumentApp.getActiveDocument().getCursor().insertText()` from a sidebar | Official, supported API | Different product: Marketplace listing, OAuth scopes, a sidebar instead of a keyboard popover, a server round trip per insert | Long-term official route if Docs matters |
| G | `chrome.debugger` + `Input.insertText` | DevTools protocol from the extension; produces real input | Works on canvas editors in general | `debugger` permission, a "started debugging this browser" bar on every use, very broad access | Rejected (conflicts with minimal permissions) |

## Recommendation

1. Keep **A** as the default. It is honest, never inserts twice, and works in Slides and other
   canvas apps too. The picker says so before the pick: the footer reads "↵ copy · then ⌘V".
2. Before anyone promises "fix the Google Docs picker", run the manual test below for **B** and
   **C** with a throwaway Google account. About 30 minutes.
3. If B or C passes every row, make it the default for Docs and keep the copy as a fallback (the
   clipboard is filled first in all cases, so a silent failure still leaves ⌘V).
4. If neither passes, consider **F** only when usage data shows Docs is a top surface.

## Manual test protocol (signed-in, throwaway account)

Load `dist/` unpacked, open the options page, switch on "Also try to insert directly".

| Case | Expected for a pass |
| ---- | ------------------- |
| Caret mid-paragraph, pick 🚀 | 🚀 appears once at the caret; the card says "Inserted" |
| A word selected, pick 🎉 | The word is replaced |
| Inside a table cell, a bulleted list, a heading | Inserted with the surrounding formatting |
| ⌘Z right after the insert | Removes exactly the emoji |
| Suggesting mode | Shows as a suggestion |
| Typing continues right after the insert | No lost or doubled characters |
| Same in Google Slides (text box) | Same results, or copy mode |
| With the experiment off | Never inserts; card says "Copied — press ⌘V to paste" |

For C, swap the body of `pasteIntoDocs` for
`frame.contentDocument.execCommand("insertText", false, text)` and repeat. Check in DevTools
whether Docs' listeners read `event.isTrusted` (for example by breaking on `paste` and `input`
listeners on the iframe document).

## What the shipped code does

| Step | Code |
| ---- | ---- |
| Detect Docs: active element is the keystroke iframe | `isDocsEventFrame` in `src/content/docs.ts`, `captureTarget` in `src/content/target.ts` |
| Open in the top frame, never inside the hidden iframe | `chooseFrame` in `src/shared/frames.ts` |
| Anchor next to `.kix-cursor-caret` | `docsCaretRect` |
| Copy while the picker still has focus (keypress = user activation; `clipboardWrite` covers the rest) | `copyText` in `src/content/clipboard.ts` |
| Return focus to the hidden editor so ⌘V lands at the caret | `focusDocsEditor` |
| Experimental paste, only with the switch on | `pasteIntoDocs` |

Other Google editors: Docs comment boxes and the Sheets cell editor are DOM fields, not canvas,
so the normal insert path should apply. This is also untested without an account.
