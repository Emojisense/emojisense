/**
 * Stand-in for the `cn` helper that `shadcn init` writes to `@/lib/utils` (clsx + tailwind-merge).
 * It exists so the registry source typechecks and renders in tests. It is not shipped: the shadcn
 * CLI rewrites the import to the user's own `utils` alias.
 */
export function cn(...inputs: Array<string | false | null | undefined>): string {
  return inputs.filter(Boolean).join(" ");
}
