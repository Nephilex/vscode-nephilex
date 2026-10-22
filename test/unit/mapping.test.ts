import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import {
  computeRange,
  DEFAULT_DOCS_URL,
  diagnosticLevel,
  diagnosticMessage,
  docsUrl,
  isInside,
  LineSource,
  resolveFindingPath,
  safeHttpsUrl,
  samePath,
  severityAtLeast,
} from '../../src/core/mapping';
import { NephilexFinding } from '../../src/core/report';

function lines(...l: string[]): LineSource {
  return { lineCount: l.length, lineText: (i) => l[i] ?? '' };
}

function finding(over: Partial<NephilexFinding> = {}): NephilexFinding {
  return {
    id: 'x',
    ruleId: 'patterns.python-yaml-load',
    scanner: 'patterns',
    title: 'Unsafe yaml.load',
    description: 'd',
    location: { path: 'app.py', startLine: 2 },
    severity: 3,
    cwe: ['CWE-502'],
    owasp: ['A08:2021-Software and Data Integrity Failures'],
    whyVulnerable: '',
    attackerPerspective: '',
    businessImpact: '',
    ...over,
  };
}

describe('severity mapping', () => {
  it('maps critical and high to error, medium to warning, low and info to information', () => {
    assert.equal(diagnosticLevel(4), 'error');
    assert.equal(diagnosticLevel(3), 'error');
    assert.equal(diagnosticLevel(2), 'warning');
    assert.equal(diagnosticLevel(1), 'information');
    assert.equal(diagnosticLevel(0), 'information');
  });

  it('applies the minimum severity', () => {
    assert.equal(severityAtLeast(2, 'medium'), true);
    assert.equal(severityAtLeast(1, 'medium'), false);
    assert.equal(severityAtLeast(0, 'info'), true);
  });
});

describe('diagnostic message', () => {
  it('includes CWE and OWASP', () => {
    assert.equal(
      diagnosticMessage(finding()),
      'Unsafe yaml.load (CWE-502; OWASP A08:2021-Software and Data Integrity Failures)',
    );
  });

  it('omits the taxonomy when there is none and flattens whitespace', () => {
    assert.equal(diagnosticMessage(finding({ title: 'a\n  b', cwe: [], owasp: [] })), 'a b');
  });
});

describe('docs links', () => {
  it('accepts only https URLs', () => {
    assert.equal(safeHttpsUrl('https://example.com/a'), 'https://example.com/a');
    assert.equal(safeHttpsUrl('http://example.com'), undefined);
    assert.equal(safeHttpsUrl('command:workbench.action.terminal.new'), undefined);
    assert.equal(safeHttpsUrl('javascript:alert(1)'), undefined);
    assert.equal(safeHttpsUrl('not a url'), undefined);
  });

  it('falls back to the scanner docs', () => {
    assert.equal(docsUrl(finding({ docsUrl: 'file:///etc/passwd' })), DEFAULT_DOCS_URL);
    assert.equal(docsUrl(finding({ docsUrl: 'https://docs.example/x#y' })), 'https://docs.example/x#y');
  });
});

describe('computeRange', () => {
  const doc = lines('import yaml', '    return yaml.load(s)   ', '');

  it('covers the trimmed line when there are no columns', () => {
    assert.deepEqual(computeRange({ path: 'a', startLine: 2 }, doc), {
      startLine: 1,
      startCharacter: 4,
      endLine: 1,
      endCharacter: 23,
    });
  });

  it('uses 1-based columns when present', () => {
    assert.deepEqual(computeRange({ path: 'a', startLine: 2, startColumn: 12, endColumn: 21 }, doc), {
      startLine: 1,
      startCharacter: 11,
      endLine: 1,
      endCharacter: 20,
    });
  });

  it('maps file-level findings to the first line', () => {
    assert.equal(computeRange({ path: 'a' }, doc).startLine, 0);
  });

  it('clamps lines past the end of the document', () => {
    const r = computeRange({ path: 'a', startLine: 99 }, doc);
    assert.equal(r.startLine, 2);
    assert.equal(r.endLine, 2);
  });

  it('spans multiple lines', () => {
    const r = computeRange({ path: 'a', startLine: 1, endLine: 2 }, doc);
    assert.deepEqual(r, { startLine: 0, startCharacter: 0, endLine: 1, endCharacter: 23 });
  });
});

describe('paths', () => {
  const root = path.resolve('/work/project');

  it('resolves relative finding paths against the scan root', () => {
    assert.equal(resolveFindingPath('src/a.py', root), path.join(root, 'src', 'a.py'));
    assert.equal(resolveFindingPath(path.join(root, 'b.py'), '/elsewhere'), path.join(root, 'b.py'));
  });

  it('detects containment without prefix confusion', () => {
    assert.equal(isInside(path.join(root, 'x', 'nephilex.exe'), root), true);
    assert.equal(isInside(root, root), true);
    assert.equal(isInside(root + '-other', root), false);
    assert.equal(isInside(path.resolve('/work'), root), false);
    assert.equal(isInside(path.join(root, '..foo', 'x'), root), true);
  });

  it('compares case-insensitively on Windows', () => {
    if (process.platform === 'win32') {
      assert.equal(samePath('C:\\A\\b.py', 'c:\\a\\B.PY'), true);
    }
    assert.equal(samePath('/a/b.py', '/a/b.py', 'linux'), true);
  });
});
