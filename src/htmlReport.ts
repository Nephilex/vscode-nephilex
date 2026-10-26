/**
 * "Open HTML Report": runs `nephilex scan FOLDER -f html -o <temp file>` for
 * the folder scanned last (or a workspace folder the user picks) and shows
 * the result in a webview with scripts disabled and a strict Content
 * Security Policy (see core/html.ts). The temporary file is deleted once read.
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { buildScanArgs } from './core/cli';
import { prepareReportHtml } from './core/html';
import { RunError } from './core/process';
import { NephilexCli } from './nephilexCli';
import { FolderTarget, folderTarget, ScanController } from './scanController';
import { readSettings } from './settings';

async function pickFolder(scanner: ScanController): Promise<FolderTarget | undefined> {
  const last = scanner.lastTarget;
  if (last?.kind === 'folder') {
    return folderTarget(last.uri);
  }
  if (last?.kind === 'file') {
    const root = vscode.workspace.getWorkspaceFolder(last.uri);
    if (root?.uri.scheme === 'file') {
      return folderTarget(root.uri);
    }
  }
  const folders = (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === 'file');
  if (folders.length <= 1) {
    return folders[0] ? folderTarget(folders[0].uri) : undefined;
  }
  const pick = await vscode.window.showWorkspaceFolderPick({ placeHolder: 'Folder to report on' });
  return pick?.uri.scheme === 'file' ? folderTarget(pick.uri) : undefined;
}

export async function openHtmlReport(cli: NephilexCli, scanner: ScanController, log: vscode.LogOutputChannel) {
  const settings = readSettings();
  const prepared = await scanner.prepare(settings, true);
  if (!prepared) {
    return;
  }
  const target = await pickFolder(scanner);
  if (!target) {
    void vscode.window.showInformationMessage('Open a folder to create a Nephilex HTML report.');
    return;
  }
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nephilex-report-'));
  const output = path.join(tmpDir, 'nephilex-report.html');
  let html: string | undefined;
  try {
    const args = buildScanArgs({
      command: 'scan',
      format: 'html',
      output,
      targets: [target.path],
      minSeverity: settings.minSeverity,
      scanners: settings.scanners,
      offlineEnrichment: settings.offlineEnrichment,
      extraArgs: settings.extraArgs,
      configPath: target.configPath,
      supported: prepared.caps.scanOptions,
    });
    html = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Nephilex', cancellable: true },
      async (progress, token) => {
        progress.report({ message: `Creating the HTML report for ${target.name}...` });
        const abort = new AbortController();
        token.onCancellationRequested(() => abort.abort());
        const result = await cli.run(
          prepared,
          args,
          target.path,
          settings.workspaceTimeoutMs,
          settings.maxOutputBytes,
          abort.signal,
        );
        const st = await fs.stat(output).catch(() => undefined);
        if (!st?.isFile()) {
          const tail = result.stderr.trim().split(/\r?\n/).slice(-3).join(' ');
          throw new Error(`Nephilex wrote no HTML report (exit code ${String(result.exitCode)}). ${tail}`.trim());
        }
        if (st.size > settings.maxOutputBytes) {
          throw new Error(`The HTML report is larger than ${Math.round(settings.maxOutputBytes / (1024 * 1024))} MB.`);
        }
        return fs.readFile(output, 'utf8');
      },
    );
  } catch (err) {
    if (err instanceof RunError && err.kind === 'cancelled') {
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    log.error(`HTML report for ${target.path} failed: ${message}`);
    void vscode.window.showErrorMessage(`Nephilex could not create the HTML report: ${message.split('\n')[0]}`);
    return;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
  const panel = vscode.window.createWebviewPanel(
    'nephilex.report',
    `Nephilex Report: ${target.name}`,
    vscode.ViewColumn.Active,
    { enableScripts: false, enableForms: false, enableCommandUris: false, localResourceRoots: [] },
  );
  panel.webview.html = prepareReportHtml(html);
}
