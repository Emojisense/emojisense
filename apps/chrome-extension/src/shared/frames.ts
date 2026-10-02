/** What one frame reports when the service worker asks where the picker should open. */
export interface FrameProbe {
  top: boolean;
  /** document.hasFocus(): true also when focus is in a child frame. */
  focused: boolean;
  /** The focused element is an <iframe>/<frame>, so the caret lives one level deeper. */
  activeIsFrame: boolean;
  /** The focused element accepts text (input, textarea, contenteditable, Google Docs). */
  editable: boolean;
  /** The top frame of a Google Docs/Slides editor with the caret in it. */
  docs: boolean;
  /** This frame is Docs' hidden keystroke iframe; never open the picker inside it. */
  docsEventFrame: boolean;
}

export interface ProbeResult {
  frameId: number;
  result?: FrameProbe | null;
}

export const TOP_FRAME_ID = 0;

/**
 * Pick the frame that holds the caret: the focused frame whose focus does not continue into a
 * child frame. Google Docs is the exception: its caret frame is hidden, so the top frame opens the
 * picker. Without a clear answer (e.g. a cross-origin child frame we could not inject), use the
 * top frame, where the picker can still copy.
 */
export function chooseFrame(results: readonly ProbeResult[]): number {
  const probes = results.filter(
    (entry): entry is { frameId: number; result: FrameProbe } =>
      entry.result !== null && entry.result !== undefined,
  );
  const docs = probes.find((entry) => entry.result.top && entry.result.docs);
  if (docs) return docs.frameId;
  const leaves = probes.filter(
    (entry) => entry.result.focused && !entry.result.activeIsFrame && !entry.result.docsEventFrame,
  );
  const leaf = leaves.find((entry) => entry.result.editable) ?? leaves[0];
  return leaf?.frameId ?? TOP_FRAME_ID;
}
