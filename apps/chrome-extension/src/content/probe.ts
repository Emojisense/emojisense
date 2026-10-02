import type { FrameProbe } from "../shared/frames";
import { isInsideDocsEventFrame } from "./docs";
import { captureTarget, deepActiveElement } from "./target";

export function probeFrame(win: Window, doc: Document): FrameProbe {
  const active = deepActiveElement(doc);
  const target = captureTarget(doc);
  return {
    top: win === win.top,
    focused: doc.hasFocus(),
    activeIsFrame: active?.localName === "iframe" || active?.localName === "frame",
    editable: target.kind !== "none",
    docs: target.kind === "google-docs",
    docsEventFrame: isInsideDocsEventFrame(win),
  };
}
