# Run a first scan

There are several ways to start a scan:

- **Nephilex: Scan Workspace** scans every workspace folder (`nephilex scan FOLDER`).
- **Scan with Nephilex** in the Explorer context menu scans the selected folders or files.
- The shield button in the editor title bar scans the current file. Hide it with
  `nephilex.showScanButton`.
- By default a file is scanned when you save it (`nephilex.run`: `onSave`). Use `onType` to scan
  while you type, or `off` to scan only on request.

Findings appear in three places:

- The **Nephilex** view in the activity bar, grouped by severity and then by file.
- The **Problems** panel, with the rule id linking to its documentation.
- Squiggles in the editor, with a hover that explains the finding.

The status bar shows a spinner while a scan runs, then the counts by severity, for example
`1C 3H 2M` for one critical, three high and two medium findings.

Nephilex finds many common problems, but no scanner finds every issue. Treat an empty result as
"nothing found by these checks", not as proof that the code is safe.
