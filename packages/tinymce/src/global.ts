/**
 * Side-effect entry: registers the plugin with the global `tinymce` (a CDN or self-hosted script).
 * Built as `dist/plugin.min.js` for `external_plugins`.
 */
import type { TinyMCE } from "tinymce";
import { registerEmojisense } from "./plugin.js";

const tinymce = (globalThis as { tinymce?: TinyMCE }).tinymce;
if (tinymce) registerEmojisense(tinymce);
else console.warn("emojisense: load TinyMCE before the emojisense plugin.");
