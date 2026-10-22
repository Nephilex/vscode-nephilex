/**
 * Locating the argus executable (or a Python interpreter running
 * `python -m argus`) without ever trusting the workspace implicitly.
 *
 * - PATH lookup is done here, not by the OS: on Windows, spawning a bare name
 *   searches the current directory first, which would run a planted
 *   `argus.exe` from the workspace. Relative PATH entries are skipped.
 * - In an untrusted workspace, any candidate inside a workspace folder is
 *   rejected, whether it came from PATH or from a setting.
 * - Batch files are refused on Windows because they cannot run without a
 *   shell.
 */
import * as path from 'node:path';
import { isInside } from './mapping';

export interface ResolveInput {
  executablePath: string;
  pythonPath: string;
  envPath: string;
  pathExt: string;
  platform: NodeJS.Platform;
  workspaceFolders: readonly string[];
  trusted: boolean;
  isExecutableFile: (p: string) => boolean;
}

export interface ResolvedCli {
  kind: 'executable' | 'python';
  /** Absolute path of the program to spawn. */
  command: string;
  /** Where the path came from, for log messages. */
  source: 'argus.executablePath' | 'argus.pythonPath' | 'PATH';
}

export type ResolveResult =
  { ok: true; cli: ResolvedCli } | { ok: false; reason: 'notFound' | 'rejected'; message: string };

function candidatesFor(name: string, platform: NodeJS.Platform, pathExt: string): string[] {
  if (platform !== 'win32') {
    return [name];
  }
  if (path.extname(name)) {
    return [name];
  }
  const exts = pathExt
    .split(';')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e === '.exe' || e === '.com');
  return (exts.length ? exts : ['.exe']).map((e) => name + e);
}

function isBatch(p: string): boolean {
  const ext = path.extname(p).toLowerCase();
  return ext === '.bat' || ext === '.cmd';
}

function searchPath(name: string, input: ResolveInput): string | undefined {
  const sep = input.platform === 'win32' ? ';' : ':';
  for (const rawDir of input.envPath.split(sep)) {
    const dir = rawDir.trim().replace(/^"(.*)"$/, '$1');
    if (!dir || !path.isAbsolute(dir)) {
      continue; // never resolve against the current directory
    }
    if (!input.trusted && input.workspaceFolders.some((w) => isInside(dir, w, input.platform))) {
      continue;
    }
    for (const file of candidatesFor(name, input.platform, input.pathExt)) {
      const full = path.join(dir, file);
      if (input.isExecutableFile(full)) {
        return full;
      }
    }
  }
  return undefined;
}

function check(
  candidate: string | undefined,
  source: ResolvedCli['source'],
  kind: ResolvedCli['kind'],
  input: ResolveInput,
): ResolveResult {
  if (!candidate) {
    return {
      ok: false,
      reason: 'notFound',
      message:
        source === 'PATH'
          ? 'The argus executable was not found on PATH.'
          : `The program set in ${source} was not found.`,
    };
  }
  if (input.platform === 'win32' && isBatch(candidate)) {
    return {
      ok: false,
      reason: 'rejected',
      message: `${source} points to a batch file (${candidate}); point it at argus.exe or a Python interpreter instead.`,
    };
  }
  if (!input.trusted && input.workspaceFolders.some((w) => isInside(candidate, w, input.platform))) {
    return {
      ok: false,
      reason: 'rejected',
      message: `${source} points inside the workspace (${candidate}), which is not trusted.`,
    };
  }
  if (!input.isExecutableFile(candidate)) {
    return { ok: false, reason: 'notFound', message: `The program set in ${source} was not found: ${candidate}` };
  }
  return { ok: true, cli: { kind, command: candidate, source } };
}

function fromSetting(
  value: string,
  source: ResolvedCli['source'],
  kind: ResolvedCli['kind'],
  input: ResolveInput,
): ResolveResult {
  const v = value.trim();
  if (path.isAbsolute(v)) {
    return check(path.normalize(v), source, kind, input);
  }
  if (v.includes('/') || v.includes('\\')) {
    return {
      ok: false,
      reason: 'rejected',
      message: `${source} must be an absolute path or a bare program name found on PATH (got "${v}").`,
    };
  }
  return check(searchPath(v, input), source, kind, input);
}

export function resolveCli(input: ResolveInput): ResolveResult {
  if (input.pythonPath.trim()) {
    return fromSetting(input.pythonPath, 'argus.pythonPath', 'python', input);
  }
  if (input.executablePath.trim()) {
    return fromSetting(input.executablePath, 'argus.executablePath', 'executable', input);
  }
  return check(searchPath('argus', input), 'PATH', 'executable', input);
}
