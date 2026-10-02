/** Manifest V3, written to dist/manifest.json by scripts/build.ts. */

export const OPEN_PICKER_COMMAND = "open-picker";
export const ACTION_TITLE = "Emojisense: emoji for the focused text field";
export const ICON_SIZES = [16, 32, 48, 128] as const;

/**
 * Permissions, each with the reason a reviewer needs:
 * - activeTab: the shortcut or a toolbar click grants access to the current tab only. No host
 *   permissions, no content script on every page.
 * - scripting: inject the picker into that tab on demand.
 * - storage: settings and recently used emoji, on this device.
 * - clipboardWrite: copy the emoji where inserting is impossible (Google Docs, canvas apps).
 * The optional semantic API needs no host permission: it answers with CORS headers.
 */
export const PERMISSIONS = ["activeTab", "scripting", "storage", "clipboardWrite"] as const;

export function createManifest(version: string): chrome.runtime.ManifestV3 {
  const icons = Object.fromEntries(ICON_SIZES.map((size) => [String(size), `icons/icon-${size}.png`]));
  return {
    manifest_version: 3,
    name: "Emojisense",
    version,
    description: "Type what you mean, get the emoji. A picker for any text field; works offline.",
    minimum_chrome_version: "116",
    icons,
    action: { default_title: ACTION_TITLE, default_icon: icons },
    background: { service_worker: "background.js", type: "module" },
    permissions: [...PERMISSIONS],
    commands: {
      [OPEN_PICKER_COMMAND]: {
        suggested_key: { default: "Ctrl+Shift+Space", mac: "Command+Shift+Space" },
        description: "Open the emoji picker next to the focused text field",
      },
    },
    options_ui: { page: "options.html", open_in_tab: true },
    // The default MV3 policy, stated so a review sees there is no remote code and no eval.
    content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'" },
  };
}
