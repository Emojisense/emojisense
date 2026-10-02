import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);

// happy-dom dispatches `selectionchange` synchronously inside Selection.setBaseAndExtent, while
// browsers queue it. Lexical sets the DOM selection while it commits, so in happy-dom the event
// re-enters the editor and Lexical logs this dev warning. Browsers never produce it.
const warn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].startsWith("updateEditorSync: an editor update")) return;
  warn(...args);
};
