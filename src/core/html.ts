/**
 * Preparing the CLI's HTML report for a webview. The report quotes scanned
 * code, so it is shown with scripts disabled and a Content Security Policy
 * that allows only inline styles and data: images. Elements that could act
 * without scripts (a meta refresh, a base URL) are removed first.
 */

/** No scripts, frames, forms, fonts or network loads; inline styles and data: images only. */
export const REPORT_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'; frame-ancestors 'none'";

const META_CSP = `<meta http-equiv="Content-Security-Policy" content="${REPORT_CSP}">`;

/**
 * The report with the CSP as the first element of `<head>` (so it applies
 * to everything after it), and meta refresh and base elements removed.
 */
export function prepareReportHtml(html: string): string {
  const cleaned = html
    .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?\s*refresh[^>]*>/gi, '')
    .replace(/<base\b[^>]*>/gi, '');
  const head = /<head\b[^>]*>/i.exec(cleaned);
  if (head) {
    const at = head.index + head[0].length;
    return cleaned.slice(0, at) + META_CSP + cleaned.slice(at);
  }
  const root = /<html\b[^>]*>/i.exec(cleaned);
  if (root) {
    const at = root.index + root[0].length;
    return cleaned.slice(0, at) + `<head>${META_CSP}</head>` + cleaned.slice(at);
  }
  return `<!DOCTYPE html><html><head>${META_CSP}</head><body>${cleaned}</body></html>`;
}
