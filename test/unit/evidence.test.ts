import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  evidenceHoverParts,
  gradePrefix,
  HoverPart,
  parseEvidence,
  parseGrade,
  relatedSteps,
  resolveStepPath,
  safeInline,
} from '../../src/core/evidence';
import { diagnosticMessage } from '../../src/core/mapping';
import { NephilexFinding, parseFinding, parseReport } from '../../src/core/report';

const fixtures = path.join(__dirname, '..', '..', '..', 'test', 'fixtures');
const withEvidence = parseReport(fs.readFileSync(path.join(fixtures, 'report-evidence.json'), 'utf8'));
const withoutEvidence = parseReport(fs.readFileSync(path.join(fixtures, 'report-scan.json'), 'utf8'));

function byRule(rule: string): NephilexFinding {
  const f = withEvidence.findings.find((x) => x.ruleId === rule);
  assert.ok(f, rule);
  return f;
}

// Built from code points so this source file stays ASCII.
const RLO = String.fromCodePoint(0x202e);
const LRI = String.fromCodePoint(0x2066);
const ZWSP = String.fromCodePoint(0x200b);
const BOM = String.fromCodePoint(0xfeff);
const NUL = String.fromCodePoint(0);
const ESC = String.fromCodePoint(0x1b);
const C1 = String.fromCodePoint(0x9b);
const LS = String.fromCodePoint(0x2028);

const UNSAFE = new RegExp(
  '[' +
    [
      [0x00, 0x1f],
      [0x7f, 0x9f],
      [0x200b, 0x200f],
      [0x2028, 0x202e],
      [0x2060, 0x2069],
    ]
      .map(([a, b]) => `\\u${a!.toString(16).padStart(4, '0')}-\\u${b!.toString(16).padStart(4, '0')}`)
      .join('') +
    '\\u061c\\ufeff]',
);

function texts(parts: HoverPart[]): string[] {
  return parts.flatMap((p) => ('text' in p ? [p.text] : []));
}

function markdown(parts: HoverPart[]): string {
  return parts.map((p) => ('markdown' in p ? p.markdown : '')).join('');
}

describe('evidence parsing', () => {
  it('reads the evidence block of a real report', () => {
    assert.equal(withEvidence.skipped, 0);
    assert.ok(withEvidence.findings.every((f) => f.evidence !== undefined));
    const sql = byRule('ast-python.ast-sql-injection');
    const ev = sql.evidence;
    assert.ok(ev);
    assert.equal(ev.grade, 'likely');
    assert.match(ev.basis, /Request data reaches the SQL call/);
    assert.deepEqual(
      ev.path.map((s) => [s.path, s.line, s.role]),
      [
        ['web.py', 9, 'source'],
        ['web.py', 9, 'step'],
        ['web.py', 10, 'step'],
        ['web.py', 13, 'sink'],
      ],
    );
    assert.equal(ev.path[0]?.column, 11);
    assert.equal(ev.path[3]?.note, 'passed to cur.execute');
    assert.equal(ev.verify.length, 4);
  });

  it('leaves evidence undefined for reports without it (CLI 0.11.0 and older)', () => {
    assert.equal(withoutEvidence.findings.length, 5);
    for (const f of withoutEvidence.findings) {
      assert.equal(f.evidence, undefined);
      assert.doesNotMatch(diagnosticMessage(f), /^\[/);
      assert.deepEqual(evidenceHoverParts(f.evidence), []);
      assert.deepEqual(relatedSteps(f.evidence, f.location.startLine), []);
      assert.equal(gradePrefix(f.evidence), '');
    }
  });

  it('never throws on malformed evidence', () => {
    for (const bad of [null, 1, 'likely', [], true, {}, { path: 'x' }, { path: [null, 3, 'x', {}] }, { verify: {} }]) {
      assert.equal(parseEvidence(bad), undefined, JSON.stringify(bad));
      const f = parseFinding({ rule_id: 'r', severity: 2, location: { path: 'a.py' }, evidence: bad });
      assert.ok(f, 'the finding itself is kept');
    }
  });

  it('keeps usable parts and normalizes unknown values', () => {
    const ev = parseEvidence({
      grade: 'proven',
      basis: 42,
      path: [{ path: 'a.py', line: 0, column: -2, role: 'teleport', code: 7, note: 'n' }],
      verify: ['one', '', '  ', 3, 'two'],
    });
    assert.ok(ev);
    assert.equal(ev.grade, undefined);
    assert.equal(ev.basis, '');
    assert.deepEqual(ev.path, [
      { path: 'a.py', line: undefined, column: undefined, role: 'step', code: '', note: 'n' },
    ]);
    assert.deepEqual(ev.verify, ['one', 'two']);
    assert.equal(parseGrade(' Confirmed '), 'confirmed');
    assert.equal(parseGrade('LIKELY'), 'likely');
  });

  it('caps the number and length of steps', () => {
    const ev = parseEvidence({
      grade: 'possible',
      path: Array.from({ length: 500 }, (_, i) => ({ path: 'a.py', line: i + 1, note: 'x'.repeat(50_000) })),
      verify: Array.from({ length: 50 }, () => 'y'.repeat(50_000)),
    });
    assert.ok(ev);
    assert.ok(ev.path.length <= 32);
    assert.ok(ev.verify.length <= 8);
    assert.ok(ev.path.every((s) => s.note.length <= 1003));
    assert.ok(ev.verify.every((s) => s.length <= 1003));
  });
});

describe('hostile evidence text', () => {
  const hostile =
    `<img src=x onerror=alert(1)> [click](command:workbench.action.terminal.new) ${RLO}gnp.exe${LRI}` +
    `${ZWSP}${BOM}${NUL}${ESC}[31m${C1}\r\nnext${LS}line **bold** \`code\` $(gear)`;

  const ev = parseEvidence({
    grade: 'likely',
    basis: hostile,
    path: [
      { path: `evil${RLO}.py`, line: 3, role: 'source', code: hostile, note: hostile },
      { path: 'a.py', role: 'elided', note: hostile },
      { path: 'a.py', line: 5, role: 'sink', note: '' },
    ],
    verify: [hostile],
  });

  it('removes control, bidirectional, and zero-width characters and flattens lines', () => {
    assert.ok(ev);
    for (const s of [ev.basis, ev.verify[0]!, ev.path[0]!.note, ev.path[0]!.code]) {
      assert.doesNotMatch(s, UNSAFE);
      assert.ok(s.includes('<U+202E>'), s);
      assert.ok(s.includes('<U+200B>'));
      assert.ok(s.includes('<U+0000>'));
      assert.ok(s.includes('<U+001B>'));
      assert.ok(s.includes('<U+009B>'));
      assert.ok(!s.includes('\n') && !s.includes('\r'));
    }
    assert.equal(safeInline(`a\t\t b\n\nc${LS}d`), 'a b c d');
  });

  it('emits report text only as text parts, never as Markdown', () => {
    assert.ok(ev);
    const parts = evidenceHoverParts(ev);
    const md = markdown(parts);
    // Markdown parts are fixed strings: headings, list numbers, and the grade.
    assert.doesNotMatch(md, /img|command:|onerror|gear|evil|bold|next/);
    assert.match(md, /\*\*Evidence:\*\* `likely`/);
    assert.match(md, /\*\*Path\*\*/);
    assert.match(md, /\*\*How to verify\*\*/);
    for (const t of texts(parts)) {
      assert.doesNotMatch(t, UNSAFE);
      assert.ok(!t.includes('\n'));
    }
    assert.ok(texts(parts).some((t) => t.startsWith('evil<U+202E>.py:3 source')));
  });

  it('numbers located steps and lists elided markers without a number', () => {
    assert.ok(ev);
    const parts = evidenceHoverParts(ev);
    const md = markdown(parts);
    assert.match(md, /\n\n\*\*Path\*\*\n\n1\. .*\n- .*\n2\. /s);
    assert.ok(texts(parts).includes('a.py:5 sink'));
  });

  it('does not show a grade badge for an unknown grade', () => {
    const parts = evidenceHoverParts(parseEvidence({ grade: '<b>x</b>', basis: 'b' }));
    assert.equal(markdown(parts).includes('`'), false);
    assert.ok(markdown(parts).includes('**Evidence**'));
  });
});

describe('evidence in diagnostics', () => {
  it('prefixes the message with the grade', () => {
    assert.match(diagnosticMessage(byRule('ast-python.ast-sql-injection')), /^\[likely\] SQL injection/);
    assert.match(diagnosticMessage(byRule('patterns.python-yaml-load')), /^\[possible\] Unsafe yaml.load/);
  });

  it('lists each located step as related information', () => {
    const sql = byRule('ast-python.ast-sql-injection');
    assert.deepEqual(relatedSteps(sql.evidence, sql.location.startLine), [
      { path: 'web.py', line: 9, column: 11, message: '1. source: request.args.get("id") is attacker-controlled' },
      { path: 'web.py', line: 9, column: 5, message: '2. step: assigned to uid' },
      { path: 'web.py', line: 10, column: 5, message: '3. step: assigned to query' },
      { path: 'web.py', line: 13, column: 5, message: '4. sink: passed to cur.execute' },
    ]);
  });

  it('adds nothing for a path that is only the finding line', () => {
    const yaml = byRule('patterns.python-yaml-load');
    assert.deepEqual(relatedSteps(yaml.evidence, yaml.location.startLine), []);
  });

  it('skips elided markers and steps without a line', () => {
    const ev = parseEvidence({
      path: [
        { path: 'a.py', line: 1, role: 'source', note: 's' },
        { path: 'a.py', role: 'elided', note: '4 intermediate step(s) left out' },
        { path: 'b.py', role: 'step', note: 'no line' },
        { path: 'a.py', line: 9, role: 'sink', note: '' },
      ],
    });
    assert.deepEqual(
      relatedSteps(ev, 9).map((r) => r.message),
      ['1. source: s', '2. sink'],
    );
  });
});

describe('evidence step paths', () => {
  const win = process.platform === 'win32';
  const ws = path.resolve(win ? 'C:\\work\\repo' : '/work/repo');
  const tmp = path.resolve(win ? 'C:\\tmp\\nephilex-vscode-1' : '/tmp/nephilex-vscode-1');

  it('maps steps inside the scanned folder to editor paths', () => {
    const ctx = { roots: [ws], folder: { real: ws, local: ws } };
    assert.equal(resolveStepPath('src/web.py', ctx), path.join(ws, 'src', 'web.py'));
    assert.equal(resolveStepPath(path.join(ws, 'x.py'), ctx), path.join(ws, 'x.py'));
  });

  it('never links files outside the scanned folder', () => {
    const ctx = { roots: [ws], folder: { real: ws, local: ws } };
    assert.equal(resolveStepPath('../outside.py', ctx), undefined);
    assert.equal(resolveStepPath(path.resolve(win ? 'C:\\Windows\\win.ini' : '/etc/passwd'), ctx), undefined);
  });

  it('maps the temporary copy of a file back to the document', () => {
    const local = path.join(ws, 'app.py');
    const ctx = { roots: [tmp], file: { real: path.join(tmp, 'app.py'), local } };
    assert.equal(resolveStepPath('app.py', ctx), local);
    assert.equal(resolveStepPath('other.py', ctx), undefined);
  });
});
