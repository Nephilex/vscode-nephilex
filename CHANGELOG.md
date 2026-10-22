# Changelog

All notable changes to this extension are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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
