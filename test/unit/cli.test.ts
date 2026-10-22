import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import {
  buildScanArgs,
  helpListsCommand,
  parseOptionNames,
  parseVersion,
  pythonModuleArgs,
  sanitizeExtraArgs,
} from '../../src/core/cli';
import { resolveCli, ResolveInput } from '../../src/core/resolve';

const RICH_HELP = [
  ' Usage: argus [OPTIONS] COMMAND [ARGS]...',
  '\u250c\u2500 Commands \u2500\u2510',
  '\u2502 scan            Scan a target and report findings.          \u2502',
  '\u2502 check           Scan files and print findings.               \u2502',
  '\u2502 mcp             Run Argus as an MCP server (stdio).          \u2502',
  '\u2502                 a scan check for the commands column         \u2502',
].join('\n');

describe('help parsing', () => {
  it('finds commands in rich and plain help output', () => {
    assert.equal(helpListsCommand(RICH_HELP, 'check'), true);
    assert.equal(helpListsCommand(RICH_HELP, 'scan'), true);
    assert.equal(helpListsCommand(RICH_HELP, 'fix'), false);
    assert.equal(helpListsCommand('Commands:\n  check  Check files.\n  scan   Scan.', 'check'), true);
    assert.equal(helpListsCommand('Commands:\n  scan   Scan, then check.', 'check'), false);
  });

  it('extracts option names', () => {
    const opts = parseOptionNames(
      '\u2502 --scanners  -s   <str>  ...\u2502\n\u2502 --min-severity  <str>\u2502 --no-ai \u2502',
    );
    assert.deepEqual([...opts].sort(), ['--min-severity', '--no-ai', '--scanners', '-s']);
  });

  it('reads the version', () => {
    assert.equal(parseVersion('Argus v0.9.2\n'), '0.9.2');
    assert.equal(parseVersion('nothing'), '');
  });
});

describe('argument building', () => {
  const supported = new Set([
    '--quiet',
    '--min-severity',
    '--scanners',
    '--ai-provider',
    '--patches',
    '--no-ai',
    '--config',
  ]);

  it('builds a scan command with targets after --', () => {
    const args = buildScanArgs({
      command: 'scan',
      targets: ['/w/app.py'],
      minSeverity: 'medium',
      scanners: ['patterns', 'secrets', 'bad name;rm'],
      offlineEnrichment: true,
      extraArgs: ['--profile', 'fast', '-o', 'x.json', '--format=sarif'],
      configPath: '/w/.argus.yml',
      supported,
    });
    assert.deepEqual(args, [
      'scan',
      '-f',
      'json',
      '--quiet',
      '--min-severity',
      'medium',
      '--scanners',
      'patterns,secrets',
      '--ai-provider',
      'heuristic',
      '--patches',
      '--config',
      '/w/.argus.yml',
      '--profile',
      'fast',
      '--',
      '/w/app.py',
    ]);
  });

  it('uses --format for check and skips options the CLI does not list', () => {
    const args = buildScanArgs({
      command: 'check',
      targets: ['/w/a.ts'],
      minSeverity: 'low',
      scanners: [],
      offlineEnrichment: false,
      extraArgs: [],
      supported: new Set(['--format', '--quiet']),
    });
    assert.deepEqual(args, ['check', '--format', 'json', '--quiet', '--', '/w/a.ts']);
  });

  it('drops managed flags from extra args', () => {
    assert.deepEqual(sanitizeExtraArgs(['-f', 'html', '--deep', '--output=o', 'ok', 'a\0b']), {
      kept: ['--deep', 'ok'],
      dropped: ['-f', 'html', '--output=o'],
    });
  });

  it('starts python without the working directory on sys.path', () => {
    assert.deepEqual(pythonModuleArgs('3.12\n'), ['-P', '-m', 'argus']);
    assert.deepEqual(pythonModuleArgs('3.11'), ['-P', '-m', 'argus']);
    assert.deepEqual(pythonModuleArgs('3.10'), ['-I', '-m', 'argus']);
    assert.deepEqual(pythonModuleArgs(''), ['-I', '-m', 'argus']);
  });
});

describe('executable resolution', () => {
  const win = process.platform === 'win32';
  const ws = path.resolve(win ? 'C:\\work\\repo' : '/work/repo');
  const bin = path.resolve(win ? 'C:\\tools\\bin' : '/usr/local/bin');
  const exe = win ? 'argus.exe' : 'argus';

  function input(over: Partial<ResolveInput>, files: string[]): ResolveInput {
    const set = new Set(files.map((f) => path.resolve(f)));
    return {
      executablePath: '',
      pythonPath: '',
      envPath: '',
      pathExt: '.COM;.EXE;.BAT;.CMD',
      platform: process.platform,
      workspaceFolders: [ws],
      trusted: true,
      isExecutableFile: (p) => set.has(path.resolve(p)),
      ...over,
    };
  }

  const delim = win ? ';' : ':';

  it('finds argus on PATH and returns an absolute path', () => {
    const r = resolveCli(input({ envPath: ['relative', bin].join(delim) }, [path.join(bin, exe)]));
    assert.ok(r.ok);
    assert.equal(r.cli.command, path.join(bin, exe));
    assert.equal(r.cli.source, 'PATH');
  });

  it('never resolves through relative PATH entries', () => {
    const r = resolveCli(input({ envPath: ['.', ''].join(delim) }, [path.join('.', exe)]));
    assert.equal(r.ok, false);
  });

  it('skips PATH entries inside an untrusted workspace', () => {
    const planted = path.join(ws, 'node_modules', '.bin');
    const r = resolveCli(input({ envPath: [planted, bin].join(delim), trusted: false }, [path.join(planted, exe)]));
    assert.equal(r.ok, false);
  });

  it('rejects settings that point into an untrusted workspace', () => {
    const p = path.join(ws, '.venv', win ? 'Scripts\\python.exe' : 'bin/python');
    const r = resolveCli(input({ pythonPath: p, trusted: false }, [p]));
    assert.equal(r.ok, false);
    assert.equal(r.ok ? '' : r.reason, 'rejected');
    const trusted = resolveCli(input({ pythonPath: p, trusted: true }, [p]));
    assert.ok(trusted.ok);
    assert.equal(trusted.cli.kind, 'python');
  });

  it('rejects relative paths with separators', () => {
    const r = resolveCli(input({ executablePath: './bin/argus' }, []));
    assert.equal(r.ok ? '' : r.reason, 'rejected');
  });

  it('reports a missing CLI as notFound', () => {
    const r = resolveCli(input({ envPath: bin }, []));
    assert.equal(r.ok ? '' : r.reason, 'notFound');
  });

  if (win) {
    it('refuses batch files on Windows', () => {
      const p = 'C:\\tools\\argus.cmd';
      const r = resolveCli(input({ executablePath: p }, [p]));
      assert.equal(r.ok ? '' : r.reason, 'rejected');
    });

    it('only considers .exe and .com from PATHEXT', () => {
      const r = resolveCli(input({ envPath: bin }, [path.join(bin, 'argus.bat')]));
      assert.equal(r.ok, false);
    });
  }
});
