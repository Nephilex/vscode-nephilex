import * as vscode from 'vscode';
import { hasVerifiedFix } from './core/fix';
import { docsUrl, safeHttpsUrl } from './core/mapping';
import { ArgusFinding, severityName } from './core/report';
import { FindingStore } from './findingStore';

const MAX_SECTION = 4000;

function clip(s: string): string {
  return s.length > MAX_SECTION ? s.slice(0, MAX_SECTION) + '...' : s;
}

/** Percent-encode characters that would end a Markdown link target early. */
function linkTarget(url: string): string {
  return url.replace(/[()<>\s]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));
}

/** Escape text for use inside a Markdown link label. */
function escapeLabel(s: string): string {
  return s.replace(/[\\`*_{}[\]()#+\-.!<>|~]/g, '\\$&');
}

/**
 * Hover content for a finding. All finding text comes from scanning
 * workspace content and is inserted with `appendText` (escaped), never as
 * Markdown; the MarkdownString is not trusted, so command links do not run.
 */
export function findingHover(f: ArgusFinding): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, false);
  md.isTrusted = false;
  md.supportHtml = false;
  const heading = (s: string): void => {
    md.appendMarkdown(`\n\n**${s}**\n\n`);
  };
  md.appendMarkdown('**Argus: ');
  md.appendText(f.title);
  md.appendMarkdown('**\n\n');
  const tax = [severityName(f.severity).toUpperCase(), f.ruleId, ...f.cwe, ...f.owasp];
  md.appendText(tax.join(' | '));

  const why = f.whyVulnerable || f.description;
  if (why) {
    heading('Why it is vulnerable');
    md.appendText(clip(why));
  }
  if (f.attackerPerspective) {
    heading('Attacker perspective');
    md.appendText(clip(f.attackerPerspective));
  }
  if (f.businessImpact) {
    heading('Impact');
    md.appendText(clip(f.businessImpact));
  }
  const r = f.remediation;
  if (r && (r.summary || r.guidance)) {
    heading('How to fix');
    if (r.summary) {
      md.appendText(clip(r.summary));
    }
    if (r.guidance) {
      md.appendMarkdown('\n\n');
      md.appendText(clip(r.guidance));
    }
    if (hasVerifiedFix(f)) {
      md.appendMarkdown('\n\n');
      md.appendText('A verified fix is available as a quick fix.');
    }
  }
  const refs = (r?.references ?? []).map(safeHttpsUrl).filter((u): u is string => !!u);
  md.appendMarkdown('\n\n');
  md.appendMarkdown(`[Rule documentation](${linkTarget(docsUrl(f))})`);
  for (const ref of refs.slice(0, 5)) {
    md.appendMarkdown(` | [${escapeLabel(new URL(ref).hostname)}](${linkTarget(ref)})`);
  }
  return md;
}

export class ArgusHoverProvider implements vscode.HoverProvider {
  constructor(private readonly store: FindingStore) {}

  provideHover(doc: vscode.TextDocument, pos: vscode.Position): vscode.Hover | undefined {
    const hits = this.store.get(doc.uri).filter((s) => s.diagnostic.range.contains(pos));
    if (hits.length === 0) {
      return undefined;
    }
    const parts = hits.slice(0, 5).map((h) => findingHover(h.finding));
    return new vscode.Hover(parts, hits[0]?.diagnostic.range);
  }
}
