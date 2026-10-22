/**
 * Registers `nephilex mcp` as an MCP server for agent mode.
 *
 * API verified against the official docs:
 *   https://code.visualstudio.com/api/extension-guides/ai/mcp
 *   https://code.visualstudio.com/api/references/vscode-api#lm (registerMcpServerDefinitionProvider)
 * The API is part of the stable `vscode` API (VS Code 1.101+), with the
 * `contributes.mcpServerDefinitionProviders` contribution point. This
 * extension supports older editors and forks (engines ^1.93), so the API is
 * feature detected at runtime and the types below mirror the stable
 * declarations in vscode.d.ts. Where the API is missing, users can add the
 * server by hand in .vscode/mcp.json (see README).
 */
import * as path from 'node:path';
import * as vscode from 'vscode';
import { NephilexCli } from './nephilexCli';
import { MCP_PROVIDER_ID } from './constants';
import { readSettings } from './settings';

interface McpStdioServerDefinitionLike {
  readonly label: string;
  cwd?: vscode.Uri;
  command: string;
  args: string[];
  env: Record<string, string | number | null>;
  version?: string;
}

type McpStdioServerDefinitionCtor = new (
  label: string,
  command: string,
  args?: string[],
  env?: Record<string, string | number | null>,
  version?: string,
) => McpStdioServerDefinitionLike;

interface McpServerDefinitionProviderLike {
  readonly onDidChangeMcpServerDefinitions?: vscode.Event<void>;
  provideMcpServerDefinitions(token: vscode.CancellationToken): vscode.ProviderResult<McpStdioServerDefinitionLike[]>;
  resolveMcpServerDefinition?(
    server: McpStdioServerDefinitionLike,
    token: vscode.CancellationToken,
  ): vscode.ProviderResult<McpStdioServerDefinitionLike>;
}

interface McpApi {
  lm?: {
    registerMcpServerDefinitionProvider?: (id: string, provider: McpServerDefinitionProviderLike) => vscode.Disposable;
  };
  McpStdioServerDefinition?: McpStdioServerDefinitionCtor;
}

export function isMcpApiAvailable(api: unknown = vscode): boolean {
  const a = api as McpApi;
  return (
    typeof a.lm?.registerMcpServerDefinitionProvider === 'function' && typeof a.McpStdioServerDefinition === 'function'
  );
}

/**
 * Returns a disposable for the registration plus a function to signal that
 * the definitions changed (settings, trust, or folders), or undefined when
 * the editor has no MCP server definition API.
 */
export function registerMcpProvider(
  cli: NephilexCli,
  log: vscode.LogOutputChannel,
): { disposable: vscode.Disposable; refresh: () => void } | undefined {
  const api = vscode as unknown as McpApi;
  const register = api.lm?.registerMcpServerDefinitionProvider;
  const Ctor = api.McpStdioServerDefinition;
  if (typeof register !== 'function' || typeof Ctor !== 'function') {
    log.info(
      'This editor has no MCP server definition API; configure .vscode/mcp.json by hand to use the Nephilex MCP server.',
    );
    return undefined;
  }
  const changed = new vscode.EventEmitter<void>();
  const provider: McpServerDefinitionProviderLike = {
    onDidChangeMcpServerDefinitions: changed.event,
    provideMcpServerDefinitions: async () => {
      const settings = readSettings();
      if (!settings.mcpEnabled || !vscode.workspace.isTrusted) {
        return [];
      }
      const folders = (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === 'file');
      if (folders.length === 0) {
        return [];
      }
      const prep = await cli.prepare(settings);
      if (!prep.ok) {
        log.warn(`Nephilex MCP server not registered: ${prep.message}`);
        return [];
      }
      const env: Record<string, string> = {
        // The server only scans inside these roots (see nephilex/mcp/server.py).
        NEPHILEX_MCP_ROOTS: folders.map((f) => f.uri.fsPath).join(path.delimiter),
        NO_COLOR: '1',
        PYTHONIOENCODING: 'utf-8',
        PYTHONSAFEPATH: '1',
      };
      const def = new Ctor(
        'nephilex',
        prep.cli.resolved.command,
        [...prep.cli.prefix, 'mcp'],
        env,
        prep.cli.caps.version || undefined,
      );
      def.cwd = folders[0]?.uri;
      return [def];
    },
    resolveMcpServerDefinition: (server) => (vscode.workspace.isTrusted ? server : undefined),
  };
  const registration = register.call(api.lm, MCP_PROVIDER_ID, provider);
  log.info('Registered the Nephilex MCP server definition provider.');
  return {
    disposable: vscode.Disposable.from(registration, changed),
    refresh: () => changed.fire(),
  };
}
