# Contributing

Thanks for helping improve the Argus extension. The general guidelines of the main project apply:
<https://github.com/Argus-CodeSecurity/Argus-appsec/blob/main/CONTRIBUTING.md>

## Setup

Requirements: Node.js 22 and npm, plus the Argus CLI (`pip install argus-appsec`) for end-to-end
tests.

```sh
npm ci
npm run build        # bundles src/ into dist/extension.js with esbuild
npm run watch        # rebuilds on change; press F5 in VS Code to launch an Extension Development Host
```

## Checks

```sh
npm run typecheck
npm run lint
npm run format:check
npm run test:unit
npm run test:integration
```

`test:integration` downloads a VS Code build with `@vscode/test-electron` into `.vscode-test/`.
Set `VSCODE_TEST_VERSION` to test a specific version (CI tests the `engines.vscode` minimum and
the current stable release) and `ARGUS_TEST_EXECUTABLE` to the absolute path of an `argus`
executable to run the end-to-end tests. On Linux, run it under `xvfb-run -a`.

## Code layout

- `src/core/`: code with no `vscode` dependency (report parsing, mapping, fixes, CLI arguments,
  executable resolution, process handling). Unit tested in plain Node.
- `src/*.ts`: editor integration (diagnostics, hover, code actions, status bar, MCP).
- `test/unit/`: mocha unit tests. `test/integration/`: tests that run inside VS Code.

## Rules

- Spawn processes only through `src/core/process.ts`: argument arrays, no shell, bounded output
  and runtime. ESLint enforces this.
- Treat everything in an Argus report as untrusted text.
- Use only stable `vscode` APIs; feature detect anything newer than `engines.vscode`.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/), with an imperative
  subject of at most 72 characters, and are signed off (`git commit -s`) to certify the
  [Developer Certificate of Origin](https://developercertificate.org/).
- No em or en dashes, emoji, or decorative Unicode in code, UI strings, or docs.
