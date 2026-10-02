/**
 * A Shiki theme whose colors are CSS variables (set in docs.css), so code follows the site's
 * light and dark tokens. Near-monochrome on purpose: the emoji in the examples carry the color.
 */
const v = (name: string) => `var(--docs-code-${name})`;

export const codeTheme = {
  name: "emojisense-docs",
  type: "light" as const,
  colors: {
    "editor.foreground": v("text"),
    "editor.background": v("background"),
  },
  tokenColors: [
    { settings: { foreground: v("text"), background: v("background") } },
    {
      scope: ["comment", "punctuation.definition.comment"],
      settings: { foreground: v("comment"), fontStyle: "italic" },
    },
    {
      scope: [
        "string",
        "string.quoted",
        "string.template",
        "markup.inline.raw",
        "string.unquoted.plain.out.yaml",
      ],
      settings: { foreground: v("string") },
    },
    {
      scope: [
        "keyword",
        "storage",
        "storage.type",
        "storage.modifier",
        "keyword.operator.new",
        "keyword.control",
      ],
      settings: { foreground: v("keyword") },
    },
    {
      scope: [
        "constant.numeric",
        "constant.language",
        "constant.character",
        "variable.language",
        "support.constant",
      ],
      settings: { foreground: v("constant") },
    },
    {
      scope: ["entity.name.function", "support.function", "meta.function-call entity.name.function"],
      settings: { foreground: v("function") },
    },
    {
      scope: [
        "entity.name.type",
        "entity.name.class",
        "support.type",
        "support.class",
        "entity.other.inherited-class",
      ],
      settings: { foreground: v("type") },
    },
    {
      scope: ["entity.name.tag", "punctuation.definition.tag", "support.class.component"],
      settings: { foreground: v("tag") },
    },
    {
      scope: [
        "entity.other.attribute-name",
        "support.type.property-name",
        "meta.object-literal.key",
        "variable.other.property",
      ],
      settings: { foreground: v("property") },
    },
    {
      scope: ["punctuation", "meta.brace", "keyword.operator"],
      settings: { foreground: v("punctuation") },
    },
    { scope: ["markup.deleted"], settings: { foreground: v("deleted") } },
    { scope: ["markup.inserted"], settings: { foreground: v("inserted") } },
  ],
};
