/**
 * Running the CLI: argument array, no shell, no stdin, bounded output and
 * runtime. On timeout, cancellation, or output overflow the whole process
 * tree is killed.
 */
import { ChildProcess, spawn } from 'node:child_process';
import * as path from 'node:path';

export interface RunOptions {
  command: string;
  args: readonly string[];
  cwd: string;
  timeoutMs: number;
  maxOutputBytes: number;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

export interface RunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export type RunErrorKind = 'notFound' | 'timeout' | 'outputLimit' | 'cancelled' | 'spawn';

export class RunError extends Error {
  constructor(
    readonly kind: RunErrorKind,
    message: string,
    readonly stderr = '',
  ) {
    super(message);
    this.name = 'RunError';
  }
}

const STDERR_LIMIT = 64 * 1024;

/** Environment for the CLI: plain output, UTF-8, no color or progress bars. */
export function cliEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...base,
    NO_COLOR: '1',
    TERM: 'dumb',
    COLUMNS: '200',
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1',
    // Python 3.11+: do not put the working directory on sys.path.
    PYTHONSAFEPATH: '1',
  };
}

function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) {
    return;
  }
  if (process.platform === 'win32') {
    const systemRoot = process.env['SystemRoot'] ?? 'C:\\Windows';
    const taskkill = path.join(systemRoot, 'System32', 'taskkill.exe');
    try {
      const k = spawn(taskkill, ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      k.on('error', () => child.kill());
    } catch {
      child.kill();
    }
    return;
  }
  child.kill('SIGTERM');
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  }, 2000).unref();
}

export function runProcess(opts: RunOptions): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    if (opts.signal?.aborted) {
      reject(new RunError('cancelled', 'Cancelled.'));
      return;
    }
    let child: ChildProcess;
    try {
      child = spawn(opts.command, [...opts.args], {
        cwd: opts.cwd,
        env: opts.env ?? cliEnv(),
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      reject(new RunError('spawn', `Could not start ${opts.command}: ${String(err)}`));
      return;
    }

    const out: Buffer[] = [];
    let outBytes = 0;
    let err = '';
    let settled = false;

    const finish = (fn: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      fn();
    };
    const fail = (kind: RunErrorKind, message: string): void => {
      killTree(child);
      finish(() => reject(new RunError(kind, message, err)));
    };
    const onAbort = (): void => fail('cancelled', 'Cancelled.');
    const timer = setTimeout(
      () => fail('timeout', `Argus did not finish within ${Math.round(opts.timeoutMs / 1000)} s and was stopped.`),
      opts.timeoutMs,
    );
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout?.on('data', (chunk: Buffer) => {
      outBytes += chunk.length;
      if (outBytes > opts.maxOutputBytes) {
        fail(
          'outputLimit',
          `Argus output exceeded ${Math.round(opts.maxOutputBytes / (1024 * 1024))} MB and was stopped.`,
        );
        return;
      }
      out.push(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      err += chunk.toString('utf8');
      if (err.length > STDERR_LIMIT) {
        err = err.slice(err.length - STDERR_LIMIT);
      }
    });
    child.on('error', (e: NodeJS.ErrnoException) => {
      const kind: RunErrorKind = e.code === 'ENOENT' ? 'notFound' : 'spawn';
      finish(() => reject(new RunError(kind, `Could not start ${opts.command}: ${e.message}`, err)));
    });
    child.on('close', (code) => {
      finish(() =>
        resolve({
          exitCode: code,
          stdout: Buffer.concat(out).toString('utf8'),
          stderr: err,
          durationMs: Date.now() - started,
        }),
      );
    });
  });
}
