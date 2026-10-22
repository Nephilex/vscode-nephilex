import * as vscode from 'vscode';
import { DIAGNOSTIC_SOURCE } from './constants';
import {
  computeRange,
  diagnosticLevel,
  diagnosticMessage,
  docsUrl,
  isCriticalOrHigh,
  isInside,
  LineSource,
} from './core/mapping';
import { NephilexFinding } from './core/report';

export interface StoredFinding {
  finding: NephilexFinding;
  diagnostic: vscode.Diagnostic;
}

const LEVELS = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  information: vscode.DiagnosticSeverity.Information,
} as const;

export function documentLines(doc: vscode.TextDocument): LineSource {
  return { lineCount: doc.lineCount, lineText: (i) => doc.lineAt(i).text };
}

export function textLines(text: string): LineSource {
  const lines = text.split(/\r?\n/);
  return { lineCount: lines.length, lineText: (i) => lines[i] ?? '' };
}

export function toDiagnostic(f: NephilexFinding, lines: LineSource): vscode.Diagnostic {
  const r = computeRange(f.location, lines);
  const range = new vscode.Range(r.startLine, r.startCharacter, r.endLine, r.endCharacter);
  const d = new vscode.Diagnostic(range, diagnosticMessage(f), LEVELS[diagnosticLevel(f.severity)]);
  d.source = DIAGNOSTIC_SOURCE;
  d.code = { value: f.ruleId, target: vscode.Uri.parse(docsUrl(f), true) };
  return d;
}

/** All Nephilex findings currently shown, keyed by file, mirrored into a DiagnosticCollection. */
export class FindingStore implements vscode.Disposable {
  private readonly byUri = new Map<string, { uri: vscode.Uri; items: StoredFinding[] }>();
  private readonly collection = vscode.languages.createDiagnosticCollection('nephilex');
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;

  set(uri: vscode.Uri, findings: NephilexFinding[], lines: LineSource): void {
    this.setItems(
      uri,
      findings.map((finding) => ({ finding, diagnostic: toDiagnostic(finding, lines) })),
    );
    this.changed.fire();
  }

  private setItems(uri: vscode.Uri, items: StoredFinding[]): void {
    const key = uri.toString();
    if (items.length === 0) {
      this.byUri.delete(key);
      this.collection.delete(uri);
    } else {
      this.byUri.set(key, { uri, items });
      this.collection.set(
        uri,
        items.map((i) => i.diagnostic),
      );
    }
  }

  /** Replace every file under `folder` with the given results (a workspace scan). */
  replaceFolder(folder: string, results: Map<string, { uri: vscode.Uri; items: StoredFinding[] }>): void {
    for (const [key, entry] of [...this.byUri]) {
      if (entry.uri.scheme === 'file' && isInside(entry.uri.fsPath, folder) && !results.has(key)) {
        this.byUri.delete(key);
        this.collection.delete(entry.uri);
      }
    }
    for (const entry of results.values()) {
      this.setItems(entry.uri, entry.items);
    }
    this.changed.fire();
  }

  get(uri: vscode.Uri): readonly StoredFinding[] {
    return this.byUri.get(uri.toString())?.items ?? [];
  }

  /** Match a diagnostic handed back by the editor (a copy) to its finding. */
  match(uri: vscode.Uri, d: vscode.Diagnostic): StoredFinding | undefined {
    if (d.source !== DIAGNOSTIC_SOURCE) {
      return undefined;
    }
    const code = typeof d.code === 'object' ? d.code.value : d.code;
    return this.get(uri).find((s) => s.diagnostic.range.isEqual(d.range) && s.finding.ruleId === code);
  }

  remove(uri: vscode.Uri, item: StoredFinding): void {
    this.setItems(
      uri,
      this.get(uri).filter((s) => s !== item),
    );
    this.changed.fire();
  }

  delete(uri: vscode.Uri): void {
    if (this.byUri.has(uri.toString())) {
      this.setItems(uri, []);
      this.changed.fire();
    }
  }

  clear(): void {
    this.byUri.clear();
    this.collection.clear();
    this.changed.fire();
  }

  countCriticalHigh(): number {
    let n = 0;
    for (const entry of this.byUri.values()) {
      n += entry.items.filter((i) => isCriticalOrHigh(i.finding)).length;
    }
    return n;
  }

  total(): number {
    let n = 0;
    for (const entry of this.byUri.values()) {
      n += entry.items.length;
    }
    return n;
  }

  dispose(): void {
    this.collection.dispose();
    this.changed.dispose();
  }
}
