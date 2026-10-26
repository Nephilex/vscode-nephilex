/**
 * Pure mapping from Nephilex findings to editor concepts (severity levels,
 * diagnostic messages, ranges, file paths). Kept free of the `vscode` module
 * so it can be unit tested in plain Node.
 */
import * as path from 'node:path';
import { NephilexFinding, NephilexLocation, SeverityLevel, SeverityName, SEVERITY_NAMES } from './report';

export type DiagnosticLevel = 'error' | 'warning' | 'information';

/** critical/high = error, medium = warning, low/info = information. */
export function diagnosticLevel(severity: SeverityLevel): DiagnosticLevel {
  if (severity >= 3) {
    return 'error';
  }
  if (severity === 2) {
    return 'warning';
  }
  return 'information';
}

export function severityAtLeast(severity: SeverityLevel, min: SeverityName): boolean {
  return severity >= SEVERITY_NAMES.indexOf(min);
}

export function isCriticalOrHigh(f: NephilexFinding): boolean {
  return f.severity >= 3;
}

/** Collapse whitespace so a finding title renders on one line. */
function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Diagnostic message: the evidence grade when the CLI reports one, the title,
 * then the CWE and OWASP mappings, e.g.
 * `[likely] Unsafe yaml.load without SafeLoader (CWE-502; OWASP A08:2021-Software ...)`.
 */
export function diagnosticMessage(f: NephilexFinding): string {
  const parts: string[] = [];
  if (f.cwe.length) {
    parts.push(f.cwe.map(oneLine).join(', '));
  }
  if (f.owasp.length) {
    parts.push('OWASP ' + f.owasp.map(oneLine).join(', '));
  }
  const grade = f.evidence?.grade ? `[${f.evidence.grade}] ` : '';
  const title = grade + oneLine(f.title);
  return parts.length ? `${title} (${parts.join('; ')})` : title;
}

export const DEFAULT_DOCS_URL = 'https://nephilex.github.io/nephilex/scanners/';

/** Returns the URL only when it is a well-formed https URL; never other schemes. */
export function safeHttpsUrl(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function docsUrl(f: NephilexFinding): string {
  return safeHttpsUrl(f.docsUrl) ?? DEFAULT_DOCS_URL;
}

/** Minimal view of a text document needed to compute ranges. */
export interface LineSource {
  readonly lineCount: number;
  lineText(line: number): string;
}

/** Zero-based range, as used by the editor. */
export interface ZeroRange {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
}

function firstNonWhitespace(text: string): number {
  const m = /\S/.exec(text);
  return m ? m.index : 0;
}

function trimmedEnd(text: string): number {
  return text.replace(/\s+$/, '').length;
}

/**
 * Compute the editor range for a finding location. Nephilex lines and columns are
 * 1-based; a missing line means a file-level finding (mapped to line 1). With
 * no columns, the range covers the line without its leading and trailing
 * whitespace. Out-of-range values are clamped to the document.
 */
export function computeRange(loc: NephilexLocation, doc: LineSource): ZeroRange {
  const last = Math.max(doc.lineCount - 1, 0);
  const startLine = Math.min(Math.max((loc.startLine ?? 1) - 1, 0), last);
  let endLine = loc.endLine !== undefined ? Math.min(Math.max(loc.endLine - 1, startLine), last) : startLine;
  const startText = doc.lineText(startLine);
  let startCharacter =
    loc.startColumn !== undefined ? Math.min(loc.startColumn - 1, startText.length) : firstNonWhitespace(startText);
  let endCharacter: number;
  if (loc.endColumn !== undefined && (loc.endLine !== undefined || loc.startColumn !== undefined)) {
    endCharacter = Math.min(loc.endColumn - 1, doc.lineText(endLine).length);
  } else {
    endCharacter = trimmedEnd(doc.lineText(endLine));
  }
  if (endLine === startLine && endCharacter <= startCharacter) {
    // Degenerate (empty line or bad columns): fall back to the whole line.
    startCharacter = 0;
    endCharacter = startText.length;
    endLine = startLine;
  }
  return { startLine, startCharacter, endLine, endCharacter };
}

/**
 * Resolve a finding path to an absolute file system path. Nephilex reports paths
 * relative to the scan root (`report.target`; for a file target, the CLI uses
 * the file's directory). Absolute paths are kept as is.
 */
export function resolveFindingPath(findingPath: string, root: string): string {
  if (path.isAbsolute(findingPath)) {
    return path.normalize(findingPath);
  }
  return path.resolve(root, findingPath);
}

/** Case-insensitive on Windows and macOS default file systems. */
export function samePath(a: string, b: string, platform: NodeJS.Platform = process.platform): boolean {
  const na = path.resolve(a);
  const nb = path.resolve(b);
  return platform === 'win32' || platform === 'darwin' ? na.toLowerCase() === nb.toLowerCase() : na === nb;
}

/** True when `child` is `parent` or inside it. */
export function isInside(child: string, parent: string, platform: NodeJS.Platform = process.platform): boolean {
  const fold = (p: string): string => (platform === 'win32' || platform === 'darwin' ? p.toLowerCase() : p);
  const rel = path.relative(fold(path.resolve(parent)), fold(path.resolve(child)));
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}
