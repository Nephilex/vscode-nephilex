# Set up CI

Run the same scan on every pull request so findings are caught before they are merged. The CLI
writes SARIF for code scanning dashboards, JUnit for test reports, and can fail the build at a
severity you choose, for example:

```sh
nephilex scan . -f sarif -o nephilex.sarif --fail-on high
```

The CI/CD guide covers GitHub Actions, GitLab CI, and other systems, baselines so only new
findings fail a build, and how to keep a pull request from changing the settings it is checked
against:

<https://nephilex.github.io/nephilex/ci-cd/>

The `nephilex-ignore` comments and `.nephilex.yml` entries you add in the editor apply in CI too.
