/**
 * Identifiers used across the extension. The marketplace name, publisher, and
 * display name live only in package.json, so renaming the extension does not
 * require code changes. The settings section and command prefix stay `argus`.
 */
export const CONFIG_SECTION = 'argus';
export const DIAGNOSTIC_SOURCE = 'Argus';
export const MCP_PROVIDER_ID = 'argus.mcpServer';
export const INSTALL_URL = 'https://pypi.org/project/argus-appsec/';
export const INSTALL_COMMAND = 'pip install argus-appsec';

export const Commands = {
  scanWorkspace: 'argus.scanWorkspace',
  scanFile: 'argus.scanFile',
  clearFindings: 'argus.clearFindings',
  showProblems: 'argus.showProblems',
  showLog: 'argus.showLog',
  ignoreFinding: 'argus.ignoreFinding',
  // Internal (not contributed): shows install instructions.
  installHelp: 'argus.installHelp',
} as const;
