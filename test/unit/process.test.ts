import * as assert from 'node:assert/strict';
import * as os from 'node:os';
import { RunError, runProcess } from '../../src/core/process';

// Uses the Node binary running the tests as a stand-in CLI.
const node = process.execPath;
const base = { command: node, cwd: os.tmpdir(), timeoutMs: 10_000, maxOutputBytes: 1024 * 1024 };

describe('runProcess', () => {
  it('passes arguments verbatim without a shell', async () => {
    const tricky = ['a b', '$(whoami)', '`id`', '&& echo x', '%PATH%', '"quoted"'];
    const r = await runProcess({
      ...base,
      args: ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', ...tricky],
    });
    assert.equal(r.exitCode, 0);
    assert.deepEqual(JSON.parse(r.stdout), tricky);
  });

  it('kills a process that exceeds the timeout', async () => {
    await assert.rejects(
      runProcess({ ...base, timeoutMs: 300, args: ['-e', 'setTimeout(() => {}, 60000)'] }),
      (e: unknown) => e instanceof RunError && e.kind === 'timeout',
    );
  });

  it('stops reading when output exceeds the cap', async () => {
    await assert.rejects(
      runProcess({
        ...base,
        maxOutputBytes: 1000,
        args: ['-e', 'setInterval(() => process.stdout.write("x".repeat(500)), 1)'],
      }),
      (e: unknown) => e instanceof RunError && e.kind === 'outputLimit',
    );
  });

  it('can be cancelled', async () => {
    const ac = new AbortController();
    const p = runProcess({ ...base, signal: ac.signal, args: ['-e', 'setTimeout(() => {}, 60000)'] });
    setTimeout(() => ac.abort(), 100);
    await assert.rejects(p, (e: unknown) => e instanceof RunError && e.kind === 'cancelled');
  });

  it('reports a missing program', async () => {
    await assert.rejects(
      runProcess({ ...base, command: 'definitely-not-a-real-program-xyz', args: [] }),
      (e: unknown) => e instanceof RunError && e.kind === 'notFound',
    );
  });

  it('streams output and caps stderr too when streaming', async () => {
    const seen: string[] = [];
    const r = await runProcess({
      ...base,
      args: ['-e', 'process.stdout.write("out"); process.stderr.write("err")'],
      onOutput: (text, stream) => seen.push(`${stream}:${text}`),
    });
    assert.equal(r.exitCode, 0);
    assert.deepEqual(seen.sort(), ['stderr:err', 'stdout:out']);
    await assert.rejects(
      runProcess({
        ...base,
        maxOutputBytes: 1000,
        label: 'pip',
        args: ['-e', 'setInterval(() => process.stderr.write("x".repeat(500)), 1)'],
        onOutput: () => undefined,
      }),
      (e: unknown) => e instanceof RunError && e.kind === 'outputLimit' && e.message.startsWith('pip '),
    );
  });

  it('returns stderr and a non-zero exit code', async () => {
    const r = await runProcess({ ...base, args: ['-e', 'console.error("boom"); process.exit(3)'] });
    assert.equal(r.exitCode, 3);
    assert.match(r.stderr, /boom/);
  });
});
