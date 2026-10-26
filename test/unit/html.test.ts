import * as assert from 'node:assert/strict';
import { buildScanArgs } from '../../src/core/cli';
import { prepareReportHtml, REPORT_CSP } from '../../src/core/html';

describe('HTML report', () => {
  it('builds a scan that writes HTML to a file', () => {
    const args = buildScanArgs({
      command: 'scan',
      targets: ['/w'],
      minSeverity: 'low',
      scanners: [],
      offlineEnrichment: false,
      extraArgs: ['-f', 'sarif', '--output=x', '--deep'],
      supported: new Set(['--quiet', '--no-ai']),
      format: 'html',
      output: '/tmp/nephilex-report-1/report.html',
    });
    assert.deepEqual(args, [
      'scan',
      '-f',
      'html',
      '-o',
      '/tmp/nephilex-report-1/report.html',
      '--quiet',
      '--no-ai',
      '--deep',
      '--',
      '/w',
    ]);
  });

  it('refuses HTML without an output file or with check', () => {
    const base = {
      targets: ['/w'],
      minSeverity: 'low' as const,
      scanners: [],
      offlineEnrichment: false,
      extraArgs: [],
      supported: new Set<string>(),
    };
    assert.throws(() => buildScanArgs({ ...base, command: 'scan', format: 'html' }));
    assert.throws(() => buildScanArgs({ ...base, command: 'check', format: 'html', output: '/o.html' }));
  });

  it('puts the CSP first in the head', () => {
    const out = prepareReportHtml('<!DOCTYPE html><html lang="en"><head><title>r</title></head><body>x</body></html>');
    assert.ok(out.startsWith('<!DOCTYPE html><html lang="en"><head><meta http-equiv="Content-Security-Policy"'));
    assert.ok(out.includes(REPORT_CSP));
    assert.match(REPORT_CSP, /default-src 'none'/);
    assert.doesNotMatch(REPORT_CSP, /script-src|unsafe-eval/);
  });

  it('adds a head when the report has none', () => {
    assert.match(prepareReportHtml('<html><body>x</body></html>'), /^<html><head><meta [^>]+><\/head><body>/);
    assert.match(prepareReportHtml('just text'), /^<!DOCTYPE html><html><head><meta [^>]+><\/head><body>just text/);
  });

  it('removes meta refresh and base elements', () => {
    const out = prepareReportHtml(
      '<html><head><META HTTP-EQUIV="refresh" content="0;url=https://evil.example"><base href="https://evil.example/"></head></html>',
    );
    assert.doesNotMatch(out, /refresh|<base/i);
  });
});
