import * as vscode from 'vscode';
import { Commands } from './constants';
import { FindingStore } from './findingStore';

export type CliState = 'unknown' | 'ready' | 'missing' | 'untrusted';

export class ArgusStatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem('argus.status', vscode.StatusBarAlignment.Left, 50);
  private busy = false;
  private cli: CliState = 'unknown';

  constructor(private readonly store: FindingStore) {
    this.item.name = 'Argus Security';
    this.update();
    this.item.show();
  }

  setBusy(busy: boolean): void {
    this.busy = busy;
    this.update();
  }

  setCliState(state: CliState): void {
    this.cli = state;
    this.update();
  }

  update(): void {
    const n = this.store.countCriticalHigh();
    const total = this.store.total();
    this.item.backgroundColor = undefined;
    if (this.cli === 'untrusted') {
      this.item.text = '$(shield) Argus: restricted';
      this.item.tooltip = 'Argus does not run in Restricted Mode. Trust this workspace to enable scanning.';
      this.item.command = 'workbench.trust.manage';
      return;
    }
    if (this.cli === 'missing') {
      this.item.text = '$(shield) Argus: CLI not found';
      this.item.tooltip = 'The argus CLI was not found. Click for install instructions.';
      this.item.command = Commands.installHelp;
      return;
    }
    this.item.text = `${this.busy ? '$(sync~spin)' : '$(shield)'} Argus: ${n}`;
    this.item.tooltip = `${n} critical or high finding(s), ${total} in total. Click to open the Problems view.`;
    this.item.command = Commands.showProblems;
    if (n > 0) {
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    }
  }

  dispose(): void {
    this.item.dispose();
  }
}

/**
 * Open the Problems view and put focus in its filter box. There is no public
 * API to set the filter text, so the user types "Argus" (the diagnostic
 * source) to narrow the list. Both commands are core workbench commands
 * shared by VS Code forks; failures are ignored.
 */
export async function showProblems(): Promise<void> {
  try {
    await vscode.commands.executeCommand('workbench.action.problems.focus');
  } catch {
    await vscode.commands.executeCommand('workbench.actions.view.problems').then(undefined, () => undefined);
  }
  await vscode.commands.executeCommand('problems.action.focusFilter').then(undefined, () => undefined);
  void vscode.window.setStatusBarMessage('Type "Argus" in the Problems filter to show only Argus findings.', 8000);
}
