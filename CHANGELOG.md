# Changelog

All notable changes to this extension are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0]

### Added

- Evidence from the Nephilex CLI 0.12.0 and later: the hover starts with the evidence grade
  (confirmed, likely, possible) and its basis, then the data-flow path and the verification steps.
  Each path step is related information on the diagnostic, so the Problems panel shows a
  clickable trace, and the message starts with the grade, for example `[likely]`. Reports without
  evidence (CLI 0.11.0 and older) are shown as before.
- A Nephilex activity bar container with a Findings view: grouped by severity with counts and
  then by file, or by file alone; filters for minimum severity and evidence grade; Scan
  Workspace, Refresh, Clear, and Group by in the toolbar; Open, Ignore with Reason, Copy Rule ID,
  and Open Rule Documentation on each finding; welcome content for Restricted Mode, a missing
  CLI, and an empty result.
- Install Nephilex: finds pipx, the interpreter selected in the Python extension, or Python on
  PATH, asks for confirmation in a modal dialog, and runs the install in a terminal or types it
  there for you. Afterwards it checks for the CLI again and offers to set `nephilex.pythonPath`
  or `nephilex.executablePath`. Nothing is installed in Restricted Mode.
- Scan with Nephilex in the Explorer context menu for files and folders.
- A shield button in the editor title for Scan Current File (`nephilex.showScanButton`).
- Open HTML Report: shows `nephilex scan -f html` output in a webview with scripts disabled and a
  strict Content Security Policy.
- A getting started walkthrough.

### Changed

- The status bar shows a spinner while scanning and the counts by severity afterwards, and opens
  the Findings view when clicked.
- The suggested install command is `pipx install "nephilex[ast]"` or
  `python -m pip install --user "nephilex[ast]"`.
- Marketplace categories and keywords.

## [0.1.1]

### Changed

- The README states that the Nephilex CLI 0.10.0 or later is needed for "Apply Nephilex fix":
  earlier versions do not attach fixes to `nephilex check`.
- First release on Open VSX (Cursor, Windsurf, VSCodium) under the verified `nephilex` namespace.

## [0.1.0]

### Added

- Diagnostics from the Nephilex CLI with severity mapping, rule id codes linking to the docs, and
  CWE and OWASP in the message.
- Scan on save, on type (debounced), or on demand; Scan Workspace and Scan Current File commands.
- Hover with the reasoning, attacker perspective, impact, and fix guidance.
- Quick fixes: apply a verified deterministic fix, or ignore a finding with a required reason.
- Status bar count of critical and high findings.
- MCP server definition for agent mode on editors that support the API.
- Workspace Trust support: nothing runs in Restricted Mode.
