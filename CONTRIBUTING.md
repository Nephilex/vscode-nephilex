# Contributing

Thanks for helping improve the Nephilex extension. The general guidelines of the main project apply:
<https://github.com/nephilex/nephilex/blob/main/CONTRIBUTING.md>

## Setup

Requirements: Node.js 22 and npm, plus the Nephilex CLI (`pip install nephilex`) for end-to-end
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
the current stable release) and `NEPHILEX_TEST_EXECUTABLE` to the absolute path of a `nephilex`
executable to run the end-to-end tests. On Linux, run it under `xvfb-run -a`.

## Code layout

- `src/core/`: code with no `vscode` dependency (report and evidence parsing, mapping, fixes, CLI
  arguments, the Findings view model, install commands, HTML report preparation, executable
  resolution, process handling). Unit tested in plain Node.
- `src/*.ts`: editor integration (diagnostics, hover, code actions, Findings view, install flow,
  HTML report, status bar, MCP).
- `walkthrough/`: Markdown pages of the getting started walkthrough. They ship with the
  extension and must not load remote content.
- `test/unit/`: mocha unit tests. `test/integration/`: tests that run inside VS Code.
- `test/fixtures/report-scan.json` is CLI output without evidence (0.11.0 and older);
  `test/fixtures/report-evidence.json` is output with evidence, from the CLI development tree for
  `test/fixtures/workspace`. Regenerate fixtures from real CLI runs; do not edit them by hand
  beyond replacing local paths.

## Rules

- Spawn processes only through `src/core/process.ts`: argument arrays, no shell, bounded output
  and runtime. ESLint enforces this.
- Treat everything in a Nephilex report as untrusted text.
- Use only stable `vscode` APIs; feature detect anything newer than `engines.vscode`.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/), with an imperative
  subject of at most 72 characters, and are signed off (`git commit -s`) to certify the
  [Developer Certificate of Origin](https://developercertificate.org/).
- No em or en dashes, emoji, or decorative Unicode in code, UI strings, or docs.
- No telemetry, and no new runtime dependencies without a strong reason.

## Screenshots (TODO before publishing)

The README lists the screenshots the store page needs. They must be captured by hand from a real
editor session running a released CLI against a sample project, then added under `images/` and
referenced from the README (add them to the `.vscodeignore` allow list). Do not use mock-ups,
generated images, or edited captures that show UI or results the extension does not produce.
