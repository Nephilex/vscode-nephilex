import * as fs from 'node:fs';
import * as vscode from 'vscode';
import {
  CliCapabilities,
  helpListsCommand,
  parseOptionNames,
  parseVersion,
  PYTHON_VERSION_PROBE,
  pythonModuleArgs,
} from './core/cli';
import { RunError, RunResult, runProcess } from './core/process';
import { ResolvedCli, resolveCli } from './core/resolve';
import { ArgusSettings } from './settings';

export interface PreparedCli {
  resolved: ResolvedCli;
  /** Arguments placed before the subcommand (`-P -m argus` for the Python form). */
  prefix: string[];
  caps: CliCapabilities;
}

export type PrepareResult =
  | { ok: true; cli: PreparedCli }
  | { ok: false; reason: 'untrusted' | 'notFound' | 'rejected' | 'broken'; message: string };

const PROBE_TIMEOUT_MS = 30_000;
const PROBE_MAX_BYTES = 1024 * 1024;

function isExecutableFile(p: string): boolean {
  try {
    if (!fs.statSync(p).isFile()) {
      return false;
    }
    if (process.platform !== 'win32') {
      fs.accessSync(p, fs.constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

function workspaceFolderPaths(): string[] {
  return (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === 'file').map((f) => f.uri.fsPath);
}

/**
 * Resolves and probes the argus CLI once per configuration and caches the
 * result. Nothing is executed while the workspace is untrusted.
 */
export class ArgusCli {
  private cache?: { key: string; result: Promise<PrepareResult> };

  constructor(
    private readonly log: vscode.LogOutputChannel,
    /** An extension-private directory used as cwd for probes. */
    private readonly safeCwd: string,
  ) {}

  invalidate(): void {
    this.cache = undefined;
  }

  prepare(settings: ArgusSettings): Promise<PrepareResult> {
    if (!vscode.workspace.isTrusted) {
      return Promise.resolve({
        ok: false,
        reason: 'untrusted',
        message: 'Argus does not run in Restricted Mode. Trust this workspace to enable scanning.',
      });
    }
    const key = JSON.stringify([settings.executablePath, settings.pythonPath, workspaceFolderPaths()]);
    if (this.cache?.key !== key) {
      const result = this.doPrepare(settings);
      this.cache = { key, result };
      // Do not cache failures: the user may install the CLI and retry.
      void result.then((r) => {
        if (!r.ok && this.cache?.result === result) {
          this.cache = undefined;
        }
      });
    }
    return this.cache.result;
  }

  private async doPrepare(settings: ArgusSettings): Promise<PrepareResult> {
    const resolved = resolveCli({
      executablePath: settings.executablePath,
      pythonPath: settings.pythonPath,
      envPath: process.env['PATH'] ?? process.env['Path'] ?? '',
      pathExt: process.env['PATHEXT'] ?? '.COM;.EXE',
      platform: process.platform,
      workspaceFolders: workspaceFolderPaths(),
      trusted: vscode.workspace.isTrusted,
      isExecutableFile,
    });
    if (!resolved.ok) {
      this.log.warn(resolved.message);
      return { ok: false, reason: resolved.reason, message: resolved.message };
    }
    const cli = resolved.cli;
    this.log.info(
      `Using ${cli.kind === 'python' ? 'Python interpreter' : 'argus executable'} ${cli.command} (from ${cli.source})`,
    );
    try {
      let prefix: string[] = [];
      if (cli.kind === 'python') {
        const v = await this.probe(cli.command, PYTHON_VERSION_PROBE);
        prefix = pythonModuleArgs(v.stdout);
      }
      const [version, help, scanHelp] = await Promise.all([
        this.probe(cli.command, [...prefix, '--version']),
        this.probe(cli.command, [...prefix, '--help']),
        this.probe(cli.command, [...prefix, 'scan', '--help']),
      ]);
      if (help.exitCode !== 0 || !helpListsCommand(help.stdout, 'scan')) {
        const detail = (help.stderr || help.stdout).trim().split('\n').slice(-3).join(' ');
        return {
          ok: false,
          reason: cli.kind === 'python' && /No module named/i.test(detail) ? 'notFound' : 'broken',
          message: `${cli.command} does not look like the Argus CLI. ${detail}`.trim(),
        };
      }
      const hasCheck = helpListsCommand(help.stdout, 'check');
      const checkOptions = hasCheck
        ? parseOptionNames((await this.probe(cli.command, [...prefix, 'check', '--help'])).stdout)
        : new Set<string>();
      const caps: CliCapabilities = {
        hasCheck,
        checkOptions,
        scanOptions: parseOptionNames(scanHelp.stdout),
        version: parseVersion(version.stdout + version.stderr),
      };
      this.log.info(
        `Argus ${caps.version || '(unknown version)'}; check command ${hasCheck ? 'available' : 'not available, using scan'}`,
      );
      return { ok: true, cli: { resolved: cli, prefix, caps } };
    } catch (err) {
      const message = err instanceof RunError ? err.message : String(err);
      this.log.error(`Probing the Argus CLI failed: ${message}`);
      return {
        ok: false,
        reason: err instanceof RunError && err.kind === 'notFound' ? 'notFound' : 'broken',
        message,
      };
    }
  }

  private probe(command: string, args: string[]): Promise<RunResult> {
    return runProcess({
      command,
      args,
      cwd: this.safeCwd,
      timeoutMs: PROBE_TIMEOUT_MS,
      maxOutputBytes: PROBE_MAX_BYTES,
    });
  }

  run(
    cli: PreparedCli,
    args: string[],
    cwd: string,
    timeoutMs: number,
    maxOutputBytes: number,
    signal?: AbortSignal,
  ): Promise<RunResult> {
    const full = [...cli.prefix, ...args];
    this.log.debug(`Running ${cli.resolved.command} ${full.map((a) => JSON.stringify(a)).join(' ')} in ${cwd}`);
    return runProcess({ command: cli.resolved.command, args: full, cwd, timeoutMs, maxOutputBytes, signal });
  }
}
