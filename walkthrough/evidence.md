# Read a finding and its evidence

Hover over a squiggle, or click a finding in the Nephilex view to open it. The hover shows:

- **Evidence grade** (Nephilex CLI 0.12.0 and later): how strong the proof is.
  - `confirmed`: the tool proved it, for example a live secret or an exact vulnerable version in a
    lock file.
  - `likely`: attacker-controlled data reaches a dangerous call with no recognized sanitizer, or
    a precise, high-confidence rule matched the exact code.
  - `possible`: a pattern or heuristic match; read the code to decide.
- **Basis**: the one sentence the grade rests on.
- **Path**: the steps from where the data comes from (source) to where it is used (sink), each
  with its file and line.
- **How to verify**: a few plain steps to confirm or rule out the finding.
- Why the code is vulnerable, the attacker perspective, the impact, and how to fix it.

In the Problems panel, expand a finding to see the same path as clickable steps.

The grade is also the prefix of the problem message, for example `[likely]`. Use the filter
button in the Nephilex view to show only likely or confirmed findings.

Older CLI versions (0.11.0 and before) do not report evidence. Everything else works the same;
the grade, path and verification steps are simply not shown.

More about grades: <https://nephilex.github.io/nephilex/evidence/>
