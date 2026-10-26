import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseEvidence } from '../../src/core/evidence';
import { NephilexFinding, parseReport } from '../../src/core/report';
import {
  buildTree,
  countsSentence,
  DEFAULT_FILTER,
  FileNode,
  FindingEntry,
  filterMessage,
  passesFilter,
  SeverityNode,
  severityCounts,
  statusSummary,
} from '../../src/core/tree';

const fixtures = path.join(__dirname, '..', '..', '..', 'test', 'fixtures');
const evidenceReport = parseReport(fs.readFileSync(path.join(fixtures, 'report-evidence.json'), 'utf8'));
const plainReport = parseReport(fs.readFileSync(path.join(fixtures, 'report-scan.json'), 'utf8'));

function entries(findings: NephilexFinding[]): FindingEntry<number>[] {
  return findings.map((finding, i) => ({
    fileKey: `file:///work/sample/${finding.location.path}`,
    fileLabel: finding.location.path,
    finding,
    line: (finding.location.startLine ?? 1) - 1,
    character: 0,
    ref: i,
  }));
}

function finding(over: Partial<NephilexFinding>): NephilexFinding {
  return {
    id: 'x',
    ruleId: 'r',
    scanner: 's',
    title: 't',
    description: '',
    location: { path: 'a.py', startLine: 1 },
    severity: 2,
    cwe: [],
    owasp: [],
    whyVulnerable: '',
    attackerPerspective: '',
    businessImpact: '',
    ...over,
  };
}

describe('findings tree', () => {
  it('groups by severity, then file, with counts', () => {
    const model = buildTree(entries(evidenceReport.findings), DEFAULT_FILTER, 'severity');
    assert.equal(model.shown, 8);
    assert.equal(model.hidden, 0);
    const roots = model.roots as SeverityNode<number>[];
    assert.deepEqual(
      roots.map((r) => [r.label, r.count]),
      [
        ['Critical', 1],
        ['High', 5],
        ['Medium', 2],
      ],
    );
    const high = roots[1]!;
    assert.deepEqual(
      high.children.map((f) => [f.label, f.count]),
      [
        ['app.py', 3],
        ['web.py', 2],
      ],
    );
    // Findings in a file are ordered by line.
    assert.deepEqual(
      high.children[0]!.children.map((n) => n.entry.line + 1),
      [2, 4, 11],
    );
    const sql = high.children[1]!.children.find((n) => n.entry.finding.ruleId === 'ast-python.ast-sql-injection');
    assert.ok(sql);
    assert.equal(sql.description, '[likely] line 13');
    assert.match(sql.tooltip, /Evidence: likely\. Request data reaches the SQL call/);
  });

  it('groups by file, ordering findings by severity then line', () => {
    const model = buildTree(entries(evidenceReport.findings), DEFAULT_FILTER, 'file');
    const roots = model.roots as FileNode<number>[];
    assert.deepEqual(
      roots.map((r) => [r.kind, r.label, r.count]),
      [
        ['file', 'app.py', 6],
        ['file', 'web.py', 2],
      ],
    );
    const app = roots[0]!.children;
    assert.deepEqual(
      app.map((n) => [n.entry.finding.severity, n.entry.line + 1]),
      [
        [4, 2],
        [3, 2],
        [3, 4],
        [3, 11],
        [2, 6],
        [2, 8],
      ],
    );
    assert.equal(app[0]!.description, 'critical [likely] line 2');
  });

  it('gives every node a unique id', () => {
    for (const groupBy of ['severity', 'file'] as const) {
      const ids: string[] = [];
      const walk = (nodes: { id: string; children?: unknown[] }[]): void => {
        for (const n of nodes) {
          ids.push(n.id);
          walk((n.children ?? []) as { id: string; children?: unknown[] }[]);
        }
      };
      const dup = entries([...evidenceReport.findings, ...evidenceReport.findings]);
      walk(buildTree(dup, DEFAULT_FILTER, groupBy).roots);
      assert.equal(new Set(ids).size, ids.length, groupBy);
    }
  });

  it('filters by minimum severity', () => {
    const model = buildTree(entries(evidenceReport.findings), { minSeverity: 'high', grade: 'all' }, 'severity');
    assert.equal(model.shown, 6);
    assert.equal(model.hidden, 2);
    assert.deepEqual(
      model.roots.map((r) => r.label),
      ['Critical', 'High'],
    );
    assert.equal(filterMessage({ minSeverity: 'high', grade: 'all' }, 2), 'Showing high and above. 2 hidden.');
  });

  it('filters by evidence grade', () => {
    const likely = buildTree(entries(evidenceReport.findings), { minSeverity: 'info', grade: 'likely' }, 'severity');
    assert.equal(likely.shown, 2);
    assert.equal(
      filterMessage({ minSeverity: 'medium', grade: 'likely' }, 6),
      'Showing medium and above, likely or confirmed. 6 hidden.',
    );
    const confirmed = buildTree(entries(evidenceReport.findings), { minSeverity: 'info', grade: 'confirmed' }, 'file');
    assert.equal(confirmed.shown, 0);
    assert.deepEqual(confirmed.roots, []);
    assert.equal(filterMessage(DEFAULT_FILTER, 0), undefined);
  });

  it('shows findings without evidence unless a grade filter is set', () => {
    const plain = entries(plainReport.findings);
    const all = buildTree(plain, DEFAULT_FILTER, 'severity');
    assert.equal(all.shown, 5);
    const node = (all.roots[0] as SeverityNode<number>).children[0]!.children[0]!;
    assert.doesNotMatch(node.description, /\[/);
    assert.doesNotMatch(node.tooltip, /Evidence/);
    assert.equal(buildTree(plain, { minSeverity: 'info', grade: 'likely' }, 'severity').shown, 0);
  });

  it('treats an unknown grade as ungraded', () => {
    const f = finding({ evidence: parseEvidence({ grade: 'proven', basis: 'b' }) });
    assert.equal(passesFilter(f, DEFAULT_FILTER), true);
    assert.equal(passesFilter(f, { minSeverity: 'info', grade: 'likely' }), false);
  });

  it('renders hostile titles and paths as one safe line', () => {
    const rlo = String.fromCodePoint(0x202e);
    const f = finding({ title: `evil\n${rlo}title <b>x</b>`, location: { path: `dir${rlo}/a.py`, startLine: 3 } });
    const model = buildTree(
      [{ fileKey: 'k', fileLabel: f.location.path, finding: f, line: 2, character: 0, ref: 0 }],
      DEFAULT_FILTER,
      'file',
    );
    const file = model.roots[0] as FileNode<number>;
    assert.equal(file.label, 'dir<U+202E>/a.py');
    assert.equal(file.children[0]!.label, 'evil <U+202E>title <b>x</b>');
    assert.ok(!file.children[0]!.tooltip.includes(rlo));
  });
});

describe('severity summary', () => {
  it('counts findings per severity', () => {
    const counts = severityCounts(evidenceReport.findings);
    assert.deepEqual(counts, [0, 0, 2, 5, 1]);
    assert.equal(statusSummary(counts), '1C 5H 2M');
    assert.equal(statusSummary([0, 0, 0, 0, 0]), '0');
    assert.equal(statusSummary([3, 1, 0, 0, 0]), '1L 3I');
    assert.equal(countsSentence(counts), '1 critical, 5 high, 2 medium, 0 low, 0 info');
  });
});
