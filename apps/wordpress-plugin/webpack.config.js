/**
 * The default @wordpress/scripts build (Babel, dependency extraction, *.asset.php) with one
 * entry per screen, so each page loads only what it uses.
 */
const path = require("node:path");
const defaultConfig = require("@wordpress/scripts/config/webpack.config");

module.exports = {
  ...defaultConfig,
  entry: {
    editor: "./src/editor/index.js",
    classic: "./src/classic/index.ts",
    fields: "./src/front/fields.ts",
    reactions: "./src/front/reactions.ts",
    admin: "./src/admin/index.js",
  },
  output: {
    ...defaultConfig.output,
    path: path.resolve(__dirname, "build"),
  },
  resolve: {
    ...defaultConfig.resolve,
    // TypeScript sources import "./x.js" for "./x.ts".
    extensionAlias: { ".js": [".ts", ".js"] },
  },
};
