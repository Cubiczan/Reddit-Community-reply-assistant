/**
 * Escape untrusted strings before they are interpolated into HTML.
 * Prefer textContent / createElement in the DOM; use this only for
 * email / string templates where a document node is not available.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Allow only http(s) URLs so href values cannot become javascript: sinks. */
export function safeHttpUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '#';
  try {
    const url = new URL(value);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.toString();
    }
  } catch {
    /* ignore invalid URLs */
  }
  return '#';
}
