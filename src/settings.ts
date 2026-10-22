import * as vscode from 'vscode';
import { CONFIG_SECTION } from './constants';
import { SEVERITY_NAMES, SeverityName } from './core/report';

export type RunMode = 'off' | 'onSave' | 'onType';

export interface NephilexSettings {
  run: RunMode;
  debounceMs: number;
  executablePath: string;
  pythonPath: string;
  minSeverity: SeverityName;
  scanners: string[];
  extraArgs: string[];
  offlineEnrichment: boolean;
  timeoutMs: number;
  workspaceTimeoutMs: number;
  maxOutputBytes: number;
  mcpEnabled: boolean;
}

function clamp(n: unknown, min: number, max: number, fallback: number): number {
  return typeof n === 'number' && Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
}

/**
 * Read settings. `executablePath`, `pythonPath`, and `extraArgs` are listed in
 * `capabilities.untrustedWorkspaces.restrictedConfigurations`, so in Restricted
 * Mode the editor only returns their user-level values.
 */
export function readSettings(): NephilexSettings {
  const c = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const run = c.get<string>('run', 'onSave');
  const minSeverity = c.get<string>('minSeverity', 'low');
  return {
    run: run === 'off' || run === 'onType' ? run : 'onSave',
    debounceMs: clamp(c.get('debounceMs'), 200, 10_000, 800),
    executablePath: c.get<string>('executablePath', '') ?? '',
    pythonPath: c.get<string>('pythonPath', '') ?? '',
    minSeverity: (SEVERITY_NAMES as readonly string[]).includes(minSeverity) ? (minSeverity as SeverityName) : 'low',
    scanners: strings(c.get('scanners')),
    extraArgs: strings(c.get('extraArgs')),
    offlineEnrichment: c.get<boolean>('offlineEnrichment', true),
    timeoutMs: clamp(c.get('timeoutSeconds'), 5, 3600, 60) * 1000,
    workspaceTimeoutMs: clamp(c.get('workspaceTimeoutSeconds'), 30, 21_600, 900) * 1000,
    maxOutputBytes: clamp(c.get('maxOutputMB'), 1, 512, 64) * 1024 * 1024,
    mcpEnabled: c.get<boolean>('mcp.enabled', true),
  };
}
