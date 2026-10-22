import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseFinding, parseReport, parseSeverity, ReportParseError, severityName } from '../../src/core/report';

const fixture = path.join(__dirname, '..', '..', '..', 'test', 'fixtures', 'report-scan.json');

describe('report parsing', () => {
  it('parses a real scan report', () => {
    const report = parseReport(fs.readFileSync(fixture, 'utf8'));
    assert.equal(report.nephilexVersion, '0.9.2');
    assert.equal(report.findings.length, 5);
    assert.equal(report.skipped, 0);
    const yaml = report.findings.find((f) => f.ruleId === 'patterns.python-yaml-load');
    assert.ok(yaml);
    assert.equal(yaml.severity, 3);
    assert.deepEqual(yaml.cwe, ['CWE-502']);
    assert.equal(yaml.location.path, 'app.py');
    assert.equal(yaml.location.startLine, 11);
    assert.equal(yaml.location.startColumn, undefined);
    assert.equal(yaml.remediation?.verified, true);
    assert.equal(yaml.patchSource, 'deterministic');
    assert.ok(yaml.whyVulnerable.length > 0);
    assert.ok(yaml.docsUrl?.startsWith('https://'));
  });

  it('rejects output that is not a report', () => {
    assert.throws(() => parseReport(''), ReportParseError);
    assert.throws(() => parseReport('Wrote report.json'), ReportParseError);
    assert.throws(() => parseReport('{"target": "x"}'), ReportParseError);
    assert.throws(() => parseReport('[]'), ReportParseError);
  });

  it('skips malformed findings instead of failing the whole report', () => {
    const report = parseReport({
      findings: [
        { rule_id: 'a', severity: 2, location: { path: 'x.py', start_line: 3 } },
        { rule_id: 'b', severity: 9, location: { path: 'x.py' } },
        { severity: 2, location: { path: 'x.py' } },
        { rule_id: 'c', severity: 1, location: {} },
        'nonsense',
      ],
    });
    assert.equal(report.findings.length, 1);
    assert.equal(report.skipped, 4);
    assert.equal(report.findings[0]?.title, 'a');
  });

  it('ignores wrongly typed fields', () => {
    const f = parseFinding({
      rule_id: 'r',
      severity: 'HIGH',
      title: 42,
      cwe: ['CWE-1', 7, null],
      location: { path: 'a.js', start_line: 0, end_line: -1, start_column: 1.5 },
      remediation: { summary: 'do it', verified: 'yes' },
    });
    assert.ok(f);
    assert.equal(f.severity, 3);
    assert.equal(f.title, 'r');
    assert.deepEqual(f.cwe, ['CWE-1']);
    assert.equal(f.location.startLine, undefined);
    assert.equal(f.location.endLine, undefined);
    assert.equal(f.location.startColumn, undefined);
    assert.equal(f.remediation?.verified, false);
  });

  it('caps very long strings', () => {
    const f = parseFinding({ rule_id: 'r', severity: 0, description: 'x'.repeat(100_000), location: { path: 'p' } });
    assert.ok(f && f.description.length <= 20_000);
  });

  it('keeps non-ASCII text intact', () => {
    // Built from code points so the source file stays ASCII.
    const nonAscii = 'caf' + String.fromCodePoint(0xe9) + ' ' + String.fromCodePoint(0x2192) + ' x';
    const f = parseFinding({ rule_id: 'r', severity: 0, title: nonAscii, location: { path: 'p' } });
    assert.equal(f?.title, nonAscii);
  });

  it('maps severities both ways', () => {
    assert.equal(parseSeverity(4), 4);
    assert.equal(parseSeverity('critical'), 4);
    assert.equal(parseSeverity('Info'), 0);
    assert.equal(parseSeverity(5), undefined);
    assert.equal(parseSeverity(true), undefined);
    assert.equal(severityName(2), 'medium');
  });
});
