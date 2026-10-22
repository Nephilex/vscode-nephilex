import * as fs from 'node:fs';
import * as vscode from 'vscode';
import { NephilexCli } from './nephilexCli';
import { NephilexCodeActionProvider, ignoreFinding } from './codeActions';
import { Commands, CONFIG_SECTION, INSTALL_COMMAND, INSTALL_URL } from './constants';
import { FindingStore } from './findingStore';
import { NephilexHoverProvider } from './hover';
import { registerMcpProvider } from './mcp';
import { CliProblem, ScanController } from './scanController';
import { readSettings } from './settings';
import { NephilexStatusBar, showProblems } from './statusBar';

const FILE_SELECTOR: vscode.DocumentSelector = { scheme: 'file' };

export interface NephilexApi {
  /** For tests: the finding store backing diagnostics. */
  readonly store: FindingStore;
}

export function activate(context: vscode.ExtensionContext): NephilexApi {
  const log = vscode.window.createOutputChannel('Nephilex', { log: true });
  const safeCwd = context.globalStorageUri.fsPath;
  fs.mkdirSync(safeCwd, { recursive: true });

  const cli = new NephilexCli(log, safeCwd);
  const store = new FindingStore();
  const status = new NephilexStatusBar(store);
  let missingShown = false;

  const showInstallHelp = async (message: string): Promise<void> => {
    const choice = await vscode.window.showErrorMessage(
      `${message} Install it with "${INSTALL_COMMAND}", or set nephilex.executablePath or nephilex.pythonPath.`,
      'Install Nephilex',
      'Copy Install Command',
      'Open Settings',
    );
    if (choice === 'Install Nephilex') {
      await vscode.env.openExternal(vscode.Uri.parse(INSTALL_URL));
    } else if (choice === 'Copy Install Command') {
      await vscode.env.clipboard.writeText(INSTALL_COMMAND);
    } else if (choice === 'Open Settings') {
      await vscode.commands.executeCommand('workbench.action.openSettings', CONFIG_SECTION);
    }
  };

  const onCliProblem = (problem: CliProblem, explicit: boolean): void => {
    if (problem.reason === 'untrusted') {
      status.setCliState('untrusted');
      if (explicit) {
        void vscode.window.showWarningMessage(problem.message, 'Manage Workspace Trust').then((c) => {
          if (c) {
            void vscode.commands.executeCommand('workbench.trust.manage');
          }
        });
      }
      return;
    }
    status.setCliState('missing');
    if (explicit || !missingShown) {
      missingShown = true;
      void showInstallHelp(problem.message);
    }
  };

  const scanner = new ScanController(cli, store, log, onCliProblem);
  // Always registered where supported; the provider returns nothing while nephilex.mcp.enabled is off.
  const mcp = registerMcpProvider(cli, log);

  const refreshCliState = (): void => {
    cli.invalidate();
    status.setCliState(vscode.workspace.isTrusted ? 'unknown' : 'untrusted');
    mcp?.refresh();
  };
  refreshCliState();

  const shouldAutoScan = (doc: vscode.TextDocument): boolean =>
    vscode.workspace.isTrusted && doc.uri.scheme === 'file' && readSettings().run !== 'off';

  context.subscriptions.push(
    log,
    store,
    status,
    scanner,
    ...(mcp ? [mcp.disposable] : []),
    store.onDidChange(() => status.update()),
    scanner.onDidChangeBusy((busy) => {
      if (!busy && vscode.workspace.isTrusted) {
        // A completed run means the CLI resolved, unless a problem was reported.
        void cli.prepare(readSettings()).then((p) => status.setCliState(p.ok ? 'ready' : 'missing'));
      }
      status.setBusy(busy);
    }),

    vscode.languages.registerHoverProvider(FILE_SELECTOR, new NephilexHoverProvider(store)),
    vscode.languages.registerCodeActionsProvider(FILE_SELECTOR, new NephilexCodeActionProvider(store), {
      providedCodeActionKinds: NephilexCodeActionProvider.kinds,
    }),

    vscode.commands.registerCommand(Commands.scanWorkspace, () => scanner.scanWorkspace()),
    vscode.commands.registerCommand(Commands.scanFile, async () => {
      const doc = vscode.window.activeTextEditor?.document;
      if (!doc) {
        void vscode.window.showInformationMessage('Open a file to scan it with Nephilex.');
        return;
      }
      await scanner.scanDocument(doc, true);
    }),
    vscode.commands.registerCommand(Commands.clearFindings, () => store.clear()),
    vscode.commands.registerCommand(Commands.showProblems, () => showProblems()),
    vscode.commands.registerCommand(Commands.showLog, () => log.show(true)),
    vscode.commands.registerCommand(Commands.ignoreFinding, (args: unknown) => ignoreFinding(store, args)),
    vscode.commands.registerCommand(Commands.installHelp, async () => {
      const prep = await cli.prepare(readSettings());
      if (prep.ok) {
        status.setCliState('ready');
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
