import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { NephilexCli, PrepareResult, PreparedCli } from './nephilexCli';
import { buildScanArgs, sanitizeExtraArgs } from './core/cli';
import { resolveStepPath, StepPathContext } from './core/evidence';
import { isInside, resolveFindingPath, samePath, severityAtLeast } from './core/mapping';
import { RunError } from './core/process';
import { NephilexFinding, NephilexReport, parseReport, ReportParseError } from './core/report';
import { documentLines, FindingStore, StepResolver, StoredFinding, textLines, toDiagnostic } from './findingStore';
import { NephilexSettings, readSettings } from './settings';

export type CliProblem = Extract<PrepareResult, { ok: false }>;

/** Files larger than this are not scanned on save or on type. */
const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
const CONFIG_FILES = ['.nephilex.yml', '.nephilex.yaml'];

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function findConfig(folder: string | undefined): Promise<string | undefined> {
  if (!folder) {
    return undefined;
  }
  for (const name of CONFIG_FILES) {
    const p = path.join(folder, name);
    if (await exists(p)) {
      return p;
    }
  }
  return undefined;
}

/** Canonical path (long form on Windows, symlinks resolved); the input when that fails. */
async function canonical(p: string): Promise<string> {
  try {
    return await fs.realpath(p);
  } catch {
    return p;
  }
}

/** The directory Nephilex reports paths relative to. */
async function reportRoot(report: NephilexReport, fallback: string): Promise<string> {
  const t = report.target;
  if (!t || !path.isAbsolute(t)) {
    return fallback;
  }
  try {
    const st = await fs.stat(t);
    return st.isFile() ? path.dirname(t) : t;
  } catch {
    return fallback;
  }
}

export class ScanController implements vscode.Disposable {
  private readonly inFlight = new Map<string, AbortController>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private workspaceScan?: AbortController;
  private busy = 0;
  private readonly busyChanged = new vscode.EventEmitter<boolean>();
  readonly onDidChangeBusy = this.busyChanged.event;

  constructor(
    private readonly cli: NephilexCli,
    private readonly store: FindingStore,
    private readonly log: vscode.LogOutputChannel,
    private readonly onCliProblem: (problem: CliProblem, explicit: boolean) => void,
  ) {}

  get isBusy(): boolean {
    return this.busy > 0;
  }

  private setBusy(delta: number): void {
    const was = this.busy > 0;
    this.busy += delta;
    if (was !== this.busy > 0) {
      this.busyChanged.fire(this.busy > 0);
    }
  }

  /** Debounced scan of unsaved content (nephilex.run = onType). */
  scheduleOnType(doc: vscode.TextDocument, delayMs: number): void {
    const key = doc.uri.toString();
    const existing = this.timers.get(key);
    if (existing) {
      clearTimeout(existing);
    }
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        void this.scanDocument(doc, false);
      }, delayMs),
    );
  }

  cancel(uri: vscode.Uri): void {
    const key = uri.toString();
    const t = this.timers.get(key);
    if (t) {
      clearTimeout(t);
      this.timers.delete(key);
    }
    this.inFlight.get(key)?.abort();
    this.inFlight.delete(key);
  }

  private async prepare(settings: NephilexSettings, explicit: boolean): Promise<PreparedCli | undefined> {
    const prep = await this.cli.prepare(settings);
    if (!prep.ok) {
      this.onCliProblem(prep, explicit);
      return undefined;
    }
    const { dropped } = sanitizeExtraArgs(settings.extraArgs);
    if (dropped.length) {
      this.log.warn(`Ignoring managed flags in nephilex.extraArgs: ${dropped.join(' ')}`);
    }
    return prep.cli;
  }

  /**
   * Scan one document. Saved files are passed by path to `nephilex check` when
   * the CLI has it. Unsaved content, and every file when only `nephilex scan` is
   * available (which scans a file's whole directory), is written to a private
   * temporary directory first, so the CLI never receives content on its
   * command line.
   */
  async scanDocument(doc: vscode.TextDocument, explicit: boolean): Promise<void> {
    if (doc.uri.scheme !== 'file' || doc.isClosed) {
      if (explicit) {
        void vscode.window.showInformationMessage('Nephilex can only scan files on disk.');
      }
      return;
    }
    const text = doc.getText();
    if (Buffer.byteLength(text, 'utf8') > MAX_DOCUMENT_BYTES) {
      this.log.info(`Skipping ${doc.uri.fsPath}: larger than ${MAX_DOCUMENT_BYTES / (1024 * 1024)} MB.`);
      return;
    }
    const settings = readSettings();
    const cli = await this.prepare(settings, explicit);
    if (!cli) {
      return;
    }
    const key = doc.uri.toString();
    this.inFlight.get(key)?.abort();
    const abort = new AbortController();
    this.inFlight.set(key, abort);

    const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
    const cwd = folder?.uri.scheme === 'file' ? folder.uri.fsPath : path.dirname(doc.uri.fsPath);
    const useCheck = cli.caps.hasCheck;
    const useTemp = doc.isDirty || !useCheck;
    let tmpDir: string | undefined;
    this.setBusy(1);
    try {
      let target = doc.uri.fsPath;
      let configPath: string | undefined;
      if (useTemp) {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nephilex-vscode-'));
        target = path.join(tmpDir, path.basename(doc.uri.fsPath));
        await fs.writeFile(target, text, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        configPath = await findConfig(folder?.uri.fsPath);
      }
      const args = buildScanArgs({
        command: useCheck ? 'check' : 'scan',
        targets: [target],
        minSeverity: settings.minSeverity,
        scanners: settings.scanners,
        offlineEnrichment: settings.offlineEnrichment,
        extraArgs: settings.extraArgs,
        configPath,
        supported: useCheck ? cli.caps.checkOptions : cli.caps.scanOptions,
      });
      const result = await this.cli.run(cli, args, cwd, settings.timeoutMs, settings.maxOutputBytes, abort.signal);
      const report = this.parse(result.stdout, result.stderr, result.exitCode);
      const realTarget = await canonical(target);
      const realCwd = await canonical(cwd);
      const root = await reportRoot(report, path.dirname(realTarget));
      const mine = report.findings.filter((f) => {
        const p = f.location.path;
        return (
          samePath(resolveFindingPath(p, root), realTarget) || samePath(resolveFindingPath(p, realCwd), realTarget)
        );
      });
      const shown = mine.filter((f) => severityAtLeast(f.severity, settings.minSeverity));
      if (abort.signal.aborted || doc.isClosed) {
        return;
      }
      // Evidence steps may point at other files of the workspace folder, but
      // only when the file was scanned in place: a temporary copy has no
      // neighbours worth linking.
      const realFolder = !useTemp && folder?.uri.scheme === 'file' ? await canonical(folder.uri.fsPath) : undefined;
      const stepCtx: StepPathContext = {
        roots: [root, realCwd],
        file: { real: realTarget, local: doc.uri.fsPath },
        folder: realFolder && folder ? { real: realFolder, local: folder.uri.fsPath } : undefined,
      };
      const resolveStep: StepResolver = (p) => {
        const local = resolveStepPath(p, stepCtx);
        if (!local) {
          return undefined;
        }
        return samePath(local, doc.uri.fsPath) ? doc.uri : vscode.Uri.file(local);
      };
      this.store.set(doc.uri, shown, documentLines(doc), resolveStep);
      this.log.info(`Scanned ${doc.uri.fsPath}: ${shown.length} finding(s) in ${result.durationMs} ms.`);
      if (explicit) {
        void vscode.window.setStatusBarMessage(
          `Nephilex: ${shown.length} finding(s) in ${path.basename(doc.uri.fsPath)}`,
          5000,
        );
      }
    } catch (err) {
      this.reportError(err, explicit, doc.uri.fsPath);
    } finally {
      this.setBusy(-1);
      if (this.inFlight.get(key) === abort) {
        this.inFlight.delete(key);
      }
      if (tmpDir) {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }

  async scanWorkspace(): Promise<void> {
    const folders = (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === 'file');
    if (folders.length === 0) {
      void vscode.window.showInformationMessage('Open a folder to scan it with Nephilex.');
      return;
    }
    const settings = readSettings();
    const cli = await this.prepare(settings, true);
    if (!cli) {
      return;
    }
    this.workspaceScan?.abort();
    const abort = new AbortController();
    this.workspaceScan = abort;
    this.setBusy(1);
    try {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Nephilex', cancellable: true },
        async (progress, token) => {
          token.onCancellationRequested(() => abort.abort());
          let total = 0;
          let high = 0;
          for (const folder of folders) {
            if (abort.signal.aborted) {
              break;
            }
            progress.report({ message: `Scanning ${folder.name}...` });
            const results = await this.scanFolder(cli, settings, folder.uri.fsPath, abort.signal);
            if (results === undefined) {
              continue;
            }
            this.store.replaceFolder(folder.uri.fsPath, results);
            for (const e of results.values()) {
              total += e.items.length;
              high += e.items.filter((i) => i.finding.severity >= 3).length;
            }
          }
          if (!abort.signal.aborted) {
            void vscode.window.showInformationMessage(`Nephilex found ${total} finding(s), ${high} critical or high.`);
          }
        },
      );
    } finally {
      this.setBusy(-1);
      if (this.workspaceScan === abort) {
        this.workspaceScan = undefined;
      }
    }
  }

  private async scanFolder(
    cli: PreparedCli,
    settings: NephilexSettings,
    folder: string,
    signal: AbortSignal,
  ): Promise<Map<string, { uri: vscode.Uri; items: StoredFinding[] }> | undefined> {
    const args = buildScanArgs({
      command: 'scan',
      targets: [folder],
      minSeverity: settings.minSeverity,
      scanners: settings.scanners,
      offlineEnrichment: settings.offlineEnrichment,
      extraArgs: settings.extraArgs,
      supported: cli.caps.scanOptions,
    });
    let report: NephilexReport;
    let durationMs: number;
    try {
      const result = await this.cli.run(
        cli,
        args,
        folder,
        settings.workspaceTimeoutMs,
        settings.maxOutputBytes,
        signal,
      );
      durationMs = result.durationMs;
      report = this.parse(result.stdout, result.stderr, result.exitCode);
    } catch (err) {
      this.reportError(err, true, folder);
      return undefined;
    }
    const realFolder = await canonical(folder);
    const root = await reportRoot(report, realFolder);
    const grouped = new Map<string, NephilexFinding[]>();
    for (const f of report.findings) {
      if (!severityAtLeast(f.severity, settings.minSeverity)) {
        continue;
      }
      const abs = resolveFindingPath(f.location.path, root);
      if (!isInside(abs, realFolder)) {
        continue;
      }
      // Re-base on the folder path the editor uses, so URIs match open documents.
      const local = path.join(folder, path.relative(realFolder, abs));
      const list = grouped.get(local) ?? [];
      list.push(f);
      grouped.set(local, list);
    }
    const stepCtx: StepPathContext = { roots: [root], folder: { real: realFolder, local: folder } };
    const resolveStep: StepResolver = (p) => {
      const local = resolveStepPath(p, stepCtx);
      return local ? vscode.Uri.file(local) : undefined;
    };
    const results = new Map<string, { uri: vscode.Uri; items: StoredFinding[] }>();
    for (const [abs, findings] of grouped) {
      const uri = vscode.Uri.file(abs);
      const lines = await this.linesFor(uri);
      results.set(uri.toString(), {
        uri,
        items: findings.map((finding) => ({ finding, diagnostic: toDiagnostic(finding, lines, uri, resolveStep) })),
      });
    }
    this.log.info(`Scanned ${folder}: ${report.findings.length} finding(s) in ${durationMs} ms.`);
    return results;
  }

  private async linesFor(uri: vscode.Uri) {
    const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
    if (open) {
      return documentLines(open);
    }
    try {
      const st = await fs.stat(uri.fsPath);
      if (st.isFile() && st.size <= MAX_DOCUMENT_BYTES) {
        return textLines(await fs.readFile(uri.fsPath, 'utf8'));
      }
    } catch {
      // Fall through: ranges are placed on the reported line with no columns.
    }
    return { lineCount: Number.MAX_SAFE_INTEGER, lineText: () => '' };
  }

  private parse(stdout: string, stderr: string, exitCode: number | null): NephilexReport {
    try {
      const report = parseReport(stdout);
      for (const e of report.errors) {
        this.log.warn(`Nephilex reported: ${e}`);
      }
      if (report.scannersFailed.length) {
        this.log.warn(`Scanners failed: ${report.scannersFailed.join(', ')}`);
      }
      if (report.skipped) {
        this.log.warn(`Skipped ${report.skipped} malformed finding(s) in the report.`);
      }
      return report;
    } catch (err) {
      const tail = stderr.trim().split(/\r?\n/).slice(-5).join('\n');
      const why = err instanceof ReportParseError ? err.message : String(err);
      throw new Error(`${why} (exit code ${String(exitCode)})${tail ? `\n${tail}` : ''}`, {
        cause: err,
      });
    }
  }

  private reportError(err: unknown, explicit: boolean, what: string): void {
    if (err instanceof RunError && err.kind === 'cancelled') {
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    this.log.error(`Scan of ${what} failed: ${message}`);
    if (err instanceof RunError && err.kind === 'notFound') {
      this.cli.invalidate();
    }
    if (explicit) {
      void vscode.window
        .showErrorMessage(`Nephilex scan failed: ${message.split('\n')[0]}`, 'Show Log')
        .then((choice) => {
          if (choice) {
            this.log.show(true);
          }
        });
    }
  }

  dispose(): void {
    for (const t of this.timers.values()) {
      clearTimeout(t);
    }
    for (const a of this.inFlight.values()) {
      a.abort();
    }
    this.workspaceScan?.abort();
    this.busyChanged.dispose();
  }
}
