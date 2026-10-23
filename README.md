# Nephilex for VS Code

Application security for code, dependencies, secrets, infrastructure as code, and AI/LLM apps,
in the editor. The extension shows findings from [Nephilex](https://github.com/nephilex/nephilex),
the open-source security scanner (`nephilex` on PyPI): SAST and taint analysis, hardcoded
secrets, vulnerable dependencies, infrastructure as code, CI/CD, and LLM application checks.
Documentation: <https://nephilex.github.io/nephilex/>.

The extension is a thin client. All analysis is done by the `nephilex` CLI on your machine; the
extension makes no network requests of its own.

## Features

- **Diagnostics.** Findings appear in the Problems panel and as squiggles. Critical and high are
  errors, medium is a warning, low and info are information. The diagnostic code is the rule id
  and links to the rule documentation; the message includes the CWE and OWASP mappings.
- **Scan on save, on type, or on demand.** `nephilex.run` selects `onSave` (default), `onType`
  (debounced), or `off`. The **Nephilex: Scan Workspace** and **Nephilex: Scan Current File** commands
  run a scan at any time.
- **Hover.** Why the code is vulnerable, the attacker perspective, impact, and fix guidance.
- **Quick fixes.** **Apply Nephilex fix** appears when the CLI produced a deterministic fix that it
  re-scanned and verified. **Ignore with reason** is always offered and appends a
  `nephilex-ignore` comment with the reason you enter, for example
  `# nephilex-ignore: patterns.python-shell-true reason="command is a constant"`. For file types
  without `#` or `//` comments (such as JSON) a `.nephilex.yml` allow entry is copied to the
  clipboard instead.
- **Status bar.** The number of critical and high findings in the workspace. Clicking it opens
  the Problems view with focus in the filter box; type `Nephilex` to show only Nephilex findings (the
  editor API offers no way to set the filter text).
- **MCP server for agent mode.** On editors that support the MCP server definition API
  (VS Code 1.101 and later), the extension registers `nephilex mcp` so agents can call the
  `nephilex_scan` tool. See the MCP section below for other editors.

Screenshot placeholders (to be added with branding):

1. Problems panel listing Nephilex findings with rule ids and CWE tags.
2. Hover over an unsafe `yaml.load` call showing reasoning and fix guidance.
3. Quick fix menu with "Apply Nephilex fix" and "Ignore with reason".
4. Status bar item showing the critical and high count.

## Requirements

- The Nephilex CLI 0.10.0 or later: `pip install nephilex` (or `pipx install nephilex`).
  Earlier versions do not attach fixes to `nephilex check`, so "Apply Nephilex fix" is not offered.
- VS Code 1.93 or later, or a compatible editor (Cursor, Windsurf, VSCodium, and other forks).

If the CLI is not found, the extension shows a message with an **Install Nephilex** link and the
install command.

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

## How scans run

- If the CLI provides `nephilex check FILE --format json`, a saved file is checked in place.
- Otherwise (current releases), the file content is written to a private temporary directory and
  scanned there with `nephilex scan FILE -f json`, because `nephilex scan` on a file also scans the
  rest of its directory. The workspace `.nephilex.yml`, if present, is passed with `--config`.
- Unsaved content (on-type scans) always uses the temporary copy.
- **Nephilex: Scan Workspace** runs `nephilex scan FOLDER -f json` for each workspace folder.

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
