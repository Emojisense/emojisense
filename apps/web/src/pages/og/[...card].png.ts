/**
 * Every page's share card as a static PNG (1200 × 630), rendered at build time. Which page gets
 * which card: src/og/registry.ts. Query cards for playground links come from the Worker instead
 * (src/worker/).
 */
import type { APIRoute, GetStaticPaths } from "astro";
import { nodeCardRenderer } from "../../og/node";
import { type ShareCardEntry, shareCards } from "../../og/registry";

export const getStaticPaths: GetStaticPaths = () =>
  shareCards().map((entry) => ({
    params: { card: entry.image.replace(/^\/og\//, "").replace(/\.png$/, "") },
    props: { entry },
  }));

export const GET: APIRoute<{ entry: ShareCardEntry }> = async ({ props }) => {
  const renderer = await nodeCardRenderer();
  const png = await renderer.png(props.entry.card);
  return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png" } });
};
