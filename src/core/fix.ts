/**
 * Deterministic fixes. Argus attaches a unified diff to `remediation.patch`.
 * A fix is offered only when the CLI marks it `verified` (re-scanned and the
 * detection no longer fires) and it was not machine proposed. The diff is
 * built from the finding snippet, which the CLI stores without the line's
 * leading indentation, so lines are matched on trimmed content and the
 * original indentation is preserved.
 */
import { ArgusFinding } from './report';
import { LineSource } from './mapping';

export interface ParsedHunk {
  /** 1-based line of the first removed line. */
  oldStart: number;
  removed: string[];
  added: string[];
}

export interface LineReplacement {
  /** Zero-based line index. */
  line: number;
  newText: string;
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Parse a single-hunk unified diff. Returns undefined for anything else. */
export function parseSingleHunk(patch: string): ParsedHunk | undefined {
  const lines = patch.replace(/\r\n/g, '\n').split('\n');
  let hunk: ParsedHunk | undefined;
  for (const line of lines) {
    if (line.startsWith('--- ') || line.startsWith('+++ ')) {
      if (hunk) {
        return undefined; // a second file header: not a single hunk
      }
      continue;
    }
    const m = HUNK.exec(line);
    if (m) {
      if (hunk) {
        return undefined; // multiple hunks are not applied automatically
      }
      hunk = { oldStart: Number(m[1]), removed: [], added: [] };
      continue;
    }
    if (!hunk) {
      continue;
    }
    if (line.startsWith('-')) {
      hunk.removed.push(line.slice(1));
    } else if (line.startsWith('+')) {
      hunk.added.push(line.slice(1));
    } else if (line.startsWith(' ')) {
      return undefined; // context lines are not produced by line rewrites
    } else if (line.startsWith('\\') || line === '') {
      continue;
    } else {
      return undefined;
    }
  }
  if (!hunk || hunk.removed.length === 0 || hunk.removed.length !== hunk.added.length) {
    return undefined;
  }
  return hunk;
}

/** True when the finding carries a verified, deterministic patch. */
export function hasVerifiedFix(f: ArgusFinding): boolean {
  const r = f.remediation;
  if (!r || !r.verified || !r.patch) {
    return false;
  }
  if (f.patchSource !== undefined && f.patchSource !== 'deterministic') {
    return false;
  }
  return parseSingleHunk(r.patch) !== undefined;
}

/**
 * Compute replacements for the current document text. Returns undefined when
 * the document no longer matches the patch (stale result), so a fix is never
 * applied to code it was not generated for.
 */
export function computeFix(f: ArgusFinding, doc: LineSource): LineReplacement[] | undefined {
  if (!hasVerifiedFix(f)) {
    return undefined;
  }
  const hunk = parseSingleHunk(f.remediation?.patch ?? '');
  if (!hunk) {
    return undefined;
  }
  const out: LineReplacement[] = [];
  for (let i = 0; i < hunk.removed.length; i++) {
    const lineIdx = hunk.oldStart - 1 + i;
    if (lineIdx < 0 || lineIdx >= doc.lineCount) {
      return undefined;
    }
    const current = doc.lineText(lineIdx);
    const before = (hunk.removed[i] ?? '').trim();
    const after = (hunk.added[i] ?? '').trim();
    if (!before || current.trim() !== before) {
      return undefined;
    }
    const start = current.indexOf(before);
    out.push({ line: lineIdx, newText: current.slice(0, start) + after + current.slice(start + before.length) });
  }
  return out;
}
