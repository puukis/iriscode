import type { PermissionRequest, PermissionRule, ToolPattern } from './types.ts';

const INTERNAL_TO_DISPLAY_TOOL_NAMES: Record<string, string> = {
  'ask-user': 'AskUser',
  bash: 'Bash',
  edit: 'Edit',
  'git-commit': 'GitCommit',
  'git-diff': 'GitDiff',
  'git-status': 'GitStatus',
  glob: 'Glob',
  grep: 'Grep',
  read: 'Read',
  skill: 'Skill',
  task: 'Task',
  'todo-write': 'TodoWrite',
  'tool-search': 'ToolSearch',
  'web-fetch': 'WebFetch',
  'web-search': 'WebSearch',
  write: 'Write',
};

const DISPLAY_TO_INTERNAL_TOOL_NAMES = Object.fromEntries(
  Object.entries(INTERNAL_TO_DISPLAY_TOOL_NAMES).map(([internal, display]) => [display, internal]),
);

export function matchesToolPattern(request: PermissionRequest, pattern: ToolPattern): boolean {
  const claudePattern = parseClaudeStylePattern(pattern);
  if (claudePattern) {
    return matchesClaudeStylePattern(request, claudePattern.toolMatcher, claudePattern.argumentMatcher);
  }

  const [toolMatcher, inputMatcher] = splitPattern(pattern);
  if (!matchesToolName(request.toolName, toolMatcher)) {
    return false;
  }

  if (!inputMatcher) {
    return true;
  }

  const haystack = stringifyInput(request.input).toLowerCase();
  return haystack.includes(inputMatcher.toLowerCase());
}

export function findMatchingRule(
  rules: PermissionRule[],
  request: PermissionRequest,
  decision?: PermissionRule['decision'],
): PermissionRule | undefined {
  return rules.find((rule) => {
    if (decision && rule.decision !== decision) {
      return false;
    }
    return matchesToolPattern(request, rule.pattern);
  });
}

export function derivePersistentToolPattern(request: PermissionRequest): ToolPattern {
  const toolName = toDisplayToolName(request.toolName);
  const scopedValue = getScopedPatternValue(request);
  if (!scopedValue) {
    return toolName;
  }

  return `${toolName}(${scopedValue})`;
}

function splitPattern(pattern: ToolPattern): [string, string | undefined] {
  const colonIndex = pattern.indexOf(':');
  if (colonIndex === -1) {
    return [pattern.trim(), undefined];
  }

  return [
    pattern.slice(0, colonIndex).trim(),
    pattern.slice(colonIndex + 1).trim() || undefined,
  ];
}

function matchesToolName(toolName: string, toolMatcher: string): boolean {
  if (!toolMatcher) {
    return false;
  }

  const normalizedToolName = toInternalToolName(toolName);
  const normalizedMatcher = toInternalToolName(toolMatcher);

  if (toolMatcher.endsWith('*')) {
    return normalizedToolName.startsWith(normalizedMatcher.slice(0, -1));
  }

  return normalizedToolName === normalizedMatcher;
}

function stringifyInput(input: Record<string, unknown>): string {
  try {
    return JSON.stringify(input);
  } catch {
    return Object.values(input)
      .map((value) => String(value))
      .join(' ');
  }
}

function getScopedPatternValue(request: PermissionRequest): string | undefined {
  switch (toInternalToolName(request.toolName)) {
    case 'bash':
      return normalizePatternValue(request.input.command);
    case 'read':
    case 'write':
    case 'edit':
      return normalizePatternValue(request.input.path);
    case 'web-fetch':
      return normalizeUrlDomainPatternValue(request.input.url);
    case 'web-search':
      return undefined;
    case 'git-commit':
      return normalizePatternValue(request.input.message);
    case 'task':
      return normalizePatternValue(request.input.description);
    case 'skill':
      return normalizePatternValue(request.input.command ?? request.input.name);
    case 'ask-user':
      return normalizePatternValue(request.input.question);
    case 'glob':
      return normalizePatternValue(request.input.pattern);
    case 'grep':
      return normalizePatternValue(request.input.pattern);
    default:
      return undefined;
  }
}

function normalizePatternValue(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeUrlDomainPatternValue(value: unknown): string | undefined {
  const normalizedUrl = normalizePatternValue(value);
  if (!normalizedUrl) {
    return undefined;
  }

  try {
    const url = new URL(normalizedUrl);
    return `domain:${url.hostname}`;
  } catch {
    return normalizedUrl;
  }
}

function parseClaudeStylePattern(
  pattern: ToolPattern,
): { toolMatcher: string; argumentMatcher?: string } | null {
  const trimmed = pattern.trim();
  if (!trimmed) {
    return null;
  }

  const openIndex = trimmed.indexOf('(');
  if (openIndex === -1) {
    return null;
  }

  if (!trimmed.endsWith(')')) {
    return null;
  }

  const toolMatcher = trimmed.slice(0, openIndex).trim();
  if (!toolMatcher) {
    return null;
  }

  const argumentMatcher = trimmed.slice(openIndex + 1, -1).trim();
  return {
    toolMatcher,
    argumentMatcher: argumentMatcher || undefined,
  };
}

function matchesClaudeStylePattern(
  request: PermissionRequest,
  toolMatcher: string,
  argumentMatcher?: string,
): boolean {
  if (!matchesToolName(request.toolName, toolMatcher)) {
    return false;
  }

  if (!argumentMatcher) {
    return true;
  }

  if (toInternalToolName(request.toolName) === 'web-fetch' && argumentMatcher.startsWith('domain:')) {
    const domainPattern = argumentMatcher.slice('domain:'.length).trim();
    const hostname = extractUrlHostname(request.input.url);
    if (!hostname) {
      return false;
    }

    return matchesGlobExpression(hostname, domainPattern);
  }

  const subject = getPatternSubject(request);
  if (!subject) {
    return matchesGlobExpression(stringifyInput(request.input), argumentMatcher);
  }

  if (
    toInternalToolName(request.toolName) === 'bash'
    && argumentMatcher.includes(':')
    && matchesGlobExpression(subject, argumentMatcher.replace(/:/g, ' '))
  ) {
    return true;
  }

  return matchesGlobExpression(subject, argumentMatcher);
}

function getPatternSubject(request: PermissionRequest): string | undefined {
  switch (toInternalToolName(request.toolName)) {
    case 'bash':
      return normalizePatternValue(request.input.command);
    case 'read':
    case 'write':
    case 'edit':
      return normalizePatternValue(request.input.path);
    case 'glob':
      return normalizePatternValue(request.input.pattern);
    case 'grep':
      return normalizePatternValue(request.input.pattern);
    case 'web-fetch':
      return normalizePatternValue(request.input.url);
    case 'web-search':
      return normalizePatternValue(request.input.query);
    case 'git-commit':
      return normalizePatternValue(request.input.message);
    case 'task':
      return normalizePatternValue(request.input.description);
    case 'skill':
      return normalizePatternValue(request.input.command ?? request.input.name);
    case 'ask-user':
      return normalizePatternValue(request.input.question);
    default:
      return undefined;
  }
}

function matchesGlobExpression(value: string, pattern: string): boolean {
  const normalizedValue = value.trim();
  const normalizedPattern = pattern.trim();
  if (!normalizedPattern) {
    return false;
  }

  if (!normalizedPattern.includes('*')) {
    return normalizedValue === normalizedPattern;
  }

  const regex = new RegExp(`^${escapeRegExp(normalizedPattern).replace(/\\\*/g, '.*')}$`);
  return regex.test(normalizedValue);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractUrlHostname(value: unknown): string | undefined {
  const normalizedUrl = normalizePatternValue(value);
  if (!normalizedUrl) {
    return undefined;
  }

  try {
    return new URL(normalizedUrl).hostname;
  } catch {
    return undefined;
  }
}

function toInternalToolName(toolName: string): string {
  return DISPLAY_TO_INTERNAL_TOOL_NAMES[toolName] ?? toolName.trim();
}

function toDisplayToolName(toolName: string): string {
  return INTERNAL_TO_DISPLAY_TOOL_NAMES[toolName] ?? toolName.trim();
}
