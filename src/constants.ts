/**
 * Identifiers used across the extension: the settings section, command ids,
 * diagnostic source, and MCP provider id. The marketplace name, publisher, and
 * display name live in package.json; contributed ids there must match these.
 */
export const CONFIG_SECTION = 'nephilex';
export const DIAGNOSTIC_SOURCE = 'Nephilex';
export const MCP_PROVIDER_ID = 'nephilex';
export const INSTALL_URL = 'https://pypi.org/project/nephilex/';
export const INSTALL_COMMAND = 'pip install nephilex';

export const Commands = {
  scanWorkspace: 'nephilex.scanWorkspace',
  scanFile: 'nephilex.scanFile',
  clearFindings: 'nephilex.clearFindings',
  showProblems: 'nephilex.showProblems',
  showLog: 'nephilex.showLog',
  ignoreFinding: 'nephilex.ignoreFinding',
  // Internal (not contributed): shows install instructions.
  installHelp: 'nephilex.installHelp',
} as const;
