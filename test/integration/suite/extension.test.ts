import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { parseReport } from '../../../src/core/report';
import type { NephilexApi } from '../../../src/extension';

const EXTENSION_ID = 'nephilex.nephilex';
const realCli = process.env['NEPHILEX_TEST_EXECUTABLE'] ?? '';
const workspace = process.env['NEPHILEX_TEST_WORKSPACE'] ?? '';
const fixtures = path.resolve(__dirname, '..', '..', '..', '..', 'test', 'fixtures');

async function api(): Promise<NephilexApi> {
  const ext = vscode.extensions.getExtension<NephilexApi>(EXTENSION_ID);
  assert.ok(ext, 'extension is installed');
  return ext.isActive ? ext.exports : ext.activate();
}

async function waitFor<T>(fn: () => T | undefined, timeoutMs = 90_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v !== undefined) {
      return v;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for condition.');
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

function nephilexDiagnostics(uri: vscode.Uri): vscode.Diagnostic[] {
  return vscode.languages.getDiagnostics(uri).filter((d) => d.source === 'Nephilex');
}

async function hoverText(uri: vscode.Uri, pos: vscode.Position): Promise<string> {
  const hovers = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', uri, pos);
  return hovers
    .flatMap((h) => h.contents)
    .map((c) => (c instanceof vscode.MarkdownString ? c.value : typeof c === 'string' ? c : ''))
    .join('\n');
}

/** Load a fixture report into the store for one workspace file, as a scan of that file would. */
async function loadFixture(fixture: string, file: string): Promise<vscode.TextDocument> {
  const report = parseReport(fs.readFileSync(path.join(fixtures, fixture), 'utf8'));
  const doc = await vscode.workspace.openTextDocument(path.join(workspace, file));
  const findings = report.findings.filter((f) => f.location.path === file);
  (await api()).store.set(doc.uri, findings, { lineCount: doc.lineCount, lineText: (i) => doc.lineAt(i).text }, (p) =>
    p === file ? doc.uri : undefined,
  );
  return doc;
}

describe('Nephilex extension', () => {
  it('activates and registers its commands', async () => {
    await api();
    const commands = await vscode.commands.getCommands(true);
    for (const id of [
      'nephilex.scanWorkspace',
      'nephilex.scanFile',
      'nephilex.scanResource',
      'nephilex.clearFindings',
      'nephilex.showProblems',
      'nephilex.showFindings',
      'nephilex.ignoreFinding',
      'nephilex.installCli',
      'nephilex.openHtmlReport',
      'nephilex.refresh',
      'nephilex.filterFindings',
      'nephilex.resetFilter',
      'nephilex.groupBySeverity',
      'nephilex.groupByFile',
      'nephilex.openFinding',
      'nephilex.ignoreFromView',
      'nephilex.copyRuleId',
      'nephilex.openRuleDocs',
    ]) {
      assert.ok(commands.includes(id), id);
    }
  });

  it('declares limited support for untrusted workspaces', () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    const pkg = ext?.packageJSON as { capabilities?: { untrustedWorkspaces?: { supported?: unknown } } };
    assert.equal(pkg.capabilities?.untrustedWorkspaces?.supported, 'limited');
  });

  it('contributes the Findings view and the walkthrough', () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    const pkg = ext?.packageJSON as {
      contributes?: { views?: Record<string, { id: string }[]>; walkthroughs?: { steps: unknown[] }[] };
    };
    assert.equal(pkg.contributes?.views?.['nephilex']?.[0]?.id, 'nephilex.findings');
    assert.equal(pkg.contributes?.walkthroughs?.[0]?.steps.length, 5);
  });

  it('shows evidence in the hover and as related information', async () => {
    const doc = await loadFixture('report-evidence.json', 'web.py');
    try {
      const sql = nephilexDiagnostics(doc.uri).find(
        (d) => typeof d.code === 'object' && d.code.value === 'ast-python.ast-sql-injection',
      );
      assert.ok(sql, 'SQL injection diagnostic');
      assert.match(sql.message, /^\[likely\] SQL injection/);
      const related = sql.relatedInformation ?? [];
      assert.deepEqual(
        related.map((r) => [r.location.range.start.line, r.message]),
        [
          [8, '1. source: request.args.get("id") is attacker-controlled'],
          [8, '2. step: assigned to uid'],
          [9, '3. step: assigned to query'],
          [12, '4. sink: passed to cur.execute'],
        ],
      );
      assert.ok(related.every((r) => r.location.uri.toString() === doc.uri.toString()));
      const text = await hoverText(doc.uri, new vscode.Position(12, 6));
      assert.match(text, /\*\*Evidence:\*\* `likely`/);
      assert.match(text, /\*\*Path\*\*/);
      assert.match(text, /\*\*How to verify\*\*/);
      assert.match(text, /Why it is vulnerable/);
      // The Findings view commands run against the same store.
      await vscode.commands.executeCommand('nephilex.showFindings');
      await vscode.commands.executeCommand('nephilex.groupByFile');
      await vscode.commands.executeCommand('nephilex.groupBySeverity');
    } finally {
      (await api()).store.clear();
    }
  });

  it('works as before when the report has no evidence', async () => {
    const doc = await loadFixture('report-scan.json', 'app.py');
    try {
      const diags = nephilexDiagnostics(doc.uri);
      assert.equal(diags.length, 5);
      for (const d of diags) {
        assert.doesNotMatch(d.message, /^\[/);
        assert.equal(d.relatedInformation, undefined);
      }
      const text = await hoverText(doc.uri, new vscode.Position(10, 12));
      assert.match(text, /Why it is vulnerable/);
      assert.doesNotMatch(text, /Evidence/);
    } finally {
      (await api()).store.clear();
    }
  });

  it('does not crash when the CLI is missing', async () => {
    const cfg = vscode.workspace.getConfiguration('nephilex');
    const missing = path.join(workspace || process.cwd(), 'no-such-dir', 'nephilex-missing.exe');
    await cfg.update('executablePath', missing, vscode.ConfigurationTarget.Global);
    try {
      const doc = await vscode.workspace.openTextDocument(path.join(workspace, 'app.py'));
      await vscode.window.showTextDocument(doc);
      await vscode.commands.executeCommand('nephilex.scanFile');
      assert.equal(nephilexDiagnostics(doc.uri).length, 0);
    } finally {
      await cfg.update('executablePath', undefined, vscode.ConfigurationTarget.Global);
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    }
  });

  (realCli ? describe : describe.skip)('with the real nephilex CLI', () => {
    let doc: vscode.TextDocument;

    before(async () => {
      await vscode.workspace
        .getConfiguration('nephilex')
        .update('executablePath', realCli, vscode.ConfigurationTarget.Global);
      await vscode.workspace.getConfiguration('nephilex').update('run', 'off', vscode.ConfigurationTarget.Global);
      doc = await vscode.workspace.openTextDocument(path.join(workspace, 'app.py'));
      await vscode.window.showTextDocument(doc);
      await vscode.commands.executeCommand('nephilex.scanFile');
      await waitFor(() => (nephilexDiagnostics(doc.uri).length ? true : undefined));
    });

    after(async () => {
      const cfg = vscode.workspace.getConfiguration('nephilex');
      await cfg.update('executablePath', undefined, vscode.ConfigurationTarget.Global);
      await cfg.update('run', undefined, vscode.ConfigurationTarget.Global);
    });

    it('publishes diagnostics with severity, rule id, docs link, and CWE', () => {
      const diags = nephilexDiagnostics(doc.uri);
      const yaml = diags.find((d) => typeof d.code === 'object' && d.code.value === 'patterns.python-yaml-load');
      assert.ok(yaml, 'yaml.load finding');
      assert.equal(yaml.severity, vscode.DiagnosticSeverity.Error);
      assert.equal(yaml.range.start.line, 10);
      assert.match(yaml.message, /CWE-502/);
      assert.ok(typeof yaml.code === 'object' && yaml.code.target.scheme === 'https');
      const md5 = diags.find((d) => typeof d.code === 'object' && d.code.value === 'patterns.weak-hash-md5-sha1');
      assert.equal(md5?.severity, vscode.DiagnosticSeverity.Warning);
    });

    it('shows a hover with the reasoning and fix guidance', async () => {
      const text = await hoverText(doc.uri, new vscode.Position(10, 12));
      assert.match(text, /Why it is vulnerable/);
      assert.match(text, /How to fix/);
    });

    it('offers the verified fix and the ignore action, and applies the fix', async () => {
      const yaml = nephilexDiagnostics(doc.uri).find(
        (d) => typeof d.code === 'object' && d.code.value === 'patterns.python-yaml-load',
      );
      assert.ok(yaml);
      const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
        'vscode.executeCodeActionProvider',
        doc.uri,
        yaml.range,
      );
      const titles = actions.map((a) => a.title);
      assert.ok(titles.includes('Apply Nephilex fix'), titles.join(', '));
      assert.ok(titles.some((t) => t.startsWith('Ignore patterns.python-yaml-load')));
      const fix = actions.find((a) => a.title === 'Apply Nephilex fix');
      assert.ok(fix?.edit);
      assert.ok(await vscode.workspace.applyEdit(fix.edit));
      assert.equal(doc.lineAt(10).text, '    return yaml.safe_load(s)');
      await vscode.commands.executeCommand('workbench.action.files.revert');
    });

    it('counts critical and high findings for the status bar', async () => {
      const store = (await api()).store;
      assert.ok(store.countCriticalHigh() >= 3, String(store.countCriticalHigh()));
    });

    it('scans the workspace', async () => {
      const store = (await api()).store;
      store.clear();
      await vscode.commands.executeCommand('nephilex.scanWorkspace');
      assert.ok(nephilexDiagnostics(doc.uri).length >= 4);
    });

    it('scans a folder picked in the Explorer and runs it again on Refresh', async () => {
      const store = (await api()).store;
      store.clear();
      const folder = vscode.Uri.file(workspace);
      await vscode.commands.executeCommand('nephilex.scanResource', folder, [folder]);
      assert.ok(nephilexDiagnostics(doc.uri).length >= 4);
      store.clear();
      await vscode.commands.executeCommand('nephilex.refresh');
      assert.ok(nephilexDiagnostics(doc.uri).length >= 4);
    });

    it('opens the HTML report in a webview', async () => {
      await vscode.commands.executeCommand('nephilex.openHtmlReport');
      const tab = await waitFor(() =>
        vscode.window.tabGroups.all
          .flatMap((g) => g.tabs)
          .find((t) => t.input instanceof vscode.TabInputWebview && t.label.startsWith('Nephilex Report')),
      );
      await vscode.window.tabGroups.close(tab);
    });
  });
});
