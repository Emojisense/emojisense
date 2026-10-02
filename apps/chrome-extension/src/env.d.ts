/** Files imported as text: Vite handles `?raw` in tests, an esbuild plugin does it in the build. */
declare module "*.css?raw" {
  const css: string;
  export default css;
}

declare module "*.html?raw" {
  const html: string;
  export default html;
}
