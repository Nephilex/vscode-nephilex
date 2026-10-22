/**
 * Downloads a VS Code build with @vscode/test-electron and runs the
 * integration suite inside it. The fixture workspace is copied to a temporary
 * directory so tests can edit files freely.
 *
 * Environment:
 *   VSCODE_TEST_VERSION     VS Code version to test (default: stable; CI also runs the engines minimum)
 *   NEPHILEX_TEST_EXECUTABLE   absolute path to a nephilex executable; enables the end-to-end tests
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  // Set when the tests are started from inside another Electron app (for
  // example an editor terminal); it would make VS Code start as plain Node.
  delete process.env['ELECTRON_RUN_AS_NODE'];
  const root = path.resolve(__dirname, '..', '..', '..');
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'nephilex-it-'));
  fs.cpSync(path.join(root, 'test', 'fixtures', 'workspace'), workspace, { recursive: true });
  try {
    await runTests({
      version: process.env['VSCODE_TEST_VERSION'] ?? 'stable',
      extensionDevelopmentPath: root,
      extensionTestsPath: path.join(__dirname, 'suite', 'index'),
      launchArgs: [
        workspace,
        '--disable-extensions',
        '--disable-workspace-trust',
        '--skip-welcome',
        '--skip-release-notes',
      ],
      extensionTestsEnv: {
        NEPHILEX_TEST_EXECUTABLE: process.env['NEPHILEX_TEST_EXECUTABLE'] ?? '',
        NEPHILEX_TEST_WORKSPACE: workspace,
      },
    });
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  console.error('Integration tests failed:', err);
  process.exit(1);
});
