/**
 * "Install Nephilex": finds pipx or a Python interpreter, asks the user to
 * confirm in a modal dialog, and then either runs the install in a terminal
 * or types it there for the user to review and run.
 *
 * Nothing is installed silently or in Restricted Mode. A confirmed install
 * is spawned through core/process.ts (argument array, no shell, bounded
 * output and runtime) and its output is streamed to a terminal. Settings are
 * changed only when the user agrees.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { CONFIG_SECTION, INSTALL_COMMAND, PYTHON_DOWNLOAD_URL } from './constants';
import {
  buildInstallCommand,
  describeCommand,
  displayCommand,
  InstallCommand,
  InstallMethod,
  MIN_PYTHON,
  parsePythonInfo,
  PYTHON_INFO_PROBE,
  PythonInfo,
  pythonSupported,
  shellKind,
} from './core/install';
import { samePath } from './core/mapping';
import { cliEnv, RunError, runProcess } from './core/process';
import { findOnPath } from './core/resolve';
import { isExecutableFile, NephilexCli, workspaceFolderPaths } from './nephilexCli';
import { readSettings } from './settings';

const PROBE_TIMEOUT_MS = 15_000;
const INSTALL_TIMEOUT_MS = 20 * 60 * 1000;
const INSTALL_MAX_BYTES = 32 * 1024 * 1024;
const PYTHON_EXTENSION_ID = 'ms-python.python';

export interface InstallDeps {
  cli: NephilexCli;
  log: vscode.LogOutputChannel;
  /** Extension-private directory used as the working directory. */
  safeCwd: string;
  /** Called once the CLI resolves after an install. */
  onReady: () => void;
}

function pathInput() {
  return {
    envPath: process.env['PATH'] ?? process.env['Path'] ?? '',
    pathExt: process.env['PATHEXT'] ?? '.COM;.EXE',
    platform: process.platform,
    workspaceFolders: workspaceFolderPaths(),
    trusted: vscode.workspace.isTrusted,
    isExecutableFile,
  };
}

/** Shape of the parts of the Python extension API used here (feature detected). */
interface PythonExtensionApi {
  environments?: {
    getActiveEnvironmentPath?: (resource?: vscode.Uri) => { path?: unknown } | undefined;
  };
  settings?: {
    getExecutionDetails?: (resource?: vscode.Uri) => { execCommand?: unknown } | undefined;
  };
}

function withTimeout<T>(p: Thenable<T>, ms: number): Promise<T | undefined> {
  return Promise.race([
    Promise.resolve(p),
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms).unref()),
  ]);
}

/** The interpreter selected in the Python extension, when it is installed and has one. */
async function selectedInterpreter(log: vscode.LogOutputChannel): Promise<string | undefined> {
  const ext = vscode.extensions.getExtension<PythonExtensionApi>(PYTHON_EXTENSION_ID);
  if (!ext) {
    return undefined;
  }
  try {
    const api = ext.isActive ? ext.exports : await withTimeout(ext.activate(), 10_000);
    const resource = vscode.workspace.workspaceFolders?.[0]?.uri;
    const fromEnv = api?.environments?.getActiveEnvironmentPath?.(resource)?.path;
    const exec = api?.settings?.getExecutionDetails?.(resource)?.execCommand;
    const candidate = typeof fromEnv === 'string' ? fromEnv : Array.isArray(exec) ? (exec[0] as unknown) : undefined;
    if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) {
      return undefined;
    }
    const ext2 = path.extname(candidate).toLowerCase();
    if (process.platform === 'win32' && (ext2 === '.bat' || ext2 === '.cmd')) {
      return undefined;
    }
    return isExecutableFile(candidate) ? path.normalize(candidate) : undefined;
  } catch (err) {
    log.warn(`Could not read the selected Python interpreter: ${String(err)}`);
    return undefined;
  }
}

async function probePython(program: string, safeCwd: string): Promise<PythonInfo | undefined> {
  try {
    const r = await runProcess({
      command: program,
      args: PYTHON_INFO_PROBE,
      cwd: safeCwd,
      timeoutMs: PROBE_TIMEOUT_MS,
      maxOutputBytes: 64 * 1024,
      label: 'Python',
    });
    return r.exitCode === 0 ? parsePythonInfo(r.stdout) : undefined;
  } catch {
    return undefined;
  }
}

interface Candidate {
  method: InstallMethod;
  label: string;
  description: string;
}

async function findCandidates(deps: InstallDeps): Promise<{ found: Candidate[]; tooOld: string[] }> {
  const found: Candidate[] = [];
  const tooOld: string[] = [];
  const input = pathInput();
  const pipx = findOnPath('pipx', input);
  if (pipx) {
    found.push({ method: { kind: 'pipx', program: pipx }, label: 'pipx (recommended)', description: pipx });
  }
  const pythons: { program: string; origin: 'selected' | 'path' }[] = [];
  const selected = await selectedInterpreter(deps.log);
  if (selected) {
    pythons.push({ program: selected, origin: 'selected' });
  }
  const names = process.platform === 'win32' ? ['python'] : ['python3', 'python'];
  for (const name of names) {
    const p = findOnPath(name, input);
    if (p && !pythons.some((x) => samePath(x.program, p))) {
      pythons.push({ program: p, origin: 'path' });
      break;
    }
  }
  for (const { program, origin } of pythons) {
    const info = await probePython(program, deps.safeCwd);
    if (!info) {
      deps.log.info(`Skipping ${program}: it did not run as a Python interpreter.`);
      continue;
    }
    if (!pythonSupported(info)) {
      tooOld.push(`${program} (Python ${info.major}.${info.minor})`);
      continue;
    }
    const where = info.venv ? 'virtual environment' : 'user site-packages';
    found.push({
      method: { kind: 'pip', program, python: info, origin },
      label: origin === 'selected' ? 'Selected Python interpreter' : 'Python on PATH',
      description: `Python ${info.major}.${info.minor}, ${where}: ${program}`,
    });
  }
  return { found, tooOld };
}

/**
 * A terminal that shows the output of one process started through
 * runProcess. Closing the terminal stops the process.
 */
class ProcessTerminal implements vscode.Pseudoterminal {
  private readonly writeEmitter = new vscode.EventEmitter<string>();
  readonly onDidWrite = this.writeEmitter.event;
  private readonly abort = new AbortController();

  constructor(
    private readonly cmd: InstallCommand,
    private readonly cwd: string,
    private readonly onDone: (exitCode: number | null) => void,
  ) {}

  private write(text: string): void {
    this.writeEmitter.fire(text.replace(/\r?\n/g, '\r\n'));
  }

  open(): void {
    this.write(`Running ${[this.cmd.program, ...this.cmd.args].map((a) => JSON.stringify(a)).join(' ')}\n\n`);
    runProcess({
      command: this.cmd.program,
      args: this.cmd.args,
      cwd: this.cwd,
      timeoutMs: INSTALL_TIMEOUT_MS,
      maxOutputBytes: INSTALL_MAX_BYTES,
      env: cliEnv(),
      signal: this.abort.signal,
      label: 'The install',
      onOutput: (text) => this.write(text),
    }).then(
      (r) => {
        this.write(`\nFinished with exit code ${String(r.exitCode)}. You can close this terminal.\n`);
        this.onDone(r.exitCode);
      },
      (err: unknown) => {
        if (err instanceof RunError && err.kind === 'cancelled') {
          return; // The user closed the terminal.
        }
        const message = err instanceof RunError ? err.message : String(err);
        this.write(`\n${message}\n`);
        this.onDone(null);
      },
    );
  }

  close(): void {
    this.abort.abort();
    this.writeEmitter.dispose();
  }
}

async function pipxBinDir(pipx: string, safeCwd: string): Promise<string | undefined> {
  try {
    const r = await runProcess({
      command: pipx,
      args: ['environment', '--value', 'PIPX_BIN_DIR'],
      cwd: safeCwd,
      timeoutMs: PROBE_TIMEOUT_MS,
      maxOutputBytes: 64 * 1024,
      label: 'pipx',
    });
    const dir = r.stdout.trim().split(/\r?\n/)[0]?.trim();
    return r.exitCode === 0 && dir && path.isAbsolute(dir) ? dir : undefined;
  } catch {
    return undefined;
  }
}

/** Offer to point a setting at the freshly installed CLI; changes nothing without consent. */
async function offerSetting(
  deps: InstallDeps,
  key: 'pythonPath' | 'executablePath',
  value: string,
  message: string,
): Promise<boolean> {
  const settings = { ...readSettings(), pythonPath: '', executablePath: '', [key]: value };
  deps.cli.invalidate();
  const prep = await deps.cli.prepare(settings);
  if (!prep.ok) {
    return false;
  }
  const version = prep.cli.caps.version ? ` ${prep.cli.caps.version}` : '';
  const choice = await vscode.window.showInformationMessage(
    `${message} Set nephilex.${key} in your user settings to use Nephilex${version} from ${value}?`,
    'Use It',
    'Not Now',
  );
  if (choice === 'Use It') {
    await vscode.workspace.getConfiguration(CONFIG_SECTION).update(key, value, vscode.ConfigurationTarget.Global);
    deps.onReady();
  }
  return true;
}

/** Check for the CLI after an install and, with the user's consent, point the settings at it. */
export async function checkAfterInstall(deps: InstallDeps, method: InstallMethod | undefined): Promise<void> {
  deps.cli.invalidate();
  const prep = await deps.cli.prepare(readSettings());
  if (prep.ok) {
    deps.onReady();
    void vscode.window.showInformationMessage(
      `Nephilex ${prep.cli.caps.version} is ready (${prep.cli.resolved.command}).`,
    );
    return;
  }
  const notOnPath = 'Nephilex is installed, but the nephilex command is not on the PATH this editor sees.';
  if (method?.kind === 'pip' && (await offerSetting(deps, 'pythonPath', method.program, notOnPath))) {
    return;
  }
  if (method?.kind === 'pipx') {
    const bin = await pipxBinDir(method.program, deps.safeCwd);
    const exe = bin ? path.join(bin, process.platform === 'win32' ? 'nephilex.exe' : 'nephilex') : undefined;
    if (exe && fs.existsSync(exe) && (await offerSetting(deps, 'executablePath', exe, notOnPath))) {
      return;
    }
  }
  const choice = await vscode.window.showWarningMessage(
    'Nephilex was not found after the install. Check the terminal output, then set nephilex.executablePath or nephilex.pythonPath, or restart the editor so it picks up a changed PATH.',
    'Open Settings',
  );
  if (choice) {
    await vscode.commands.executeCommand('workbench.action.openSettings', CONFIG_SECTION);
  }
}

/** The "Install Nephilex" command. */
export async function installCli(deps: InstallDeps): Promise<void> {
  if (!vscode.workspace.isTrusted) {
    const c = await vscode.window.showWarningMessage(
      'Nephilex is not installed from a workspace in Restricted Mode. Trust the workspace first.',
      'Manage Workspace Trust',
    );
    if (c) {
      await vscode.commands.executeCommand('workbench.trust.manage');
    }
    return;
  }
  const { found, tooOld } = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: 'Nephilex: looking for pipx and Python' },
    () => findCandidates(deps),
  );
  if (found.length === 0) {
    const old = tooOld.length ? ` Found only older versions: ${tooOld.join(', ')}.` : '';
    const c = await vscode.window.showErrorMessage(
      `Installing Nephilex needs pipx or Python ${MIN_PYTHON.join('.')} or later, and neither was found.${old}`,
      'Get Python',
      'Copy Install Command',
    );
    if (c === 'Get Python') {
      await vscode.env.openExternal(vscode.Uri.parse(PYTHON_DOWNLOAD_URL));
    } else if (c === 'Copy Install Command') {
      await vscode.env.clipboard.writeText(INSTALL_COMMAND);
    }
    return;
  }
  let pick: Candidate | undefined = found[0];
  if (found.length > 1) {
    const items = found.map((c) => ({
      label: c.label,
      description: describeCommand(buildInstallCommand(c.method)),
      detail: c.description,
      candidate: c,
    }));
    pick = (
      await vscode.window.showQuickPick(items, {
        title: 'Install Nephilex',
        placeHolder: 'Choose how to install the Nephilex CLI',
      })
    )?.candidate;
  }
  if (!pick) {
    return;
  }
  const cmd = buildInstallCommand(pick.method);
  const shell = shellKind(vscode.env.shell, process.platform);
  const typed = shell ? displayCommand(cmd, shell) : undefined;
  const actions = typed ? ['Run in Terminal', 'Type in Terminal'] : ['Run in Terminal'];
  const choice = await vscode.window.showInformationMessage(
    'Install the Nephilex CLI?',
    {
      modal: true,
      detail:
        `This downloads Nephilex and its dependencies from PyPI and runs:\n\n${describeCommand(cmd)}\n\n` +
        `Program: ${cmd.program}\n\n` +
        'Run in Terminal starts it now and shows the output. Type in Terminal only types the command; ' +
        'review it and press Enter yourself.',
    },
    ...actions,
  );
  if (!choice || !vscode.workspace.isTrusted) {
    return;
  }
  const method = pick.method;
  deps.log.info(`Installing Nephilex: ${[cmd.program, ...cmd.args].join(' ')}`);
  if (choice === 'Run in Terminal') {
    const pty = new ProcessTerminal(cmd, deps.safeCwd, (code) => {
      if (code === 0) {
        void checkAfterInstall(deps, method);
      } else {
        void vscode.window.showErrorMessage('The Nephilex install did not succeed. The terminal shows the output.');
      }
    });
    vscode.window.createTerminal({ name: 'Install Nephilex', pty }).show();
    return;
  }
  if (typed) {
    const term = vscode.window.createTerminal({ name: 'Install Nephilex', cwd: deps.safeCwd });
    term.show();
    // No newline: the command is not run until the user presses Enter.
    term.sendText(typed, false);
    const c = await vscode.window.showInformationMessage(
      'The install command is typed in the terminal. Press Enter there to run it, then click Check Again.',
      'Check Again',
    );
    if (c) {
      await checkAfterInstall(deps, method);
    }
  }
}
