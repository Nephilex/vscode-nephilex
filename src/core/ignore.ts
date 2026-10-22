/**
 * Inline suppression comments. The CLI honours, on the finding's own line:
 *
 *   code  # argus-ignore: <rule-id> reason="<why>"
 *   code  // argus-ignore: <rule-id> reason="<why>"
 *
 * (see `_INLINE_IGNORE` in argus/core/engine.py). The reason is required and
 * cannot contain quotes, so it is validated before insertion.
 */

export type CommentStyle = '#' | '//';

const HASH_LANGUAGES = new Set([
  'python',
  'yaml',
  'dockercompose',
  'shellscript',
  'dockerfile',
  'ruby',
  'perl',
  'r',
  'terraform',
  'hcl',
  'toml',
  'makefile',
  'powershell',
  'properties',
  'elixir',
  'coffeescript',
  'julia',
  'nim',
  'dotenv',
  'ignore',
  'cmake',
  'starlark',
  'bazel',
  'nix',
  'graphql',
  'crystal',
  'tcl',
]);

const SLASH_LANGUAGES = new Set([
  'javascript',
  'javascriptreact',
  'typescript',
  'typescriptreact',
  'java',
  'c',
  'cpp',
  'csharp',
  'go',
  'rust',
  'kotlin',
  'swift',
  'scala',
  'dart',
  'php',
  'groovy',
  'jsonc',
  'json5',
  'solidity',
  'fsharp',
  'objective-c',
  'objective-cpp',
  'vue',
  'svelte',
  'zig',
  'proto',
  'proto3',
  'hlsl',
  'glsl',
  'jenkinsfile',
]);

export function commentStyleFor(languageId: string): CommentStyle | undefined {
  if (HASH_LANGUAGES.has(languageId)) {
    return '#';
  }
  if (SLASH_LANGUAGES.has(languageId)) {
    return '//';
  }
  return undefined;
}

export const RULE_ID_PATTERN = /^[A-Za-z0-9_.-]+$/;

/** Returns an error message, or undefined when the reason is acceptable. */
export function validateReason(reason: string): string | undefined {
  const r = reason.trim();
  if (r.length < 3) {
    return 'Enter a reason of at least 3 characters.';
  }
  if (r.length > 200) {
    return 'Keep the reason under 200 characters.';
  }
  if (/["'\r\n]/.test(r)) {
    return 'The reason cannot contain quotes or line breaks.';
  }
  // Control characters would corrupt the source line.
  for (const ch of r) {
    const code = ch.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) {
      return 'The reason cannot contain control characters.';
    }
  }
  return undefined;
}

/** The text appended to the end of the finding's line. */
export function buildIgnoreSuffix(style: CommentStyle, ruleId: string, reason: string): string {
  if (!RULE_ID_PATTERN.test(ruleId)) {
    throw new Error(`Rule id "${ruleId}" cannot be used in an argus-ignore comment.`);
  }
  const err = validateReason(reason);
  if (err) {
    throw new Error(err);
  }
  return `  ${style} argus-ignore: ${ruleId} reason="${reason.trim()}"`;
}

export function lineHasIgnore(text: string): boolean {
  return /(?:#|\/\/)\s*argus-ignore/.test(text);
}

/**
 * A `.argus.yml` allow entry, for files where an inline comment is not
 * possible (JSON, file-level findings). Values are quoted for YAML.
 */
export function buildAllowEntry(ruleId: string, relPath: string, reason: string): string {
  const q = (s: string): string => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  return [
    'allow:',
    `  - rule: ${q(ruleId)}`,
    `    path: ${q(relPath.replace(/\\/g, '/'))}`,
    `    reason: ${q(reason.trim())}`,
    '',
  ].join('\n');
}
