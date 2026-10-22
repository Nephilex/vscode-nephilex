import * as path from 'node:path';
import * as vscode from 'vscode';
import { Commands } from './constants';
import { computeFix } from './core/fix';
import { buildAllowEntry, buildIgnoreSuffix, commentStyleFor, lineHasIgnore, validateReason } from './core/ignore';
import { documentLines, FindingStore, StoredFinding } from './findingStore';

export interface IgnoreArgs {
  uri: string;
  ruleId: string;
  line: number;
  /** Diagnostic range start, used to find the stored finding again. */
  character: number;
}

export class ArgusCodeActionProvider implements vscode.CodeActionProvider {
  static readonly kinds = [vscode.CodeActionKind.QuickFix];

  constructor(private readonly store: FindingStore) {}

  provideCodeActions(
    doc: vscode.TextDocument,
    _range: vscode.Range | vscode.Selection,
    ctx: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    for (const d of ctx.diagnostics) {
      const stored = this.store.match(doc.uri, d);
      if (!stored) {
        continue;
      }
      const f = stored.finding;
      const fix = computeFix(f, documentLines(doc));
      if (fix) {
        const action = new vscode.CodeAction('Apply Argus fix', vscode.CodeActionKind.QuickFix);
        const edit = new vscode.WorkspaceEdit();
        for (const r of fix) {
          edit.replace(doc.uri, doc.lineAt(r.line).range, r.newText);
        }
        action.edit = edit;
        action.diagnostics = [d];
        action.isPreferred = true;
        actions.push(action);
      }
      const ignore = new vscode.CodeAction(`Ignore ${f.ruleId} with reason`, vscode.CodeActionKind.QuickFix);
      const args: IgnoreArgs = {
        uri: doc.uri.toString(),
        ruleId: f.ruleId,
        line: d.range.start.line,
        character: d.range.start.character,
      };
      ignore.command = { command: Commands.ignoreFinding, title: ignore.title, arguments: [args] };
      ignore.diagnostics = [d];
      actions.push(ignore);
    }
    return actions;
  }
}

function isIgnoreArgs(v: unknown): v is IgnoreArgs {
  if (typeof v !== 'object' || v === null) {
    return false;
  }
  const o = v as Record<string, unknown>;
  return (
    typeof o['uri'] === 'string' &&
    typeof o['ruleId'] === 'string' &&
    typeof o['line'] === 'number' &&
    typeof o['character'] === 'number'
  );
}

/**
 * Prompt for a reason (required) and append an `argus-ignore` comment to the
 * finding's line. Where the language has no `#` or `//` comment, or the
 * finding is file-level, offer a `.argus.yml` allow entry instead.
 */
export async function ignoreFinding(store: FindingStore, raw: unknown): Promise<void> {
  if (!isIgnoreArgs(raw)) {
    void vscode.window.showInformationMessage('Use the "Ignore with reason" quick fix on an Argus problem.');
    return;
  }
  const uri = vscode.Uri.parse(raw.uri, true);
  const doc = await vscode.workspace.openTextDocument(uri);
  const stored: StoredFinding | undefined = store
    .get(uri)
    .find(
      (s) =>
        s.finding.ruleId === raw.ruleId &&
        s.diagnostic.range.start.line === raw.line &&
        s.diagnostic.range.start.character === raw.character,
    );
  const reason = await vscode.window.showInputBox({
    title: `Ignore ${raw.ruleId}`,
    prompt: 'Why is this finding acceptable? The reason is stored next to the suppression.',
    placeHolder: 'for example: input is a constant, not user controlled',
    ignoreFocusOut: true,
    validateInput: (v) => validateReason(v) ?? null,
  });
  if (reason === undefined) {
    return;
  }
  const style = commentStyleFor(doc.languageId);
  const fileLevel = stored?.finding.location.startLine === undefined && stored !== undefined;
  if (!style || fileLevel || raw.line >= doc.lineCount) {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    const rel = folder ? path.relative(folder.uri.fsPath, uri.fsPath) : path.basename(uri.fsPath);
    await vscode.env.clipboard.writeText(buildAllowEntry(raw.ruleId, rel, reason));
    void vscode.window.showInformationMessage(
      'This file type has no supported inline comment. An allow entry for .argus.yml was copied to the clipboard.',
    );
    return;
  }
  const line = doc.lineAt(raw.line);
  if (lineHasIgnore(line.text)) {
    void vscode.window.showWarningMessage('This line already has an argus-ignore comment. Edit it by hand.');
    return;
  }
  const suffix = buildIgnoreSuffix(style, raw.ruleId, reason);
  const end = line.text.replace(/\s+$/, '').length;
  const edit = new vscode.WorkspaceEdit();
  edit.replace(uri, new vscode.Range(raw.line, end, raw.line, line.text.length), suffix);
  if (await vscode.workspace.applyEdit(edit)) {
    if (stored) {
      store.remove(uri, stored);
    }
  }
}
