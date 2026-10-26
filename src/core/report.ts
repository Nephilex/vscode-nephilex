/**
 * Parsing and validation of the Nephilex JSON report (`nephilex scan -f json` and
 * `nephilex check --format json`). The schema mirrors `nephilex.core.models` in the
 * main repository (ScanResult, Finding, Location, Remediation).
 *
 * The report is produced by scanning workspace content, so every string in it
 * is treated as untrusted data: values are type checked, length capped, and
 * never interpreted as markup or commands by the extension.
 */
import { NephilexEvidence, parseEvidence } from './evidence';

export const SEVERITY_NAMES = ['info', 'low', 'medium', 'high', 'critical'] as const;
export type SeverityName = (typeof SEVERITY_NAMES)[number];

/** Numeric severity as emitted by the CLI: 0 = info ... 4 = critical. */
export type SeverityLevel = 0 | 1 | 2 | 3 | 4;

export interface NephilexLocation {
  path: string;
  startLine?: number;
  endLine?: number;
  startColumn?: number;
  endColumn?: number;
  snippet?: string;
}

export interface NephilexRemediation {
  summary: string;
  guidance: string;
  patch?: string;
  references: string[];
  verified: boolean;
}

export interface NephilexFinding {
  id: string;
  ruleId: string;
  scanner: string;
  title: string;
  description: string;
  location: NephilexLocation;
  severity: SeverityLevel;
  cwe: string[];
  owasp: string[];
  whyVulnerable: string;
  attackerPerspective: string;
  businessImpact: string;
  remediation?: NephilexRemediation;
  docsUrl?: string;
  /** `metadata.patch_source`: "deterministic" or "ai-proposed" when a patch exists. */
  patchSource?: string;
  /** Grade, data-flow path, and verification steps (CLI 0.12.0 and later; absent before). */
  evidence?: NephilexEvidence;
}

export interface NephilexReport {
  target: string;
  nephilexVersion: string;
  scannersRun: string[];
  scannersFailed: string[];
  errors: string[];
  findings: NephilexFinding[];
  /** Number of entries in `findings` that were malformed and skipped. */
  skipped: number;
}

export class ReportParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReportParseError';
  }
}

const MAX_TEXT = 20_000;
const MAX_SHORT = 512;
const MAX_LIST = 64;
const MAX_FINDINGS = 50_000;

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown, max = MAX_TEXT): string {
  if (typeof v !== 'string') {
    return '';
  }
  return v.length > max ? v.slice(0, max) : v;
}

function optStr(v: unknown, max = MAX_TEXT): string | undefined {
  const s = str(v, max);
  return s === '' ? undefined : s;
}

function strList(v: unknown, max = MAX_SHORT): string[] {
  if (!Array.isArray(v)) {
    return [];
  }
  const out: string[] = [];
  for (const item of v.slice(0, MAX_LIST)) {
    const s = str(item, max);
    if (s) {
      out.push(s);
    }
  }
  return out;
}

function posInt(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 10_000_000 ? v : undefined;
}

/** Accepts the numeric form (0..4) and, for forward compatibility, the name. */
export function parseSeverity(v: unknown): SeverityLevel | undefined {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 4) {
    return v as SeverityLevel;
  }
  if (typeof v === 'string') {
    const idx = SEVERITY_NAMES.indexOf(v.trim().toLowerCase() as SeverityName);
    if (idx >= 0) {
      return idx as SeverityLevel;
    }
  }
  return undefined;
}

export function severityName(level: SeverityLevel): SeverityName {
  return SEVERITY_NAMES[level];
}

function parseLocation(v: unknown): NephilexLocation | undefined {
  if (!isObject(v)) {
    return undefined;
  }
  const path = str(v['path'], 4096);
  if (!path) {
    return undefined;
  }
  return {
    path,
    startLine: posInt(v['start_line']),
    endLine: posInt(v['end_line']),
    startColumn: posInt(v['start_column']),
    endColumn: posInt(v['end_column']),
    snippet: optStr(v['snippet']),
  };
}

function parseRemediation(v: unknown): NephilexRemediation | undefined {
  if (!isObject(v)) {
    return undefined;
  }
  return {
    summary: str(v['summary']),
    guidance: str(v['guidance']),
    patch: optStr(v['patch'], 200_000),
    references: strList(v['references'], 2048),
    verified: v['verified'] === true,
  };
}

export function parseFinding(v: unknown): NephilexFinding | undefined {
  if (!isObject(v)) {
    return undefined;
  }
  const ruleId = str(v['rule_id'], MAX_SHORT);
  const location = parseLocation(v['location']);
  const severity = parseSeverity(v['severity']);
  if (!ruleId || !location || severity === undefined) {
    return undefined;
  }
  const metadata = isObject(v['metadata']) ? v['metadata'] : {};
  return {
    id: str(v['id'], MAX_SHORT) || ruleId,
    ruleId,
    scanner: str(v['scanner'], MAX_SHORT),
    title: str(v['title'], MAX_SHORT * 2) || ruleId,
    description: str(v['description']),
    location,
    severity,
    cwe: strList(v['cwe'], 64),
    owasp: strList(v['owasp'], 256),
    whyVulnerable: str(v['why_vulnerable']),
    attackerPerspective: str(v['attacker_perspective']),
    businessImpact: str(v['business_impact']),
    remediation: parseRemediation(v['remediation']),
    docsUrl: optStr(v['docs_url'], 2048),
    patchSource: optStr(metadata['patch_source'], 64),
    evidence: parseEvidence(v['evidence']),
  };
}

/** Parse a report from CLI stdout (string) or an already decoded value. */
export function parseReport(input: unknown): NephilexReport {
  let raw: unknown = input;
  if (typeof input === 'string') {
    const text = input.trim();
    if (!text) {
      throw new ReportParseError('Nephilex produced no output.');
    }
    try {
      raw = JSON.parse(text) as unknown;
    } catch {
      throw new ReportParseError('Nephilex output is not valid JSON.');
    }
  }
  if (!isObject(raw) || !Array.isArray(raw['findings'])) {
    throw new ReportParseError('Nephilex output is not a scan report (no "findings" array).');
  }
  const findings: NephilexFinding[] = [];
  let skipped = 0;
  for (const item of raw['findings'].slice(0, MAX_FINDINGS)) {
    const f = parseFinding(item);
    if (f) {
      findings.push(f);
    } else {
      skipped++;
    }
  }
  return {
    target: str(raw['target'], 4096),
    nephilexVersion: str(raw['nephilex_version'], 64),
    scannersRun: strList(raw['scanners_run']),
    scannersFailed: strList(raw['scanners_failed']),
    errors: strList(raw['errors'], 2048),
    findings,
    skipped,
  };
}
