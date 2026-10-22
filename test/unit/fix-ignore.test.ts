import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { computeFix, hasVerifiedFix, parseSingleHunk } from '../../src/core/fix';
import {
  buildAllowEntry,
  buildIgnoreSuffix,
  commentStyleFor,
  lineHasIgnore,
  validateReason,
} from '../../src/core/ignore';
import { LineSource } from '../../src/core/mapping';
import { ArgusFinding, parseReport } from '../../src/core/report';

const root = path.join(__dirname, '..', '..', '..', 'test', 'fixtures');
const report = parseReport(fs.readFileSync(path.join(root, 'report-scan.json'), 'utf8'));
const source = fs.readFileSync(path.join(root, 'workspace', 'app.py'), 'utf8').split(/\r?\n/);

function doc(l: string[]): LineSource {
  return { lineCount: l.length, lineText: (i) => l[i] ?? '' };
}

function byRule(rule: string): ArgusFinding {
  const f = report.findings.find((x) => x.ruleId === rule);
  assert.ok(f, rule);
  return f;
}

describe('verified fixes', () => {
  it('parses a single-hunk diff', () => {
    assert.deepEqual(parseSingleHunk('--- a/x\n+++ b/x\n@@ -4 +4 @@\n-a(1)\n+b(1)\n'), {
      oldStart: 4,
      removed: ['a(1)'],
      added: ['b(1)'],
    });
  });

  it('rejects multi-hunk, context, and unbalanced diffs', () => {
    assert.equal(parseSingleHunk('@@ -1 +1 @@\n-a\n+b\n@@ -5 +5 @@\n-c\n+d\n'), undefined);
    assert.equal(parseSingleHunk('@@ -1,2 +1,2 @@\n x\n-a\n+b\n'), undefined);
    assert.equal(parseSingleHunk('@@ -1 +1 @@\n-a\n'), undefined);
    assert.equal(parseSingleHunk('garbage'), undefined);
  });

  it('applies the deterministic fix and keeps indentation', () => {
    const f = byRule('patterns.python-yaml-load');
    assert.equal(hasVerifiedFix(f), true);
    assert.deepEqual(computeFix(f, doc(source)), [{ line: 10, newText: '    return yaml.safe_load(s)' }]);
  });

  it('does not apply a fix to code that changed since the scan', () => {
    const f = byRule('patterns.python-shell-true');
    const edited = [...source];
    edited[3] = '    subprocess.run(cmd, shell=True, check=True)';
    assert.equal(computeFix(f, doc(edited)), undefined);
  });

  it('never offers unverified or machine-proposed patches', () => {
    const f = byRule('patterns.weak-hash-md5-sha1');
    assert.ok(f.remediation);
    assert.equal(hasVerifiedFix({ ...f, remediation: { ...f.remediation, verified: false } }), false);
    assert.equal(hasVerifiedFix({ ...f, patchSource: 'ai-proposed' }), false);
    assert.equal(hasVerifiedFix(byRule('secrets.aws-access-key-id')), false);
  });
});

describe('argus-ignore comments', () => {
  it('picks a comment style the CLI recognizes', () => {
    assert.equal(commentStyleFor('python'), '#');
    assert.equal(commentStyleFor('yaml'), '#');
    assert.equal(commentStyleFor('typescript'), '//');
    assert.equal(commentStyleFor('go'), '//');
    assert.equal(commentStyleFor('json'), undefined);
    assert.equal(commentStyleFor('html'), undefined);
  });

  it('builds a comment matching the engine pattern', () => {
    const suffix = buildIgnoreSuffix('#', 'patterns.python-shell-true', ' command is a constant ');
    assert.equal(suffix, '  # argus-ignore: patterns.python-shell-true reason="command is a constant"');
    // Same expression as _INLINE_IGNORE in argus/core/engine.py.
    const engine =
      /(?:#|\/\/)\s*argus-ignore(?::\s*(?<rule>[A-Za-z0-9_.-]+))?[^\n]*?reason\s*=\s*['"](?<reason>[^'"]+)['"]/;
    const m = engine.exec('subprocess.run(cmd, shell=True)' + suffix);
    assert.equal(m?.groups?.['rule'], 'patterns.python-shell-true');
    assert.equal(m?.groups?.['reason'], 'command is a constant');
    assert.equal(lineHasIgnore('x = 1' + suffix), true);
    assert.equal(lineHasIgnore('x = 1 # ok'), false);
  });

  it('requires a usable reason', () => {
    assert.ok(validateReason(''));
    assert.ok(validateReason('  a '));
    assert.ok(validateReason('has "quotes"'));
    assert.ok(validateReason("it's"));
    assert.ok(validateReason('two\nlines'));
    assert.ok(validateReason('tab\there'));
    assert.ok(validateReason('x'.repeat(201)));
    assert.equal(validateReason('input is validated upstream'), undefined);
    assert.throws(() => buildIgnoreSuffix('//', 'rule', ''));
    assert.throws(() => buildIgnoreSuffix('//', 'bad rule"', 'fine reason'));
  });

  it('builds a quoted .argus.yml allow entry', () => {
    assert.equal(
      buildAllowEntry('secrets.generic', 'config\\app.json', 'test fixture'),
      'allow:\n  - rule: "secrets.generic"\n    path: "config/app.json"\n    reason: "test fixture"\n',
    );
  });
});
