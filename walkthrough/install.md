# Install the Nephilex CLI

The extension is a thin client. All analysis is done by `nephilex`, the open-source command line
scanner, running on your machine. It needs Python 3.10 or later.

**Install Nephilex** looks for these, in order, and lets you choose:

1. `pipx install "nephilex[ast]"` when pipx is on your PATH. pipx keeps Nephilex in its own
   environment, which is the cleanest option for a command line tool.
2. The Python interpreter selected in the Python extension, if you use it:
   `python -m pip install "nephilex[ast]"` (with `--user` outside a virtual environment).
3. Python on your PATH: `python -m pip install --user "nephilex[ast]"`.

Nothing runs until you confirm in a dialog. **Run in Terminal** starts the install and shows its
output; **Type in Terminal** only types the command, so you can review it and press Enter
yourself. Nothing is installed in Restricted Mode.

When the install finishes, the extension checks for the CLI again. If `nephilex` is not on the
PATH the editor sees, it offers to set `nephilex.pythonPath` or `nephilex.executablePath` for you,
and changes the setting only if you agree.

The `[ast]` extra adds the tree-sitter parsers for the deeper AST data-flow analysis of Python,
JavaScript and TypeScript. Without it, Nephilex falls back to its lighter code scanner.
