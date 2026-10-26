/**
 * Installing the Nephilex CLI. The command is always a program plus an
 * argument array: the extension runs it without a shell (see process.ts).
 * A display form quoted for the user's shell is produced only for typing
 * into a terminal, where the user reviews it and presses Enter.
 */
import * as path from 'node:path';

/** The package installed: the CLI plus the tree-sitter parsers used by the AST scanners. */
export const NEPHILEX_REQUIREMENT = 'nephilex[ast]';
/** `requires-python` of the nephilex package. */
export const MIN_PYTHON: readonly [number, number] = [3, 10];

export interface PythonInfo {
  major: number;
  minor: number;
  /** Running in a virtual environment, where `pip install --user` is refused. */
  venv: boolean;
}

/** Run with `python <probe>` (isolated mode, so nothing from the working directory is imported). */
export const PYTHON_INFO_PROBE = [
  '-I',
  '-c',
  'import sys; print("%d.%d %d" % (sys.version_info[0], sys.version_info[1], int(sys.prefix != sys.base_prefix)))',
];

export function parsePythonInfo(stdout: string): PythonInfo | undefined {
  const m = /^(\d+)\.(\d+) ([01])\s*$/m.exec(stdout);
  if (!m) {
    return undefined;
  }
  return { major: Number(m[1]), minor: Number(m[2]), venv: m[3] === '1' };
}

export function pythonSupported(info: PythonInfo): boolean {
  return info.major > MIN_PYTHON[0] || (info.major === MIN_PYTHON[0] && info.minor >= MIN_PYTHON[1]);
}

export type InstallMethod =
  { kind: 'pipx'; program: string } | { kind: 'pip'; program: string; python: PythonInfo; origin: 'selected' | 'path' };

export interface InstallCommand {
  /** Absolute path of the program. */
  program: string;
  args: string[];
}

/**
 * `pipx install "nephilex[ast]"`, or `python -m pip install --user "nephilex[ast]"`
 * (no `--user` inside a virtual environment).
 *
 * Python 3.11 and later start with `-P`, so the working directory is not on
 * `sys.path` and a module there cannot stand in for pip. On 3.10 the only
 * equivalent is `-I`, which also disables the user site, and pip then
 * refuses `--user`; so `-I` is used there only inside a virtual environment.
 * The caller always runs the command from an extension-private working
 * directory, which is what keeps workspace modules out in every case.
 */
export function buildInstallCommand(method: InstallMethod): InstallCommand {
  if (!path.isAbsolute(method.program)) {
    throw new Error(`The installer must be an absolute path (got "${method.program}").`);
  }
  if (method.kind === 'pipx') {
    return { program: method.program, args: ['install', NEPHILEX_REQUIREMENT] };
  }
  const { major, minor, venv } = method.python;
  const hasSafePath = major > 3 || (major === 3 && minor >= 11);
  const isolation = hasSafePath ? ['-P'] : venv ? ['-I'] : [];
  return {
    program: method.program,
    args: [...isolation, '-m', 'pip', 'install', ...(venv ? [] : ['--user']), NEPHILEX_REQUIREMENT],
  };
}

export type ShellKind = 'posix' | 'powershell' | 'cmd';

/**
 * The quoting rules for the user's default terminal shell (`vscode.env.shell`).
 * Undefined for shells whose rules are unknown or that cannot run a Windows
 * path (WSL), in which case the command is not typed for the user.
 */
export function shellKind(shellPath: string, platform: NodeJS.Platform): ShellKind | undefined {
  const name = path.win32
    .basename(shellPath.trim())
    .toLowerCase()
    .replace(/\.exe$/, '');
  if (name === 'pwsh' || name === 'powershell') {
    return 'powershell';
  }
  if (name === 'cmd') {
    return 'cmd';
  }
  if (['bash', 'sh', 'zsh', 'fish', 'dash', 'ksh'].includes(name)) {
    return 'posix';
  }
  if (name === '') {
    return platform === 'win32' ? 'powershell' : 'posix';
  }
  return undefined;
}

const POSIX_BARE = /^[A-Za-z0-9_@%+=:,./-]+$/;
const PWSH_BARE = /^[A-Za-z0-9_+=:,./\\-]+$/;
const CMD_BARE = /^[A-Za-z0-9_+=:,./\\-]+$/;

function quote(arg: string, shell: ShellKind): string | undefined {
  // eslint-disable-next-line no-control-regex
  if (arg === '' || /[\u0000-\u001f\u007f]/.test(arg)) {
    return undefined;
  }
  switch (shell) {
    case 'posix':
      return POSIX_BARE.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
    case 'powershell':
      return PWSH_BARE.test(arg) ? arg : `'${arg.replace(/'/g, "''")}'`;
    case 'cmd':
      // cmd expands %VAR% and, with delayed expansion, !VAR! even inside quotes.
      if (/["%!^]/.test(arg)) {
        return undefined;
      }
      return CMD_BARE.test(arg) ? arg : `"${arg}"`;
  }
}

/**
 * The command as the user would type it in `shell`, for review before they
 * press Enter. Undefined when it cannot be quoted safely for that shell.
 */
export function displayCommand(cmd: InstallCommand, shell: ShellKind): string | undefined {
  const parts = [cmd.program, ...cmd.args].map((a) => quote(a, shell));
  if (parts.some((p) => p === undefined)) {
    return undefined;
  }
  const [program, ...args] = parts as string[];
  // PowerShell needs the call operator to run a quoted path.
  const head = shell === 'powershell' && program !== cmd.program ? `& ${program}` : (program as string);
  return [head, ...args].join(' ');
}

/** A short, shell-neutral description for messages, e.g. `pipx install nephilex[ast]`. */
export function describeCommand(cmd: InstallCommand): string {
  const name = path.basename(cmd.program.replace(/\\/g, '/'));
  return [name, ...cmd.args].join(' ');
}
