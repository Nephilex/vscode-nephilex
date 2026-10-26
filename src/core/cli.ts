/**
 * Building the nephilex command line and reading its help output. Arguments are
 * always an array handed to `child_process.spawn` without a shell; file
 * contents are never placed on the command line.
 */
import { SeverityName } from './report';

export interface CliCapabilities {
  /** `nephilex check FILE... --format json` is available. */
  hasCheck: boolean;
  /** Long and short option names accepted by `nephilex check` (when present). */
  checkOptions: ReadonlySet<string>;
  /** Long and short option names accepted by `nephilex scan`. */
  scanOptions: ReadonlySet<string>;
  version: string;
}

/** True when the top-level help lists a `check` command. */
export function helpListsCommand(helpText: string, command: string): boolean {
  // Typer/rich renders "| check   Description |"; plain click renders "  check  Description".
  const re = new RegExp(`^[\\s\\u2502|]*${command}(?:\\s{2,}|\\s*[\\u2502|]?\\s*$)`, 'm');
  return re.test(helpText);
}

/** Extract option names such as `--min-severity` and `-s` from help output. */
export function parseOptionNames(helpText: string): Set<string> {
  const out = new Set<string>();
  for (const m of helpText.matchAll(/(?<![\w-])(--[a-z][a-z0-9-]*|-[a-zA-Z])(?![\w-])/g)) {
    out.add(m[1] as string);
  }
  return out;
}

export function parseVersion(text: string): string {
  const m = /(\d+\.\d+\.\d+[\w.+-]*)/.exec(text);
  return m ? (m[1] as string) : '';
}

/** Flags the extension controls itself; user extra args must not override them. */
const MANAGED_WITH_VALUE = new Set(['-f', '--format', '-o', '--output']);
const MANAGED_EQUALS = /^(?:--format|--output)=/;

export function sanitizeExtraArgs(args: readonly string[]): { kept: string[]; dropped: string[] } {
  const kept: string[] = [];
  const dropped: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (typeof a !== 'string' || a.length === 0 || a.length > 4096 || a.includes('\0')) {
      continue;
    }
    if (MANAGED_WITH_VALUE.has(a)) {
      dropped.push(a);
      if (i + 1 < args.length) {
        dropped.push(args[i + 1] as string);
        i++;
      }
      continue;
    }
    if (MANAGED_EQUALS.test(a)) {
      dropped.push(a);
      continue;
    }
    kept.push(a);
  }
  return { kept, dropped };
}

export interface ScanArgsInput {
  command: 'check' | 'scan';
  /** Absolute paths only. */
  targets: string[];
  minSeverity: SeverityName;
  scanners: readonly string[];
  offlineEnrichment: boolean;
  extraArgs: readonly string[];
  configPath?: string;
  /** Options supported by the chosen subcommand (from its --help). Empty means unknown. */
  supported: ReadonlySet<string>;
  /** Report format; html needs `output` and the scan command. Defaults to json on stdout. */
  format?: 'json' | 'html';
  /** Absolute path the CLI writes the report to (-o). */
  output?: string;
}

/**
 * Build the argument list after the executable (and after `-m nephilex` for the
 * Python form). Optional flags are only added when the subcommand's help lists
 * them, so a newer or older CLI does not fail on an unknown option. Targets
 * follow `--` so a path can never be parsed as an option.
 */
export function buildScanArgs(input: ScanArgsInput): string[] {
  const has = (opt: string): boolean => input.supported.size === 0 || input.supported.has(opt);
  const args: string[] = [input.command];
  const format = input.format ?? 'json';
  if (format === 'html' && (input.command !== 'scan' || !input.output)) {
    throw new Error('An HTML report needs the scan command and an output file.');
  }
  args.push(input.command === 'check' ? '--format' : '-f', format);
  if (input.output) {
    args.push('-o', input.output);
  }
  if (has('--quiet')) {
    args.push('--quiet');
  }
  if (has('--min-severity')) {
    args.push('--min-severity', input.minSeverity);
  }
  const scanners = input.scanners.filter((s) => /^[A-Za-z0-9_.-]+$/.test(s));
  if (scanners.length && has('--scanners')) {
    args.push('--scanners', scanners.join(','));
  }
  if (input.offlineEnrichment) {
    if (has('--ai-provider')) {
      args.push('--ai-provider', 'heuristic');
    }
    if (has('--patches')) {
      args.push('--patches');
    }
  } else if (has('--no-ai')) {
    args.push('--no-ai');
  }
  if (input.configPath && has('--config')) {
    args.push('--config', input.configPath);
  }
  args.push(...sanitizeExtraArgs(input.extraArgs).kept);
  args.push('--', ...input.targets);
  return args;
}

/**
 * Arguments that start `python -m nephilex` without importing modules from the
 * working directory: `-P` on Python 3.11+, isolated mode (`-I`) before that.
 * `versionText` is the output of `python -c "import sys; print(sys.version_info[:2])"`
 * style probes, for example "3.12".
 */
export function pythonModuleArgs(versionText: string): string[] {
  const m = /(\d+)\.(\d+)/.exec(versionText);
  const major = m ? Number(m[1]) : 0;
  const minor = m ? Number(m[2]) : 0;
  const safePath = major > 3 || (major === 3 && minor >= 11);
  return [safePath ? '-P' : '-I', '-m', 'nephilex'];
}

/** Probe run with `python -I -c ...` to read the interpreter version. */
export const PYTHON_VERSION_PROBE = ['-I', '-c', 'import sys; print("%d.%d" % sys.version_info[:2])'];
