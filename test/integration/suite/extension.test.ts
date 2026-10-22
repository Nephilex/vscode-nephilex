import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { ArgusApi } from '../../../src/extension';

const EXTENSION_ID = 'argus-codesecurity.argus-security';
const realCli = process.env['ARGUS_TEST_EXECUTABLE'] ?? '';
const workspace = process.env['ARGUS_TEST_WORKSPACE'] ?? '';

async function api(): Promise<ArgusApi> {
  const ext = vscode.extensions.getExtension<ArgusApi>(EXTENSION_ID);
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

function argusDiagnostics(uri: vscode.Uri): vscode.Diagnostic[] {
  return vscode.languages.getDiagnostics(uri).filter((d) => d.source === 'Argus');
}

describe('Argus extension', () => {
  it('activates and registers its commands', async () => {
    await api();
    const commands = await vscode.commands.getCommands(true);
    for (const id of [
      'argus.scanWorkspace',
      'argus.scanFile',
      'argus.clearFindings',
      'argus.showProblems',
      'argus.ignoreFinding',
    ]) {
      assert.ok(commands.includes(id), id);
    }
  });

  it('declares limited support for untrusted workspaces', () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    const pkg = ext?.packageJSON as { capabilities?: { untrustedWorkspaces?: { supported?: unknown } } };
    assert.equal(pkg.capabilities?.untrustedWorkspaces?.supported, 'limited');
  });

  it('does not crash when the CLI is missing', async () => {
    const cfg = vscode.workspace.getConfiguration('argus');
    const missing = path.join(workspace || process.cwd(), 'no-such-dir', 'argus-missing.exe');
    await cfg.update('executablePath', missing, vscode.ConfigurationTarget.Global);
    try {
      const doc = await vscode.workspace.openTextDocument(path.join(workspace, 'app.py'));
      await vscode.window.showTextDocument(doc);
      await vscode.commands.executeCommand('argus.scanFile');
      assert.equal(argusDiagnostics(doc.uri).length, 0);
    } finally {
      await cfg.update('executablePath', undefined, vscode.ConfigurationTarget.Global);
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    }
  });

  (realCli ? describe : describe.skip)('with the real argus CLI', () => {
    let doc: vscode.TextDocument;

    before(async () => {
      await vscode.workspace
        .getConfiguration('argus')
        .update('executablePath', realCli, vscode.ConfigurationTarget.Global);
      await vscode.workspace.getConfiguration('argus').update('run', 'off', vscode.ConfigurationTarget.Global);
      doc = await vscode.workspace.openTextDocument(path.join(workspace, 'app.py'));
      await vscode.window.showTextDocument(doc);
      await vscode.commands.executeCommand('argus.scanFile');
      await waitFor(() => (argusDiagnostics(doc.uri).length ? true : undefined));
    });

    after(async () => {
      const cfg = vscode.workspace.getConfiguration('argus');
      await cfg.update('executablePath', undefined, vscode.ConfigurationTarget.Global);
      await cfg.update('run', undefined, vscode.ConfigurationTarget.Global);
    });

    it('publishes diagnostics with severity, rule id, docs link, and CWE', () => {
      const diags = argusDiagnostics(doc.uri);
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
      const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
        'vscode.executeHoverProvider',
        doc.uri,
        new vscode.Position(10, 12),
      );
      const text = hovers
        .flatMap((h) => h.contents)
        .map((c) => (c instanceof vscode.MarkdownString ? c.value : typeof c === 'string' ? c : ''))
        .join('\n');
      assert.match(text, /Why it is vulnerable/);
      assert.match(text, /How to fix/);
    });

    it('offers the verified fix and the ignore action, and applies the fix', async () => {
      const yaml = argusDiagnostics(doc.uri).find(
        (d) => typeof d.code === 'object' && d.code.value === 'patterns.python-yaml-load',
      );
      assert.ok(yaml);
      const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
        'vscode.executeCodeActionProvider',
        doc.uri,
        yaml.range,
      );
      const titles = actions.map((a) => a.title);
      assert.ok(titles.includes('Apply Argus fix'), titles.join(', '));
      assert.ok(titles.some((t) => t.startsWith('Ignore patterns.python-yaml-load')));
      const fix = actions.find((a) => a.title === 'Apply Argus fix');
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
      await vscode.commands.executeCommand('argus.scanWorkspace');
      assert.ok(argusDiagnostics(doc.uri).length >= 4);
    });
  });
});
