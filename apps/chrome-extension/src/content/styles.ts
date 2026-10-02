import tokensCss from "../shared/tokens.css?raw";
import overlayCss from "./overlay.css?raw";

/** One stylesheet per shadow root: the design tokens, then the picker and toast rules. */
export const SURFACE_CSS = `${tokensCss}\n${overlayCss}`;
