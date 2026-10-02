declare module "*.bin" {
  const data: ArrayBuffer;
  export default data;
}

// Text modules (wrangler.jsonc `rules`): culture policy files bundled with the Worker.
declare module "*.txt" {
  const text: string;
  export default text;
}
declare module "*.md" {
  const text: string;
  export default text;
}
declare module "*.jsonl" {
  const text: string;
  export default text;
}
