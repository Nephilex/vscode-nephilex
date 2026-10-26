import * as vscode from 'vscode';
import { Commands } from './constants';
import { countsSentence, severityCounts, statusSummary } from './core/tree';
import { FindingStore } from './findingStore';

export type CliState = 'unknown' | 'ready' | 'missing' | 'untrusted';

export class NephilexStatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem('nephilex.status', vscode.StatusBarAlignment.Left, 50);
  private busy = false;
  private cli: CliState = 'unknown';

  constructor(private readonly store: FindingStore) {
    this.item.name = 'Nephilex';
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
    const counts = severityCounts(this.store.entries().flatMap((e) => e.items.map((i) => i.finding)));
    this.item.backgroundColor = undefined;
    if (this.cli === 'untrusted') {
      this.item.text = '$(shield) Nephilex: restricted';
      this.item.tooltip = 'Nephilex does not run in Restricted Mode. Trust this workspace to enable scanning.';
      this.item.command = 'workbench.trust.manage';
      return;
    }
    if (this.cli === 'missing') {
      this.item.text = '$(shield) Nephilex: CLI not found';
      this.item.tooltip = 'The nephilex CLI was not found. Click for install instructions.';
      this.item.command = Commands.installHelp;
      return;
    }
    if (this.busy) {
      this.item.text = '$(sync~spin) Nephilex: scanning';
      this.item.tooltip = 'Nephilex is scanning. Click to show the findings.';
    } else {
      this.item.text = `$(shield) Nephilex: ${statusSummary(counts)}`;
      this.item.tooltip = `Nephilex: ${countsSentence(counts)}. Click to show the findings.`;
    }
    this.item.command = Commands.showFindings;
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
 * API to set the filter text, so the user types "Nephilex" (the diagnostic
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
  void vscode.window.setStatusBarMessage(
    'Type "Nephilex" in the Problems filter to show only Nephilex findings.',
    8000,
  );
}
