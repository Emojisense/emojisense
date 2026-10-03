// Modules wrangler bundles as data (wrangler.jsonc `rules`) or compiled Wasm.
declare module "*.woff" {
  const data: ArrayBuffer;
  export default data;
}

declare module "*.wasm" {
  const module: WebAssembly.Module;
  export default module;
}
