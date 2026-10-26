import * as fs from 'node:fs';
import * as vscode from 'vscode';
import { NephilexCli } from './nephilexCli';
import { NephilexCodeActionProvider, ignoreFinding } from './codeActions';
import { Commands, CONFIG_SECTION, ContextKeys, FINDINGS_VIEW, INSTALL_COMMAND } from './constants';
import { FindingStore } from './findingStore';
import { copyRuleId, FindingsView, ignoreFromView, openFinding, openRuleDocs } from './findingsView';
import { NephilexHoverProvider } from './hover';
import { openHtmlReport } from './htmlReport';
import { installCli } from './install';
import { registerMcpProvider } from './mcp';
import { CliProblem, ScanController } from './scanController';
import { readSettings } from './settings';
import { CliState, NephilexStatusBar, showProblems } from './statusBar';

const FILE_SELECTOR: vscode.DocumentSelector = { scheme: 'file' };

export interface NephilexApi {
  /** For tests: the finding store backing diagnostics. */
  readonly store: FindingStore;
}

function asUris(v: unknown): vscode.Uri[] {
  if (v instanceof vscode.Uri) {
    return [v];
  }
  return Array.isArray(v) ? v.filter((u): u is vscode.Uri => u instanceof vscode.Uri) : [];
}

export function activate(context: vscode.ExtensionContext): NephilexApi {
  const log = vscode.window.createOutputChannel('Nephilex', { log: true });
  const safeCwd = context.globalStorageUri.fsPath;
  fs.mkdirSync(safeCwd, { recursive: true });

  const cli = new NephilexCli(log, safeCwd);
  const store = new FindingStore();
  const status = new NephilexStatusBar(store);
  const view = new FindingsView(store, context.workspaceState);
  let missingShown = false;

  /** One place for the CLI state: status bar, welcome content, and walkthrough. */
  const setCliState = (state: CliState): void => {
    status.setCliState(state);
    void vscode.commands.executeCommand('setContext', ContextKeys.cliState, state);
  };

  const installDeps = { cli, log, safeCwd, onReady: () => setCliState('ready') };

  const showInstallHelp = async (message: string): Promise<void> => {
    const choice = await vscode.window.showErrorMessage(
      `${message} Install it, or set nephilex.executablePath or nephilex.pythonPath.`,
      'Install Nephilex',
      'Copy Install Command',
      'Open Settings',
    );
    if (choice === 'Install Nephilex') {
      await installCli(installDeps);
    } else if (choice === 'Copy Install Command') {
      await vscode.env.clipboard.writeText(INSTALL_COMMAND);
    } else if (choice === 'Open Settings') {
      await vscode.commands.executeCommand('workbench.action.openSettings', CONFIG_SECTION);
    }
  };

  const onCliProblem = (problem: CliProblem, explicit: boolean): void => {
    if (problem.reason === 'untrusted') {
      setCliState('untrusted');
      if (explicit) {
        void vscode.window.showWarningMessage(problem.message, 'Manage Workspace Trust').then((c) => {
          if (c) {
            void vscode.commands.executeCommand('workbench.trust.manage');
          }
        });
      }
      return;
    }
    setCliState('missing');
    if (explicit || !missingShown) {
      missingShown = true;
      void showInstallHelp(problem.message);
    }
  };

  const scanner = new ScanController(cli, store, log, onCliProblem);
  // Always registered where supported; the provider returns nothing while nephilex.mcp.enabled is off.
  const mcp = registerMcpProvider(cli, log);

  /** Probe the CLI quietly (trusted workspaces only) so the view can say whether it is installed. */
  const probeCli = (): void => {
    if (!vscode.workspace.isTrusted) {
      return;
    }
    void cli.prepare(readSettings()).then((p) => {
      if (p.ok) {
        setCliState('ready');
      } else if (p.reason !== 'untrusted') {
        setCliState('missing');
      }
    });
  };

  const refreshCliState = (): void => {
    cli.invalidate();
    setCliState(vscode.workspace.isTrusted ? 'unknown' : 'untrusted');
    mcp?.refresh();
    if (view.visible) {
      probeCli();
    }
  };
  refreshCliState();
  void vscode.commands.executeCommand('setContext', ContextKeys.scanned, false);

  const shouldAutoScan = (doc: vscode.TextDocument): boolean =>
    vscode.workspace.isTrusted && doc.uri.scheme === 'file' && readSettings().run !== 'off';

  context.subscriptions.push(
    log,
    store,
    status,
    view,
    scanner,
    ...(mcp ? [mcp.disposable] : []),
    store.onDidChange(() => status.update()),
    scanner.onDidChangeBusy((busy) => {
      if (!busy && vscode.workspace.isTrusted) {
        // A completed run means the CLI resolved, unless a problem was reported.
        void cli.prepare(readSettings()).then((p) => setCliState(p.ok ? 'ready' : 'missing'));
      }
      status.setBusy(busy);
    }),
    scanner.onDidScan(() => void vscode.commands.executeCommand('setContext', ContextKeys.scanned, true)),
    view.onDidChangeVisibility((e) => {
      if (e.visible) {
        probeCli();
      }
    }),

    vscode.languages.registerHoverProvider(FILE_SELECTOR, new NephilexHoverProvider(store)),
    vscode.languages.registerCodeActionsProvider(FILE_SELECTOR, new NephilexCodeActionProvider(store), {
      providedCodeActionKinds: NephilexCodeActionProvider.kinds,
    }),

    vscode.commands.registerCommand(Commands.scanWorkspace, () => scanner.scanWorkspace()),
    vscode.commands.registerCommand(Commands.scanFile, async (arg: unknown) => {
      // From the editor title the active editor's URI is passed; from the palette, nothing.
      const uri = arg instanceof vscode.Uri ? arg : undefined;
      const doc =
        uri && uri.toString() !== vscode.window.activeTextEditor?.document.uri.toString()
          ? await vscode.workspace.openTextDocument(uri).then(undefined, () => undefined)
          : vscode.window.activeTextEditor?.document;
      if (!doc) {
        void vscode.window.showInformationMessage('Open a file to scan it with Nephilex.');
        return;
      }
      await scanner.scanDocument(doc, true);
    }),
    vscode.commands.registerCommand(Commands.scanResource, async (clicked: unknown, selected: unknown) => {
      // Explorer passes the clicked item and, with multi-select, every selected item.
      const uris = asUris(selected).length ? asUris(selected) : asUris(clicked);
      if (uris.length === 0) {
        await scanner.scanWorkspace();
        return;
      }
      await scanner.scanResources(uris);
    }),
    vscode.commands.registerCommand(Commands.refresh, () => scanner.rescan()),
    vscode.commands.registerCommand(Commands.clearFindings, () => store.clear()),
    vscode.commands.registerCommand(Commands.showProblems, () => showProblems()),
    vscode.commands.registerCommand(Commands.showFindings, () =>
      vscode.commands.executeCommand(`${FINDINGS_VIEW}.focus`),
    ),
    vscode.commands.registerCommand(Commands.showLog, () => log.show(true)),
    vscode.commands.registerCommand(Commands.ignoreFinding, (args: unknown) => ignoreFinding(store, args)),
    vscode.commands.registerCommand(Commands.installCli, () => installCli(installDeps)),
    vscode.commands.registerCommand(Commands.openHtmlReport, () => openHtmlReport(cli, scanner, log)),
    vscode.commands.registerCommand(Commands.filterFindings, () => view.pickFilter()),
    vscode.commands.registerCommand(Commands.resetFilter, () => view.setFilter({ minSeverity: 'info', grade: 'all' })),
    vscode.commands.registerCommand(Commands.groupBySeverity, () => view.setGroupBy('severity')),
    vscode.commands.registerCommand(Commands.groupByFile, () => view.setGroupBy('file')),
    vscode.commands.registerCommand(Commands.openFinding, (node: unknown) => openFinding(node)),
    vscode.commands.registerCommand(Commands.ignoreFromView, (node: unknown) => ignoreFromView(store, node)),
    vscode.commands.registerCommand(Commands.copyRuleId, (node: unknown) => copyRuleId(node)),
    vscode.commands.registerCommand(Commands.openRuleDocs, (node: unknown) => openRuleDocs(node)),
    vscode.commands.registerCommand(Commands.installHelp, async () => {
      const prep = await cli.prepare(readSettings());
      if (prep.ok) {
        setCliState('ready');
        void vscode.window.showInformationMessage(
          `Nephilex ${prep.cli.caps.version} found at ${prep.cli.resolved.command}.`,
        );
      } else {
        onCliProblem(prep, true);
      }
    }),

    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (shouldAutoScan(doc)) {
        void scanner.scanDocument(doc, false);
      }
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.contentChanges.length && shouldAutoScan(e.document)) {
        const s = readSettings();
        if (s.run === 'onType') {
          scanner.scheduleOnType(e.document, s.debounceMs);
        }
      }
    }),
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (shouldAutoScan(doc) && readSettings().run === 'onType') {
        scanner.scheduleOnType(doc, readSettings().debounceMs);
      }
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => scanner.cancel(doc.uri)),
    vscode.workspace.onDidDeleteFiles((e) => e.files.forEach((u) => store.delete(u))),
    vscode.workspace.onDidRenameFiles((e) => e.files.forEach((f) => store.delete(f.oldUri))),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(CONFIG_SECTION)) {
        missingShown = false;
        refreshCliState();
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => refreshCliState()),
    vscode.workspace.onDidGrantWorkspaceTrust(() => refreshCliState()),
  );

  return { store };
}

export function deactivate(): void {
  // Disposables registered on the context are cleaned up by the editor.
}
