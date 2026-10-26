/**
 * The model behind the Nephilex Findings view: filtering, grouping by
 * severity or by file, counts, and the text shown for each node. Kept free
 * of the `vscode` module so it can be unit tested in plain Node; the view
 * provider turns nodes into TreeItems.
 *
 * Labels and descriptions carry report text (titles, file paths), so they
 * are reduced to one safe line here. Tree items render them as plain text.
 */
import { EvidenceGrade, safeInline } from './evidence';
import { NephilexFinding, SEVERITY_NAMES, SeverityLevel, SeverityName, severityName } from './report';

export type GroupBy = 'severity' | 'file';

/** `all` shows every finding; `likely` hides `possible` and ungraded ones; `confirmed` keeps only proof. */
export type GradeFilter = 'all' | 'likely' | 'confirmed';
export const GRADE_FILTERS: readonly GradeFilter[] = ['all', 'likely', 'confirmed'];

export interface TreeFilter {
  minSeverity: SeverityName;
  grade: GradeFilter;
}

export const DEFAULT_FILTER: TreeFilter = { minSeverity: 'info', grade: 'all' };

/** One finding as the view sees it. `T` is whatever the caller needs to act on it. */
export interface FindingEntry<T> {
  /** Stable key of the file (the URI string). */
  fileKey: string;
  /** Path shown for the file, for example relative to the workspace. */
  fileLabel: string;
  finding: NephilexFinding;
  /** Zero-based position of the diagnostic. */
  line: number;
  character: number;
  ref: T;
}

export interface FindingNode<T> {
  kind: 'finding';
  id: string;
  label: string;
  description: string;
  tooltip: string;
  entry: FindingEntry<T>;
}

export interface FileNode<T> {
  kind: 'file';
  id: string;
  label: string;
  fileKey: string;
  count: number;
  children: FindingNode<T>[];
}

export interface SeverityNode<T> {
  kind: 'severity';
  id: string;
  severity: SeverityLevel;
  label: string;
  count: number;
  children: FileNode<T>[];
}

export type GroupNode<T> = SeverityNode<T> | FileNode<T>;
export type TreeNode<T> = GroupNode<T> | FindingNode<T>;

export interface TreeModel<T> {
  roots: GroupNode<T>[];
  /** Findings that pass the filter. */
  shown: number;
  /** Findings hidden by the filter. */
  hidden: number;
}

const SEVERITY_LABELS: Record<SeverityName, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  info: 'Info',
};

export function severityLabel(level: SeverityLevel): string {
  return SEVERITY_LABELS[severityName(level)];
}

const MAX_LABEL = 200;

function gradeOf(f: NephilexFinding): EvidenceGrade | undefined {
  return f.evidence?.grade;
}

export function passesFilter(f: NephilexFinding, filter: TreeFilter): boolean {
  if (f.severity < SEVERITY_NAMES.indexOf(filter.minSeverity)) {
    return false;
  }
  const g = gradeOf(f);
  switch (filter.grade) {
    case 'all':
      return true;
    case 'likely':
      return g === 'likely' || g === 'confirmed';
    case 'confirmed':
      return g === 'confirmed';
  }
}

export function isDefaultFilter(filter: TreeFilter): boolean {
  return filter.minSeverity === DEFAULT_FILTER.minSeverity && filter.grade === DEFAULT_FILTER.grade;
}

/** `Showing high and above, likely or confirmed. 4 hidden.` or undefined when nothing is filtered. */
export function filterMessage(filter: TreeFilter, hidden: number): string | undefined {
  if (isDefaultFilter(filter)) {
    return undefined;
  }
  const parts: string[] = [];
  if (filter.minSeverity !== 'info') {
    parts.push(filter.minSeverity === 'critical' ? 'critical only' : `${filter.minSeverity} and above`);
  }
  if (filter.grade === 'likely') {
    parts.push('likely or confirmed');
  } else if (filter.grade === 'confirmed') {
    parts.push('confirmed only');
  }
  return `Showing ${parts.join(', ')}. ${hidden} hidden.`;
}

function byText(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : a < b ? -1 : a > b ? 1 : 0;
}

function byPosition<T>(a: FindingEntry<T>, b: FindingEntry<T>): number {
  return a.line - b.line || a.character - b.character || byText(a.finding.ruleId, b.finding.ruleId);
}

function findingNode<T>(e: FindingEntry<T>, groupBy: GroupBy, parentId: string, index: number): FindingNode<T> {
  const f = e.finding;
  const grade = gradeOf(f);
  const desc: string[] = [];
  if (groupBy === 'file') {
    desc.push(severityName(f.severity));
  }
  if (grade) {
    desc.push(`[${grade}]`);
  }
  desc.push(`line ${e.line + 1}`);
  const tip = [
    safeInline(f.title, MAX_LABEL),
    `${severityLabel(f.severity)} | ${safeInline(f.ruleId, MAX_LABEL)}`,
    `${safeInline(e.fileLabel, 1000)}:${e.line + 1}`,
  ];
  if (f.evidence) {
    const basis = f.evidence.basis ? ` ${f.evidence.basis}` : '';
    tip.push(`Evidence: ${grade ?? 'not graded'}.${basis}`);
  }
  return {
    kind: 'finding',
    id: `${parentId}/${e.line}:${e.character}:${f.ruleId}:${index}`,
    label: safeInline(f.title, MAX_LABEL) || safeInline(f.ruleId, MAX_LABEL),
    description: desc.join(' '),
    tooltip: tip.join('\n'),
    entry: e,
  };
}

function groupFiles<T>(entries: FindingEntry<T>[], groupBy: GroupBy, parentId: string): FileNode<T>[] {
  const files = new Map<string, FindingEntry<T>[]>();
  for (const e of entries) {
    const list = files.get(e.fileKey) ?? [];
    list.push(e);
    files.set(e.fileKey, list);
  }
  const nodes: FileNode<T>[] = [];
  for (const [fileKey, list] of files) {
    list.sort(groupBy === 'file' ? (a, b) => b.finding.severity - a.finding.severity || byPosition(a, b) : byPosition);
    const id = `${parentId}file:${fileKey}`;
    nodes.push({
      kind: 'file',
      id,
      label: safeInline(list[0]?.fileLabel ?? fileKey, 1000),
      fileKey,
      count: list.length,
      children: list.map((e, i) => findingNode(e, groupBy, id, i)),
    });
  }
  return nodes.sort((a, b) => byText(a.label, b.label) || byText(a.fileKey, b.fileKey));
}

/**
 * Build the view. By severity: Critical to Info (empty groups left out),
 * then files, then findings by line. By file: files by path, then findings
 * by severity and line.
 */
export function buildTree<T>(entries: readonly FindingEntry<T>[], filter: TreeFilter, groupBy: GroupBy): TreeModel<T> {
  const shown = entries.filter((e) => passesFilter(e.finding, filter));
  const hidden = entries.length - shown.length;
  if (groupBy === 'file') {
    return { roots: groupFiles(shown, groupBy, ''), shown: shown.length, hidden };
  }
  const roots: SeverityNode<T>[] = [];
  for (let level = 4; level >= 0; level--) {
    const items = shown.filter((e) => e.finding.severity === level);
    if (items.length === 0) {
      continue;
    }
    const sev = level as SeverityLevel;
    const id = `severity:${severityName(sev)}`;
    roots.push({
      kind: 'severity',
      id,
      severity: sev,
      label: severityLabel(sev),
      count: items.length,
      children: groupFiles(items, groupBy, `${id}/`),
    });
  }
  return { roots, shown: shown.length, hidden };
}

/** Number of findings per severity, indexed by level (0 = info ... 4 = critical). */
export function severityCounts(findings: Iterable<NephilexFinding>): [number, number, number, number, number] {
  const counts: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  for (const f of findings) {
    counts[f.severity]++;
  }
  return counts;
}

/** Status bar text after a scan, e.g. `1C 3H 2M`; `0` when there are no findings. */
export function statusSummary(counts: readonly number[]): string {
  const letters = ['I', 'L', 'M', 'H', 'C'];
  const parts: string[] = [];
  for (let level = 4; level >= 0; level--) {
    const n = counts[level] ?? 0;
    if (n > 0) {
      parts.push(`${n}${letters[level] ?? ''}`);
    }
  }
  return parts.length ? parts.join(' ') : '0';
}

/** `1 critical, 3 high, 2 medium, 0 low, 0 info` for tooltips. */
export function countsSentence(counts: readonly number[]): string {
  const parts: string[] = [];
  for (let level = 4; level >= 0; level--) {
    parts.push(`${counts[level] ?? 0} ${SEVERITY_NAMES[level] ?? ''}`);
  }
  return parts.join(', ');
}
