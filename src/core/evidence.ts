/**
 * The `evidence` block of a finding (Nephilex CLI 0.12.0 and later): how
 * strong the proof is, the data-flow path from source to sink, and a few
 * steps to confirm or rule out the finding. The schema mirrors `Evidence` and
 * `EvidenceStep` in `nephilex.core.models` in the main repository.
 *
 * Evidence is optional. Reports from older CLIs have no such field, and
 * every function here accepts its absence (or a malformed value) without
 * throwing. Like the rest of the report, evidence text quotes the scanned
 * repository, so it is untrusted: type checked, length capped, reduced to one
 * line, and stripped of control, bidirectional and zero-width characters
 * before it is shown.
 */
import * as path from 'node:path';
import { isInside, resolveFindingPath, samePath } from './mapping';

export const EVIDENCE_GRADES = ['confirmed', 'likely', 'possible'] as const;
export type EvidenceGrade = (typeof EVIDENCE_GRADES)[number];

export const EVIDENCE_ROLES = ['source', 'step', 'guard', 'sink', 'elided'] as const;
export type EvidenceRole = (typeof EVIDENCE_ROLES)[number];

export interface EvidenceStep {
  path: string;
  line?: number;
  column?: number;
  role: EvidenceRole;
  code: string;
  note: string;
}

export interface NephilexEvidence {
  /** Undefined when the CLI sent a grade this version does not know. */
  grade?: EvidenceGrade;
  basis: string;
  path: EvidenceStep[];
  verify: string[];
}

/** The CLI keeps at most 12 steps; anything far beyond that is not a real path. */
const MAX_STEPS = 32;
const MAX_VERIFY = 8;
const MAX_CODE = 512;
const MAX_NOTE = 1000;

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function posInt(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 10_000_000 ? v : undefined;
}

/**
 * Characters that must never reach the editor as is: C0 and C1 controls,
 * DEL, bidirectional overrides and isolates (Trojan Source), zero-width
 * characters, and the Unicode line and paragraph separators. Whitespace
 * controls (tab, line breaks) are collapsed to a space before this applies.
 */
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g;

/**
 * Untrusted text reduced to one safe line: runs of whitespace become one
 * space, unsafe characters are shown as `<U+XXXX>`, and the result is
 * clipped to `max` characters. Markdown escaping is still the caller's job.
 */
export function safeInline(s: string, max = MAX_NOTE): string {
  const flat = s
    .replace(/[\t\n\v\f\r\u0085\u2028\u2029 ]+/g, ' ')
    .replace(UNSAFE_CHARS, (c) => `<U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}>`)
    .trim();
  return flat.length > max ? flat.slice(0, max) + '...' : flat;
}

function text(v: unknown, max: number): string {
  // Clip before cleaning so a huge value is not processed in full.
  return typeof v === 'string' ? safeInline(v.slice(0, max * 2), max) : '';
}

export function parseGrade(v: unknown): EvidenceGrade | undefined {
  if (typeof v !== 'string') {
    return undefined;
  }
  const g = v.trim().toLowerCase();
  return (EVIDENCE_GRADES as readonly string[]).includes(g) ? (g as EvidenceGrade) : undefined;
}

function parseStep(v: unknown): EvidenceStep | undefined {
  if (!isObject(v)) {
    return undefined;
  }
  const p = typeof v['path'] === 'string' ? v['path'].slice(0, 4096) : '';
  if (!p || p.includes('\0')) {
    return undefined;
  }
  const role = typeof v['role'] === 'string' ? v['role'] : '';
  return {
    path: p,
    line: posInt(v['line']),
    column: posInt(v['column']),
    role: (EVIDENCE_ROLES as readonly string[]).includes(role) ? (role as EvidenceRole) : 'step',
    code: text(v['code'], MAX_CODE),
    note: text(v['note'], MAX_NOTE),
  };
}

/**
 * Parse `finding.evidence`. Returns undefined when it is absent or carries
 * nothing usable, so callers can treat "no evidence" as one case.
 */
export function parseEvidence(v: unknown): NephilexEvidence | undefined {
  if (!isObject(v)) {
    return undefined;
  }
  const steps: EvidenceStep[] = [];
  if (Array.isArray(v['path'])) {
    for (const item of v['path'].slice(0, MAX_STEPS)) {
      const s = parseStep(item);
      if (s) {
        steps.push(s);
      }
    }
  }
  const verify: string[] = [];
  if (Array.isArray(v['verify'])) {
    for (const item of v['verify'].slice(0, MAX_VERIFY)) {
      const s = text(item, MAX_NOTE);
      if (s) {
        verify.push(s);
      }
    }
  }
  const ev: NephilexEvidence = {
    grade: parseGrade(v['grade']),
    basis: text(v['basis'], MAX_NOTE),
    path: steps,
    verify,
  };
  if (!ev.grade && !ev.basis && steps.length === 0 && verify.length === 0) {
    return undefined;
  }
  return ev;
}

/** `[likely] ` for a diagnostic message, or nothing without a grade. */
export function gradePrefix(ev: NephilexEvidence | undefined): string {
  return ev?.grade ? `[${ev.grade}] ` : '';
}

/** `web.py:9` or `web.py` for a step without a line. */
export function stepRef(step: EvidenceStep): string {
  const p = safeInline(step.path, 300);
  return step.line === undefined ? p : `${p}:${step.line}`;
}

/** One related-information entry for the Problems panel. */
export interface RelatedStep {
  /** Step path as reported (relative to the scan root, or absolute). */
  path: string;
  /** 1-based, as reported. */
  line: number;
  column?: number;
  message: string;
}

/**
 * The path steps that can be shown as clickable related information. Elided
 * markers and steps without a line have no location and are left out. A path
 * that is only the finding's own line adds nothing and yields no entries.
 */
export function relatedSteps(ev: NephilexEvidence | undefined, findingLine: number | undefined): RelatedStep[] {
  if (!ev) {
    return [];
  }
  const located = ev.path.filter((s) => s.role !== 'elided' && s.line !== undefined);
  if (located.length === 1 && located[0]?.line === (findingLine ?? 1) && ev.path.length === 1) {
    return [];
  }
  return located.map((s, i) => {
    const what = s.note || s.code;
    return {
      path: s.path,
      line: s.line ?? 1,
      column: s.column,
      message: what ? `${i + 1}. ${s.role}: ${what}` : `${i + 1}. ${s.role}`,
    };
  });
}

/** Where evidence step paths may point, for turning them into editor locations. */
export interface StepPathContext {
  /** Directories the CLI may report paths relative to, tried in order. */
  roots: readonly string[];
  /** The scanned file: its canonical path and the path the editor uses for it. */
  file?: { real: string; local: string };
  /**
   * A directory whose files can be linked (canonical path and editor path).
   * Without it, only the scanned file itself is linked: a temporary copy has
   * no other files worth opening.
   */
  folder?: { real: string; local: string };
}

/**
 * Map a step path to a file the editor can open, or undefined. Paths are
 * never followed outside `folder` (or other than `file`), so a report cannot
 * point the editor at arbitrary files on disk.
 */
export function resolveStepPath(
  stepPath: string,
  ctx: StepPathContext,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  for (const root of ctx.roots) {
    const abs = resolveFindingPath(stepPath, root);
    if (ctx.file && samePath(abs, ctx.file.real, platform)) {
      return ctx.file.local;
    }
    if (ctx.folder && isInside(abs, ctx.folder.real, platform)) {
      return path.join(ctx.folder.local, path.relative(ctx.folder.real, abs));
    }
  }
  return undefined;
}

/** A piece of hover content: fixed Markdown written by the extension, or untrusted text to escape. */
export type HoverPart = { markdown: string } | { text: string };

/**
 * The evidence section of a hover. Only fixed strings, numbers, and the
 * validated grade are emitted as Markdown; everything taken from the report
 * is a `text` part, already reduced to one safe line, which the caller must
 * insert escaped (`MarkdownString.appendText`).
 */
export function evidenceHoverParts(ev: NephilexEvidence | undefined): HoverPart[] {
  if (!ev) {
    return [];
  }
  const out: HoverPart[] = [];
  out.push({ markdown: ev.grade ? `\n\n**Evidence:** \`${ev.grade}\`` : '\n\n**Evidence**' });
  if (ev.basis) {
    out.push({ markdown: ' ' }, { text: ev.basis });
  }
  if (ev.path.length) {
    out.push({ markdown: '\n\n**Path**\n\n' });
    let n = 0;
    for (const s of ev.path) {
      if (s.role === 'elided') {
        out.push({ markdown: '- ' }, { text: s.note || 'steps left out' }, { markdown: '\n' });
        continue;
      }
      n++;
      out.push({ markdown: `${n}. ` }, { text: `${stepRef(s)} ${s.role}` });
      if (s.note) {
        out.push({ markdown: ': ' }, { text: s.note });
      }
      out.push({ markdown: '\n' });
    }
  }
  if (ev.verify.length) {
    out.push({ markdown: '\n\n**How to verify**\n\n' });
    ev.verify.forEach((v, i) => {
      out.push({ markdown: `${i + 1}. ` }, { text: v }, { markdown: '\n' });
    });
  }
  return out;
}
