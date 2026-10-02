// Typecheck the TypeScript samples in the README of every published package (packages/*, not
// private) against the current source, so the npm pages never show an API that does not exist.
//
//   node scripts/check-readmes.mjs          (pnpm check:readmes)
//
// Every ```ts / ```tsx block is checked, unless the line before it is <!-- readme-check: skip -->.
// Each block is one module: its imports stay at the top, and the rest goes into an async function,
// so `await` and `return` work and blocks do not share names. A block with `export` stays at the
// top level. Names that a README uses without declaring them (an `insert` callback, a `sense`
// object from an earlier block) are declared per package in GLOBALS. Packages that are not
// installed in this repository (`@tiptap/starter-kit`, `@angular/core`, …) get small typed stubs
// in STUBS. The workspace packages resolve to their src/, so no build is needed.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_MARKER = "<!-- readme-check: skip -->";
const LANGUAGES = new Set(["ts", "tsx", "typescript"]);

/** Ambient names per package directory (packages/<dir>). */
const GLOBALS = {
  react: `
    import type { Emojisense } from "@emojisense/react";
    declare global {
      const sense: Emojisense;
      const query: string;
      const packBaseUrl: string;
      const shardsUrl: string;
      const endpoint: string;
      function insert(emoji: string): void;
    }`,
  "web-component": `
    declare global {
      const packUrl: string;
      function insert(emoji: string): void;
    }`,
  "emoji-mart": `
    import type { AliasEngine, SemanticProvider } from "emojisense";
    import type { EmojiMartData } from "@emojisense/emoji-mart";
    declare global {
      const data: EmojiMartData;
      const engine: AliasEngine;
      const semantic: SemanticProvider | undefined;
      function insert(emoji: string): void;
    }`,
  lexical: `
    import type { AliasEngine } from "emojisense";
    declare global {
      const engine: AliasEngine;
      const baseUrl: string;
      function MyMenu(props: { options: unknown[] }): import("react").JSX.Element;
    }`,
  tiptap: `
    import type { AliasEngine } from "emojisense";
    import type { EmojiSuggestion } from "@emojisense/tiptap";
    declare global {
      const engine: AliasEngine;
      const myMenu: {
        open(items: EmojiSuggestion[], command: (item: EmojiSuggestion) => void, mount: unknown): void;
        update(items: EmojiSuggestion[]): void;
        close(): void;
        handleKey(event: KeyboardEvent): boolean;
      };
    }`,
};

/** Typed stand-ins for modules that only the README reader has installed. */
const STUBS = `
  declare module "@tiptap/starter-kit" {
    const StarterKit: import("@tiptap/core").Extension;
    export default StarterKit;
  }
  declare module "@tiptap/react" {
    export function useEditor(options: Partial<import("@tiptap/core").EditorOptions>): import("@tiptap/core").Editor | null;
    export function EditorContent(props: { editor: import("@tiptap/core").Editor | null }): import("react").JSX.Element;
  }
  declare module "@angular/core" {
    export const CUSTOM_ELEMENTS_SCHEMA: unknown;
    export function Component(options: { selector: string; template: string; schemas?: unknown[] }): <T>(target: T, context: ClassDecoratorContext) => T;
  }
  declare module "@/components/ui/popover" {
    export function Popover(props: { children?: import("react").ReactNode }): import("react").JSX.Element;
    export function PopoverTrigger(props: { children?: import("react").ReactNode }): import("react").JSX.Element;
    export function PopoverContent(props: { className?: string; children?: import("react").ReactNode }): import("react").JSX.Element;
  }
`;

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Public workspace packages: { dir, name, path, exports: subpath → source file }. */
function publicPackages() {
  const result = [];
  for (const dir of readdirSync(join(ROOT, "packages")).sort()) {
    const path = join(ROOT, "packages", dir);
    const manifestPath = join(path, "package.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = readJson(manifestPath);
    if (manifest.private) continue;
    const sources = {};
    for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
      const types = typeof target === "object" ? target.types : undefined;
      if (!types) continue;
      const stem = types.replace(/^\.\/dist\//, "src/").replace(/\.d\.ts$/, "");
      const source = [".ts", ".tsx"].map((ext) => join(path, stem + ext)).find((file) => existsSync(file));
      if (!source) throw new Error(`${manifest.name}: no source for export ${subpath} (${types})`);
      sources[subpath === "." ? manifest.name : `${manifest.name}/${subpath.slice(2)}`] = source;
    }
    result.push({ dir, name: manifest.name, path, sources });
  }
  return result;
}

/** Fenced blocks to check: { line (1-based, of the fence), lang, code }. */
function samples(readme) {
  const lines = readme.split("\n");
  const blocks = [];
  for (let index = 0; index < lines.length; index++) {
    const open = /^```(\w+)\s*$/.exec(lines[index]);
    if (!open) continue;
    const end = lines.findIndex((line, at) => at > index && /^```\s*$/.test(line));
    if (end === -1) throw new Error(`unclosed code fence at line ${index + 1}`);
    let previous = index - 1;
    while (previous >= 0 && lines[previous].trim() === "") previous--;
    const skipped = previous >= 0 && lines[previous].trim() === SKIP_MARKER;
    if (LANGUAGES.has(open[1]) && !skipped) {
      blocks.push({ line: index + 1, lang: open[1], code: lines.slice(index + 1, end).join("\n") });
    }
    index = end;
  }
  return blocks;
}

/** Imports at the top, the rest in an async function (unless the block exports something). */
function toModule(code) {
  const source = ts.createSourceFile("block.tsx", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const imports = source.statements.filter(ts.isImportDeclaration);
  const exports = source.statements.some(
    (statement) =>
      ts.isExportDeclaration(statement) ||
      ts.isExportAssignment(statement) ||
      ts.getCombinedModifierFlags(statement) & ts.ModifierFlags.Export ||
      (ts.canHaveDecorators(statement) && ts.getDecorators(statement)?.length),
  );
  let body = code;
  for (const statement of [...imports].reverse()) {
    body = body.slice(0, statement.getStart(source)) + body.slice(statement.getEnd());
  }
  const header = imports.map((statement) => statement.getText(source)).join("\n");
  const wrapped = exports ? body : `export async function readmeSample() {\n${body}\n}`;
  return `${header}\n${wrapped}\nexport {};\n`;
}

function checkPackage(pkg, allPackages) {
  const readmePath = join(pkg.path, "README.md");
  if (!existsSync(readmePath)) return { checked: 0, errors: [`${pkg.name}: README.md is missing`] };
  const blocks = samples(readFileSync(readmePath, "utf8"));
  if (blocks.length === 0) return { checked: 0, errors: [] };

  const virtual = new Map();
  const origin = new Map();
  blocks.forEach((block, index) => {
    const file = join(pkg.path, `README.sample-${index + 1}.${block.lang === "tsx" ? "tsx" : "ts"}`);
    virtual.set(file, toModule(block.code));
    origin.set(file, block);
  });
  const globalsFile = join(pkg.path, "README.globals.d.ts");
  virtual.set(globalsFile, `${GLOBALS[pkg.dir] ?? ""}\nexport {};\n`);
  const stubsFile = join(pkg.path, "README.stubs.d.ts");
  virtual.set(stubsFile, STUBS);

  const paths = {};
  for (const other of allPackages) {
    for (const [specifier, source] of Object.entries(other.sources)) paths[specifier] = [source];
  }
  // The shadcn registry item installs into the app's components/ui folder.
  paths["@/components/ui/emoji-picker"] = [join(ROOT, "packages/react/registry/emoji-picker.tsx")];
  paths["@/lib/utils"] = [join(ROOT, "packages/react/registry/lib/utils.ts")];
  // React types for samples in packages without a React dependency (a Tiptap app with React).
  const reactTypes = join(ROOT, "packages/react/node_modules/@types/react");
  paths.react = [join(reactTypes, "index.d.ts")];
  paths["react/jsx-runtime"] = [join(reactTypes, "jsx-runtime.d.ts")];

  const options = {
    ...ts.getDefaultCompilerOptions(),
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    jsx: ts.JsxEmit.ReactJSX,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    esModuleInterop: true,
    resolveJsonModule: true,
    types: [],
    paths,
  };
  const host = ts.createCompilerHost(options);
  const fileExists = host.fileExists.bind(host);
  const readFile = host.readFile.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  host.fileExists = (file) => virtual.has(file) || fileExists(file);
  host.readFile = (file) => virtual.get(file) ?? readFile(file);
  host.getSourceFile = (file, languageVersion, onError, shouldCreate) =>
    virtual.has(file)
      ? ts.createSourceFile(file, virtual.get(file), languageVersion, true)
      : getSourceFile(file, languageVersion, onError, shouldCreate);

  const program = ts.createProgram([...virtual.keys()], options, host);
  const errors = [];
  for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
    const file = diagnostic.file?.fileName;
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
    const block = file ? origin.get(file) : undefined;
    if (block && diagnostic.start !== undefined) {
      const { line } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
      const text = diagnostic.file.text.split("\n")[line]?.trim();
      errors.push(`${relative(ROOT, readmePath)}:${block.line} (block line "${text}"): ${message}`);
    } else {
      errors.push(`${file ? relative(ROOT, file) : pkg.name}: ${message}`);
    }
  }
  return { checked: blocks.length, errors };
}

const packages = publicPackages();
let failed = false;
for (const pkg of packages) {
  const { checked, errors } = checkPackage(pkg, packages);
  failed ||= errors.length > 0;
  console.log(`${errors.length ? "✘" : "✔"} ${pkg.name.padEnd(28)} ${checked} TypeScript sample(s)`);
  for (const error of errors) console.log(`  ${error}`);
}
process.exit(failed ? 1 : 0);
