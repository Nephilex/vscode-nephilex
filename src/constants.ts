/**
 * Identifiers used across the extension: the settings section, command ids,
 * diagnostic source, and MCP provider id. The marketplace name, publisher, and
 * display name live in package.json; contributed ids there must match these.
 */
export const CONFIG_SECTION = 'nephilex';
export const DIAGNOSTIC_SOURCE = 'Nephilex';
export const MCP_PROVIDER_ID = 'nephilex';
export const INSTALL_URL = 'https://pypi.org/project/nephilex/';
export const INSTALL_COMMAND = 'python -m pip install --user "nephilex[ast]"';
export const PYTHON_DOWNLOAD_URL = 'https://www.python.org/downloads/';

/** The Findings view in the Nephilex activity bar container. */
export const FINDINGS_VIEW = 'nephilex.findings';

export const Commands = {
  scanWorkspace: 'nephilex.scanWorkspace',
  scanFile: 'nephilex.scanFile',
  scanResource: 'nephilex.scanResource',
  clearFindings: 'nephilex.clearFindings',
  showProblems: 'nephilex.showProblems',
  showFindings: 'nephilex.showFindings',
  showLog: 'nephilex.showLog',
  ignoreFinding: 'nephilex.ignoreFinding',
  installCli: 'nephilex.installCli',
  openHtmlReport: 'nephilex.openHtmlReport',
  refresh: 'nephilex.refresh',
  filterFindings: 'nephilex.filterFindings',
  resetFilter: 'nephilex.resetFilter',
  groupBySeverity: 'nephilex.groupBySeverity',
  groupByFile: 'nephilex.groupByFile',
  // Findings view context menu (hidden from the Command Palette).
  openFinding: 'nephilex.openFinding',
  ignoreFromView: 'nephilex.ignoreFromView',
  copyRuleId: 'nephilex.copyRuleId',
  openRuleDocs: 'nephilex.openRuleDocs',
  // Internal (not contributed): checks the CLI and shows install help.
  installHelp: 'nephilex.installHelp',
} as const;

/** Context keys used in package.json `when` clauses. */
export const ContextKeys = {
  /** unknown | ready | missing | untrusted */
  cliState: 'nephilex.cliState',
  hasFindings: 'nephilex.hasFindings',
  scanned: 'nephilex.scanned',
  /** severity | file */
  groupBy: 'nephilex.groupBy',
  filtered: 'nephilex.filtered',
} as const;
