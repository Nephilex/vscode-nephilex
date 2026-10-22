# Argus Security for VS Code

Shows findings from [Argus](https://github.com/Argus-CodeSecurity/Argus-appsec), the open-source
security scanner (`argus-appsec` on PyPI), directly in the editor: SAST and taint analysis,
hardcoded secrets, vulnerable dependencies, infrastructure as code, CI/CD, and LLM application
checks.

The extension is a thin client. All analysis is done by the `argus` CLI on your machine; the
extension makes no network requests of its own.

## Features

- **Diagnostics.** Findings appear in the Problems panel and as squiggles. Critical and high are
  errors, medium is a warning, low and info are information. The diagnostic code is the rule id
  and links to the rule documentation; the message includes the CWE and OWASP mappings.
- **Scan on save, on type, or on demand.** `argus.run` selects `onSave` (default), `onType`
  (debounced), or `off`. The **Argus: Scan Workspace** and **Argus: Scan Current File** commands
  run a scan at any time.
- **Hover.** Why the code is vulnerable, the attacker perspective, impact, and fix guidance.
- **Quick fixes.** **Apply Argus fix** appears when the CLI produced a deterministic fix that it
  re-scanned and verified. **Ignore with reason** is always offered and appends an
  `argus-ignore` comment with the reason you enter, for example
  `# argus-ignore: patterns.python-shell-true reason="command is a constant"`. For file types
  without `#` or `//` comments (such as JSON) an `.argus.yml` allow entry is copied to the
  clipboard instead.
- **Status bar.** The number of critical and high findings in the workspace. Clicking it opens
  the Problems view with focus in the filter box; type `Argus` to show only Argus findings (the
  editor API offers no way to set the filter text).
- **MCP server for agent mode.** On editors that support the MCP server definition API
  (VS Code 1.101 and later), the extension registers `argus mcp` so agents can call the
  `argus_scan` tool. See the MCP section below for other editors.

Screenshot placeholders (to be added with branding):

1. Problems panel listing Argus findings with rule ids and CWE tags.
2. Hover over an unsafe `yaml.load` call showing reasoning and fix guidance.
3. Quick fix menu with "Apply Argus fix" and "Ignore with reason".
4. Status bar item showing the critical and high count.

## Requirements

- The Argus CLI: `pip install argus-appsec` (or `pipx install argus-appsec`). Tested with
  Argus 0.9.2.
- VS Code 1.93 or later, or a compatible editor (Cursor, Windsurf, VSCodium, and other forks).

If the CLI is not found, the extension shows a message with an **Install Argus** link and the
install command.

## Settings

| Setting                         | Default  | Description                                                                                                         |
| ------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------- |
| `argus.run`                     | `onSave` | `off`, `onSave`, or `onType`.                                                                                       |
| `argus.debounceMs`              | `800`    | Pause after the last edit before an on-type scan.                                                                   |
| `argus.executablePath`          | empty    | Absolute path to `argus`. Empty searches PATH. User settings only.                                                  |
| `argus.pythonPath`              | empty    | Python interpreter with `argus-appsec` installed; runs `python -m argus`. Takes precedence. User settings only.     |
| `argus.minSeverity`             | `low`    | Hide findings below this severity.                                                                                  |
| `argus.scanners`                | `[]`     | Scanners to run (`argus scanners` lists them). Empty runs the CLI default.                                          |
| `argus.extraArgs`               | `[]`     | Extra CLI arguments, one per item. `-f`, `--format`, `-o`, and `--output` are managed by the extension and dropped. |
| `argus.offlineEnrichment`       | `true`   | Passes `--ai-provider heuristic --patches` for offline reasoning and verified fixes. When false, passes `--no-ai`.  |
| `argus.timeoutSeconds`          | `60`     | Fail-safe timeout for a file scan.                                                                                  |
| `argus.workspaceTimeoutSeconds` | `900`    | Fail-safe timeout for a workspace scan.                                                                             |
| `argus.maxOutputMB`             | `64`     | Maximum CLI output read; larger output aborts the scan.                                                             |
| `argus.mcp.enabled`             | `true`   | Register the Argus MCP server where the editor supports it.                                                         |

## Security model

- **Workspace Trust.** In Restricted Mode the extension runs nothing, neither automatically nor
  from commands, and registers no MCP server. `argus.executablePath`, `argus.pythonPath`, and
  `argus.extraArgs` are restricted settings, so a workspace cannot set them until it is trusted;
  the two path settings are also machine scoped and can only be set in user settings.
- **No workspace binaries without trust.** The extension resolves `argus` on PATH itself and
  spawns the absolute path, skipping relative PATH entries. This avoids the Windows behavior of
  running a program from the current directory first. In an untrusted workspace any candidate
  inside a workspace folder is rejected. Batch files are refused on Windows.
- **Python form.** `python -m argus` is started with `-P` (Python 3.11 and later) or `-I`, so
  modules in the workspace cannot shadow Argus.
- **Process handling.** The CLI is spawned with an argument array and `shell: false`, targets
  follow `--`, and file contents are never put on the command line. Unsaved content is written
  to a private temporary directory, scanned, and deleted. Output size and runtime are capped and
  the process tree is killed when a limit is reached.
- **Untrusted report content.** Finding text comes from scanning workspace files, so hovers
  insert it as escaped text in an untrusted Markdown string, and only `https` links are shown.

## How scans run

- If the CLI provides `argus check FILE --format json`, a saved file is checked in place.
- Otherwise (current releases), the file content is written to a private temporary directory and
  scanned there with `argus scan FILE -f json`, because `argus scan` on a file also scans the
  rest of its directory. The workspace `.argus.yml`, if present, is passed with `--config`.
- Unsaved content (on-type scans) always uses the temporary copy.
- **Argus: Scan Workspace** runs `argus scan FOLDER -f json` for each workspace folder.

## MCP

On VS Code 1.101 and later the server is registered automatically while the workspace is trusted
and `argus.mcp.enabled` is on. The server runs `argus mcp` with `ARGUS_MCP_ROOTS` set to the
workspace folders, so it only scans inside them.

For editors without the API, add the server by hand. VS Code (`.vscode/mcp.json`):

```json
{
  "servers": {
    "argus": {
      "type": "stdio",
      "command": "argus",
      "args": ["mcp"]
    }
  }
}
```

Cursor (`.cursor/mcp.json`) and most other clients use the `mcpServers` key:

```json
{
  "mcpServers": {
    "argus": {
      "command": "argus",
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
npm run test:integration   # downloads VS Code; set ARGUS_TEST_EXECUTABLE to run the end-to-end tests
npm run package            # builds argus-security-<version>.vsix
```

See `CONTRIBUTING.md` in the repository.

### Renaming

The marketplace identity lives only in `package.json`: `name`, `publisher`, and `displayName`.
The settings section (`argus.*`), command ids, and the diagnostic source are defined in
`src/constants.ts` and are independent of the extension name. When `name` or `publisher` changes,
update `EXTENSION_ID` in `test/integration/suite/extension.test.ts`.

## License

Apache-2.0. See `LICENSE`.
