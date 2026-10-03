/**
 * Slack, Discord and Zapier hook URLs carry a secret token in the path, so members who cannot edit
 * webhooks get the scheme and host only: `https://hooks.slack.com/…`. A saved URL never contains a
 * raw "…" (URL parsing percent-encodes it), so a masked URL cannot pass for a real one.
 */
const MASK = "…";

export function maskWebhookUrl(url: string): string {
  try {
    const { protocol, host } = new URL(url);
    return `${protocol}//${host}/${MASK}`;
  } catch {
    return MASK;
  }
}

export function isMaskedWebhookUrl(url: string): boolean {
  return url === maskWebhookUrl(url);
}
