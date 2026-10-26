import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import {
  buildInstallCommand,
  describeCommand,
  displayCommand,
  InstallMethod,
  NEPHILEX_REQUIREMENT,
  parsePythonInfo,
  pythonSupported,
  shellKind,
} from '../../src/core/install';
import { findOnPath } from '../../src/core/resolve';

const win = process.platform === 'win32';
const python = path.resolve(win ? 'C:\\Program Files\\Python312\\python.exe' : '/usr/bin/python3');
const pipx = path.resolve(win ? 'C:\\Users\\me\\.local\\bin\\pipx.exe' : '/home/me/.local/bin/pipx');

function pip(over: Partial<{ major: number; minor: number; venv: boolean }> = {}): InstallMethod {
  return { kind: 'pip', program: python, python: { major: 3, minor: 12, venv: false, ...over }, origin: 'path' };
}

describe('install command', () => {
  it('uses pipx when it is available', () => {
    assert.deepEqual(buildInstallCommand({ kind: 'pipx', program: pipx }), {
      program: pipx,
      args: ['install', 'nephilex[ast]'],
    });
  });

  it('installs with pip into the user site, with -P on Python 3.11 and later', () => {
    assert.deepEqual(buildInstallCommand(pip()).args, ['-P', '-m', 'pip', 'install', '--user', 'nephilex[ast]']);
    assert.deepEqual(buildInstallCommand(pip({ minor: 10 })).args, [
      '-I',
      '-m',
      'pip',
      'install',
      '--user',
      'nephilex[ast]',
    ]);
  });

  it('drops --user inside a virtual environment', () => {
    assert.deepEqual(buildInstallCommand(pip({ venv: true })).args, ['-P', '-m', 'pip', 'install', 'nephilex[ast]']);
  });

  it('returns an argument array, never a shell string', () => {
    for (const m of [pip(), pip({ venv: true }), { kind: 'pipx', program: pipx } as InstallMethod]) {
      const cmd = buildInstallCommand(m);
      assert.ok(path.isAbsolute(cmd.program));
      assert.ok(Array.isArray(cmd.args));
      // The requirement is one argument with its brackets intact, not quoted for any shell.
      assert.equal(cmd.args.at(-1), NEPHILEX_REQUIREMENT);
      for (const a of cmd.args) {
        assert.doesNotMatch(a, /["'\s;&|`$]/, a);
      }
    }
  });

  it('refuses a relative program', () => {
    assert.throws(() => buildInstallCommand({ kind: 'pipx', program: 'pipx' }));
    assert.throws(() => buildInstallCommand({ ...pip(), program: './python' }));
  });

  it('describes the command without paths', () => {
    assert.equal(
      describeCommand(buildInstallCommand({ kind: 'pipx', program: pipx })),
      `${path.basename(pipx)} install nephilex[ast]`,
    );
  });
});

describe('typed install command', () => {
  const cmd = {
    program: 'C:\\Program Files\\Python312\\python.exe',
    args: ['-P', '-m', 'pip', 'install', '--user', 'nephilex[ast]'],
  };

  it('quotes for PowerShell with the call operator', () => {
    assert.equal(
      displayCommand(cmd, 'powershell'),
      "& 'C:\\Program Files\\Python312\\python.exe' -P -m pip install --user 'nephilex[ast]'",
    );
    assert.equal(
      displayCommand({ program: 'C:\\py\\python.exe', args: ['install', 'nephilex[ast]'] }, 'powershell'),
      "C:\\py\\python.exe install 'nephilex[ast]'",
    );
    assert.equal(
      displayCommand({ program: "C:\\it's\\python.exe", args: [] }, 'powershell'),
      "& 'C:\\it''s\\python.exe'",
    );
  });

  it('quotes for cmd and refuses characters cmd would expand', () => {
    assert.equal(
      displayCommand(cmd, 'cmd'),
      '"C:\\Program Files\\Python312\\python.exe" -P -m pip install --user "nephilex[ast]"',
    );
    assert.equal(displayCommand({ program: 'C:\\%USERPROFILE%\\python.exe', args: [] }, 'cmd'), undefined);
    assert.equal(displayCommand({ program: 'C:\\a!b\\python.exe', args: [] }, 'cmd'), undefined);
  });

  it('quotes for POSIX shells', () => {
    assert.equal(
      displayCommand({ program: '/home/me/.local/bin/pipx', args: ['install', 'nephilex[ast]'] }, 'posix'),
      "/home/me/.local/bin/pipx install 'nephilex[ast]'",
    );
    assert.equal(
      displayCommand({ program: "/opt/it's here/python3", args: ['-P'] }, 'posix'),
      "'/opt/it'\\''s here/python3' -P",
    );
    assert.equal(displayCommand({ program: '/x/$(id)/python3', args: [] }, 'posix'), "'/x/$(id)/python3'");
  });

  it('refuses control characters in any shell', () => {
    for (const shell of ['posix', 'powershell', 'cmd'] as const) {
      assert.equal(displayCommand({ program: '/x/py\nrm -rf ~', args: [] }, shell), undefined);
    }
  });

  it('detects the shell family', () => {
    assert.equal(shellKind('C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', 'win32'), 'powershell');
    assert.equal(shellKind('C:\\Program Files\\PowerShell\\7\\pwsh.exe', 'win32'), 'powershell');
    assert.equal(shellKind('C:\\WINDOWS\\System32\\cmd.exe', 'win32'), 'cmd');
    assert.equal(shellKind('C:\\Program Files\\Git\\bin\\bash.exe', 'win32'), 'posix');
    assert.equal(shellKind('/bin/zsh', 'darwin'), 'posix');
    assert.equal(shellKind('/usr/bin/fish', 'linux'), 'posix');
    assert.equal(shellKind('C:\\WINDOWS\\System32\\wsl.exe', 'win32'), undefined);
    assert.equal(shellKind('/usr/bin/nu', 'linux'), undefined);
    assert.equal(shellKind('', 'win32'), 'powershell');
  });
});

describe('python probe', () => {
  it('reads the version and virtual environment flag', () => {
    assert.deepEqual(parsePythonInfo('3.12 1\r\n'), { major: 3, minor: 12, venv: true });
    assert.deepEqual(parsePythonInfo('3.9 0\n'), { major: 3, minor: 9, venv: false });
    assert.equal(
      parsePythonInfo('Python was not found; run without arguments to install from the Microsoft Store'),
      undefined,
    );
    assert.equal(pythonSupported({ major: 3, minor: 10, venv: false }), true);
    assert.equal(pythonSupported({ major: 3, minor: 9, venv: false }), false);
  });
});

describe('installer lookup on PATH', () => {
  const ws = path.resolve(win ? 'C:\\work\\repo' : '/work/repo');
  const bin = path.resolve(win ? 'C:\\tools\\bin' : '/usr/local/bin');
  const exe = win ? 'pipx.exe' : 'pipx';
  const delim = win ? ';' : ':';

  function input(envPath: string, files: string[]) {
    const set = new Set(files.map((f) => path.resolve(f)));
    return {
      envPath,
      pathExt: '.COM;.EXE;.BAT;.CMD',
      platform: process.platform,
      workspaceFolders: [ws],
      trusted: true,
      isExecutableFile: (p: string) => set.has(path.resolve(p)),
    };
  }

  it('finds pipx on PATH as an absolute path', () => {
    assert.equal(findOnPath('pipx', input(['relative', bin].join(delim), [path.join(bin, exe)])), path.join(bin, exe));
  });

  it('skips PATH entries inside the workspace even when it is trusted', () => {
    const planted = path.join(ws, 'node_modules', '.bin');
    assert.equal(findOnPath('pipx', input(planted, [path.join(planted, exe)])), undefined);
  });

  if (win) {
    it('never returns a batch file', () => {
      assert.equal(findOnPath('pipx', input(bin, [path.join(bin, 'pipx.cmd')])), undefined);
    });
  }
});
