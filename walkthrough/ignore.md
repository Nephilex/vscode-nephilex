# Ignore a false positive with a reason

When you have checked a finding and it is not a real problem, suppress it with a reason:

- Use the **Ignore with reason** quick fix on the problem (light bulb, or `Ctrl+.` / `Cmd+.`), or
- Right-click the finding in the Nephilex view and choose **Ignore with Reason...**.

Enter why the finding is acceptable. The extension appends a comment to the line, for example:

```python
subprocess.run(cmd, shell=True)  # nephilex-ignore: patterns.python-shell-true reason="command is a constant"
```

The reason is required and is kept next to the code, so reviewers can see why the finding was
accepted. For file types without `#` or `//` comments (such as JSON), an allow entry for
`.nephilex.yml` is copied to the clipboard instead.

Ignore findings only after checking them. A suppression hides the finding from every later scan,
including CI.
