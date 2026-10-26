/**
 * The Findings view in the Nephilex activity bar container. The model
 * (grouping, counts, filters) lives in core/tree.ts; this file turns it into
 * TreeItems and handles the view's commands.
 *
 * Labels, descriptions, and tooltips are plain strings (never Markdown), so
 * report text cannot add links or markup to the view.
 */
import * as vscode from 'vscode';
import { IgnoreArgs, ignoreFinding } from './codeActions';
import { ContextKeys, FINDINGS_VIEW } from './constants';
import { docsUrl } from './core/mapping';
import { SEVERITY_NAMES, SeverityLevel, SeverityName } from './core/report';
import {
  buildTree,
  DEFAULT_FILTER,
  FindingEntry,
  FindingNode,
  filterMessage,
  GRADE_FILTERS,
  GradeFilter,
  GroupBy,
  isDefaultFilter,
  TreeFilter,
  TreeModel,
  TreeNode,
} from './core/tree';
import { FindingStore, StoredFinding } from './findingStore';

export interface FindingRef {
  uri: vscode.Uri;
  stored: StoredFinding;
}

type Node = TreeNode<FindingRef>;

const STATE_FILTER = 'nephilex.view.filter';
const STATE_GROUP = 'nephilex.view.groupBy';

function severityIcon(level: SeverityLevel): vscode.ThemeIcon {
  if (level >= 3) {
    return new vscode.ThemeIcon('error', new vscode.ThemeColor('problemsErrorIcon.foreground'));
  }
  if (level === 2) {
    return new vscode.ThemeIcon('warning', new vscode.ThemeColor('problemsWarningIcon.foreground'));
  }
  return new vscode.ThemeIcon('info', new vscode.ThemeColor('problemsInfoIcon.foreground'));
}

function readFilter(v: unknown): TreeFilter {
  if (typeof v !== 'object' || v === null) {
    return DEFAULT_FILTER;
  }
  const o = v as Record<string, unknown>;
  const min = (SEVERITY_NAMES as readonly unknown[]).includes(o['minSeverity'])
    ? (o['minSeverity'] as SeverityName)
    : DEFAULT_FILTER.minSeverity;
  const grade = (GRADE_FILTERS as readonly unknown[]).includes(o['grade'])
    ? (o['grade'] as GradeFilter)
    : DEFAULT_FILTER.grade;
  return { minSeverity: min, grade };
}

export function isFindingNode(v: unknown): v is FindingNode<FindingRef> {
  if (typeof v !== 'object' || v === null) {
    return false;
  }
  const n = v as Partial<FindingNode<FindingRef>>;
  return n.kind === 'finding' && n.entry?.ref.uri instanceof vscode.Uri && n.entry.ref.stored !== undefined;
}

export class FindingsView implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly view: vscode.TreeView<Node>;
  private readonly disposables: vscode.Disposable[] = [];
  private filter: TreeFilter;
  private groupBy: GroupBy;
  private model: TreeModel<FindingRef> = { roots: [], shown: 0, hidden: 0 };

  constructor(
    private readonly store: FindingStore,
    private readonly state: vscode.Memento,
  ) {
    this.filter = readFilter(state.get(STATE_FILTER));
    this.groupBy = state.get(STATE_GROUP) === 'file' ? 'file' : 'severity';
    this.view = vscode.window.createTreeView(FINDINGS_VIEW, { treeDataProvider: this, showCollapseAll: true });
    this.disposables.push(
      this.view,
      this.changed,
      store.onDidChange(() => this.rebuild()),
    );
    this.rebuild();
  }

  get onDidChangeVisibility(): vscode.Event<vscode.TreeViewVisibilityChangeEvent> {
    return this.view.onDidChangeVisibility;
  }

  get visible(): boolean {
    return this.view.visible;
  }

  private rebuild(): void {
    const entries: FindingEntry<FindingRef>[] = [];
    for (const { uri, items } of this.store.entries()) {
      const fileLabel = vscode.workspace.asRelativePath(uri, true);
      for (const stored of items) {
        entries.push({
          fileKey: uri.toString(),
          fileLabel,
          finding: stored.finding,
          line: stored.diagnostic.range.start.line,
          character: stored.diagnostic.range.start.character,
          ref: { uri, stored },
        });
      }
    }
    this.model = buildTree(entries, this.filter, this.groupBy);
    this.view.message = filterMessage(this.filter, this.model.hidden);
    const total = this.model.shown + this.model.hidden;
    this.view.badge = this.model.shown
      ? { value: this.model.shown, tooltip: `${this.model.shown} Nephilex finding(s)` }
      : undefined;
    void vscode.commands.executeCommand('setContext', ContextKeys.hasFindings, total > 0);
    void vscode.commands.executeCommand('setContext', ContextKeys.filtered, !isDefaultFilter(this.filter));
    void vscode.commands.executeCommand('setContext', ContextKeys.groupBy, this.groupBy);
    this.changed.fire(undefined);
  }

  getChildren(node?: Node): Node[] {
    if (!node) {
      return this.model.roots;
    }
    return node.kind === 'finding' ? [] : node.children;
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === 'severity') {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
      item.id = node.id;
      item.description = String(node.count);
      item.iconPath = severityIcon(node.severity);
      item.contextValue = 'nephilex.severity';
      return item;
    }
    if (node.kind === 'file') {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
      item.id = node.id;
      item.description = String(node.count);
      const uri = node.children[0]?.entry.ref.uri;
      if (uri) {
        item.resourceUri = uri;
        item.iconPath = vscode.ThemeIcon.File;
      }
      item.contextValue = 'nephilex.file';
      return item;
    }
    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
    item.id = node.id;
    item.description = node.description;
    item.tooltip = node.tooltip;
    item.iconPath = severityIcon(node.entry.finding.severity);
    item.contextValue = 'nephilex.finding';
    item.command = { command: 'nephilex.openFinding', title: 'Open', arguments: [node] };
    return item;
  }

  async setFilter(filter: TreeFilter): Promise<void> {
    this.filter = filter;
    await this.state.update(STATE_FILTER, filter);
    this.rebuild();
  }

  async setGroupBy(groupBy: GroupBy): Promise<void> {
    this.groupBy = groupBy;
    await this.state.update(STATE_GROUP, groupBy);
    this.rebuild();
  }

  /** Quick pick for the minimum severity and the evidence grade shown in the view. */
  async pickFilter(): Promise<void> {
    type Item = vscode.QuickPickItem & { apply?: TreeFilter };
    const current = (on: boolean): string => (on ? 'current' : '');
    const items: Item[] = [{ label: 'Minimum severity', kind: vscode.QuickPickItemKind.Separator }];
    for (const name of [...SEVERITY_NAMES].reverse()) {
      items.push({
        label: name === 'info' ? 'All severities' : name === 'critical' ? 'Critical only' : `${name} and above`,
        description: current(this.filter.minSeverity === name),
        apply: { ...this.filter, minSeverity: name },
      });
    }
    items.push({ label: 'Evidence grade', kind: vscode.QuickPickItemKind.Separator });
    const grades: [GradeFilter, string][] = [
      ['all', 'All grades'],
      ['likely', 'Likely or confirmed'],
      ['confirmed', 'Confirmed only'],
    ];
    for (const [grade, label] of grades) {
      items.push({
        label,
        description: current(this.filter.grade === grade),
        detail: grade === 'all' ? undefined : 'Grades need Nephilex CLI 0.12.0 or later; ungraded findings are hidden.',
        apply: { ...this.filter, grade },
      });
    }
    const pick = await vscode.window.showQuickPick(items, { title: 'Filter Nephilex Findings' });
    if (pick?.apply) {
      await this.setFilter(pick.apply);
    }
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

/** Open the finding's location in an editor. */
export async function openFinding(node: unknown): Promise<vscode.TextEditor | undefined> {
  if (!isFindingNode(node)) {
    return undefined;
  }
  const { uri, stored } = node.entry.ref;
  try {
    return await vscode.window.showTextDocument(uri, { selection: stored.diagnostic.range, preview: true });
  } catch {
    void vscode.window.showWarningMessage('The file of this finding can no longer be opened.');
    return undefined;
  }
}

/** Open the finding, then run the same "Ignore with reason" flow as the quick fix. */
export async function ignoreFromView(store: FindingStore, node: unknown): Promise<void> {
  if (!isFindingNode(node)) {
    return;
  }
  if (!(await openFinding(node))) {
    return;
  }
  const { uri, stored } = node.entry.ref;
  const args: IgnoreArgs = {
    uri: uri.toString(),
    ruleId: stored.finding.ruleId,
    line: stored.diagnostic.range.start.line,
    character: stored.diagnostic.range.start.character,
  };
  await ignoreFinding(store, args);
}

export async function copyRuleId(node: unknown): Promise<void> {
  if (isFindingNode(node)) {
    await vscode.env.clipboard.writeText(node.entry.finding.ruleId);
    void vscode.window.setStatusBarMessage(`Copied ${node.entry.finding.ruleId}`, 3000);
  }
}

/** Open the rule documentation; docsUrl only ever returns an https URL. */
export async function openRuleDocs(node: unknown): Promise<void> {
  if (isFindingNode(node)) {
    await vscode.env.openExternal(vscode.Uri.parse(docsUrl(node.entry.finding), true));
  }
}
