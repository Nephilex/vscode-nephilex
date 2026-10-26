# Nephilex for VS Code

Application security for code, dependencies, secrets, infrastructure as code, and AI/LLM apps,
in the editor. The extension shows findings from [Nephilex](https://github.com/nephilex/nephilex),
an open-source security scanner (`nephilex` on PyPI): SAST and taint analysis, hardcoded
secrets, vulnerable dependencies, infrastructure as code, CI/CD, and LLM application checks.
Documentation: <https://nephilex.github.io/nephilex/>.

The extension is a thin client. All analysis is done by the `nephilex` CLI on your machine. The
extension makes no network requests of its own and collects no telemetry; the only action that
downloads anything is **Install Nephilex**, which runs pip or pipx after you confirm it.

Like every scanner, Nephilex reports what its checks can see. It does not find every
vulnerability, and an empty result is not proof that code is safe.

## Features

- **Evidence for each finding** (Nephilex CLI 0.12.0 and later). The hover starts with the
  evidence grade (`confirmed`, `likely`, or `possible`) and the sentence it rests on, then the
  data-flow path from source to sink as a numbered list of file, line, and note, and a few steps
  to verify the finding. In the Problems panel, each path step is a clickable related location,
  and the message starts with the grade, for example `[likely]`. With older CLIs (0.11.0 and
  before) there is no evidence and everything else works as before. See
  [Evidence and grades](https://nephilex.github.io/nephilex/evidence/).
- **Findings view.** The Nephilex icon in the activity bar opens a Findings view, grouped by
  severity (with counts) and then by file, or by file alone. Each entry shows the title, the grade
  when there is one, and the line; click it to open the location. The toolbar has Scan Workspace,
  Refresh (runs the last scan again), Filter (minimum severity and evidence grade), Group by, and
  Clear. Right-click a finding to open it, ignore it with a reason, copy its rule id, or open the
  rule documentation.
- **Diagnostics.** Findings appear in the Problems panel and as squiggles. Critical and high are
  errors, medium is a warning, low and info are information. The diagnostic code is the rule id
  and links to the rule documentation; the message includes the CWE and OWASP mappings.
- **Scan on save, on type, or on demand.** `nephilex.run` selects `onSave` (default), `onType`
  (debounced), or `off`. Scan any time with **Nephilex: Scan Workspace**, the shield button in
  the editor title (**Scan Current File**), or **Scan with Nephilex** on files and folders in the
  Explorer context menu. A folder gets a workspace-style scan of just that folder.
- **Hover.** Why the code is vulnerable, the attacker perspective, impact, and fix guidance.
- **Quick fixes.** **Apply Nephilex fix** appears when the CLI produced a deterministic fix that it
  re-scanned and verified. **Ignore with reason** is always offered and appends a
  `nephilex-ignore` comment with the reason you enter, for example
  `# nephilex-ignore: patterns.python-shell-true reason="command is a constant"`. For file types
  without `#` or `//` comments (such as JSON) a `.nephilex.yml` allow entry is copied to the
  clipboard instead.
- **HTML report.** **Nephilex: Open HTML Report** runs `nephilex scan FOLDER -f html` for the folder
  scanned last (or a workspace folder you pick) and shows the report in an editor tab, with
  scripts disabled.
- **Status bar.** A spinner while a scan runs, then the counts by severity, for example
  `1C 3H 2M`. Click it to open the Findings view.
- **Install from the editor.** When the CLI is not found, **Install Nephilex** offers
  `pipx install "nephilex[ast]"` (when pipx is on PATH), the interpreter selected in the Python
  extension, or Python on PATH (`python -m pip install --user "nephilex[ast]"`). You confirm the
  command in a dialog first, then either run it in a terminal or have it typed there for you to
  run. Afterwards the extension checks for the CLI again and, if you agree, sets
  `nephilex.pythonPath` or `nephilex.executablePath`.
- **Getting started walkthrough.** Run **Welcome: Open Walkthrough...** and choose "Get Started
  with Nephilex": install the CLI, run a first scan, read a finding and its evidence, ignore a
  false positive with a reason, and set up CI. It is plain Markdown shipped with the extension.
- **MCP server for agent mode.** On editors that support the MCP server definition API
  (VS Code 1.101 and later), the extension registers `nephilex mcp` so agents can call the
  `nephilex_scan` tool. See the MCP section below for other editors.

Screenshots (to be captured from a real editor session before publishing; see `CONTRIBUTING.md`):

1. Findings view grouped by severity, with grades and line numbers.
2. Hover over a SQL injection finding showing the evidence grade, path, and verification steps.
3. Problems panel with a finding expanded to its clickable path steps.
4. Quick fix menu with "Apply Nephilex fix" and "Ignore with reason".
5. Status bar item showing the counts by severity.

## Requirements

- The Nephilex CLI 0.10.0 or later: `pipx install "nephilex[ast]"` or
  `python -m pip install --user "nephilex[ast]"`, or use **Install Nephilex** in the extension.
  Earlier versions do not attach fixes to `nephilex check`, so "Apply Nephilex fix" is not offered.
  Evidence grades, paths, and verification steps need 0.12.0 or later.
- Python 3.10 or later for the CLI.
- VS Code 1.93 or later, or a compatible editor (Cursor, Windsurf, VSCodium, and other forks).

If the CLI is not found, the Findings view and a message offer **Install Nephilex**.

## Settings

| Setting                            | Default  | Description                                                                                                         |
| ---------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------- |
| `nephilex.run`                     | `onSave` | `off`, `onSave`, or `onType`.                                                                                       |
| `nephilex.debounceMs`              | `800`    | Pause after the last edit before an on-type scan.                                                                   |
| `nephilex.executablePath`          | empty    | Absolute path to `nephilex`. Empty searches PATH. User settings only.                                               |
| `nephilex.pythonPath`              | empty    | Python interpreter with `nephilex` installed; runs `python -m nephilex`. Takes precedence. User settings only.      |
| `nephilex.minSeverity`             | `low`    | Hide findings below this severity.                                                                                  |
| `nephilex.scanners`                | `[]`     | Scanners to run (`nephilex scanners` lists them). Empty runs the CLI default.                                       |
| `nephilex.extraArgs`               | `[]`     | Extra CLI arguments, one per item. `-f`, `--format`, `-o`, and `--output` are managed by the extension and dropped. |
| `nephilex.offlineEnrichment`       | `true`   | Passes `--ai-provider heuristic --patches` for offline reasoning and verified fixes. When false, passes `--no-ai`.  |
| `nephilex.timeoutSeconds`          | `60`     | Fail-safe timeout for a file scan.                                                                                  |
| `nephilex.workspaceTimeoutSeconds` | `900`    | Fail-safe timeout for a workspace scan.                                                                             |
| `nephilex.maxOutputMB`             | `64`     | Maximum CLI output read; larger output aborts the scan.                                                             |
| `nephilex.mcp.enabled`             | `true`   | Register the Nephilex MCP server where the editor supports it.                                                      |
| `nephilex.showScanButton`          | `true`   | Show the Scan Current File button (shield icon) in the editor title bar.                                            |

The Findings view filter (minimum severity and evidence grade) and grouping are view settings,
remembered per workspace. They do not change what the CLI reports; `nephilex.minSeverity` does.

## Security model

- **Workspace Trust.** In Restricted Mode the extension runs nothing, neither automatically nor
  from commands, and registers no MCP server. `nephilex.executablePath`, `nephilex.pythonPath`, and
  `nephilex.extraArgs` are restricted settings, so a workspace cannot set them until it is trusted;
  the two path settings are also machine scoped and can only be set in user settings.
- **No workspace binaries without trust.** The extension resolves `nephilex` on PATH itself and
  spawns the absolute path, skipping relative PATH entries. This avoids the Windows behavior of
  running a program from the current directory first. In an untrusted workspace any candidate
  inside a workspace folder is rejected. Batch files are refused on Windows.
- **Python form.** `python -m nephilex` is started with `-P` (Python 3.11 and later) or `-I`, so
  modules in the workspace cannot shadow Nephilex.
- **Process handling.** The CLI is spawned with an argument array and `shell: false`, targets
  follow `--`, and file contents are never put on the command line. Unsaved content is written
  to a private temporary directory, scanned, and deleted. Output size and runtime are capped and
  the process tree is killed when a limit is reached.
- **Untrusted report content.** Finding text comes from scanning workspace files, so hovers
  insert it as escaped text in an untrusted Markdown string, and only `https` links are shown.
  Evidence text (basis, path notes, verification steps) is also reduced to one line, with
  control, bidirectional, and zero-width characters shown as `<U+XXXX>`. The Findings view uses
  plain-text labels and tooltips. Evidence path steps link only to the scanned file or to files
  inside the scanned folder.
- **HTML report.** The report is shown in a webview with scripts, forms, and command links
  disabled, no local resource access, and a Content Security Policy that allows only inline
  styles and `data:` images. The temporary report file is deleted once read.
- **Installing the CLI.** Nothing is installed in Restricted Mode or without confirmation in a
  modal dialog. pipx and Python are looked up on PATH with the same rules as `nephilex`, and PATH
  entries inside a workspace folder are skipped even in a trusted workspace. **Run in Terminal**
  spawns the installer with an argument array and no shell, from an extension-private working
  directory, with output and runtime capped. Python 3.11 and later start with `-P`; on 3.10, `-I`
  is used inside a virtual environment (outside one it would disable the user site that
  `pip install --user` needs). **Type in Terminal** types the command into a terminal that also
  starts in the private directory; you press Enter. Settings change only when you agree.

## How scans run

- If the CLI provides `nephilex check FILE --format json`, a saved file is checked in place.
- Otherwise (current releases), the file content is written to a private temporary directory and
  scanned there with `nephilex scan FILE -f json`, because `nephilex scan` on a file also scans the
  rest of its directory. The workspace `.nephilex.yml`, if present, is passed with `--config`.
- Unsaved content (on-type scans) always uses the temporary copy.
- **Nephilex: Scan Workspace** runs `nephilex scan FOLDER -f json` for each workspace folder.
- **Scan with Nephilex** on a folder runs `nephilex scan FOLDER -f json` for that folder; when the
  folder is below a workspace root, the root's `.nephilex.yml` is passed with `--config`.

## MCP

On VS Code 1.101 and later the server is registered automatically while the workspace is trusted
and `nephilex.mcp.enabled` is on. The server runs `nephilex mcp` with `NEPHILEX_MCP_ROOTS` set to the
workspace folders, so it only scans inside them.

For editors without the API, add the server by hand. VS Code (`.vscode/mcp.json`):

```json
{
  "servers": {
    "nephilex": {
      "type": "stdio",
      "command": "nephilex",
      "args": ["mcp"]
    }
  }
}
```

Cursor (`.cursor/mcp.json`) and most other clients use the `mcpServers` key:

```json
{
  "mcpServers": {
    "nephilex": {
      "command": "nephilex",
      "args": ["mcp"]
    }
  }
}
```

## Editors other than VS Code

The extension uses only the stable, open-source `vscode` API, and the MCP API is feature detected,
so it works in Cursor, Windsurf, VSCodium, and other forks. Those editors install extensions from
[Open VSX](https://open-vsx.org/), so releases are published there as well as on the Visual Studio
Marketplace.

## Development

```sh
npm ci
npm run lint
npm run test:unit
npm run test:integration   # downloads VS Code; set NEPHILEX_TEST_EXECUTABLE to run the end-to-end tests
npm run package            # builds nephilex-<version>.vsix
```

See `CONTRIBUTING.md` in the repository.

### Renaming

The marketplace identity lives only in `package.json`: `name`, `publisher`, and `displayName`.
The settings section (`nephilex.*`), command ids, and the diagnostic source are defined in
`src/constants.ts` and are independent of the extension name. When `name` or `publisher` changes,
update `EXTENSION_ID` in `test/integration/suite/extension.test.ts`.

## License

Apache-2.0. See `LICENSE`.
