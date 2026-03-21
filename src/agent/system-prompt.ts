const DEFAULT_TOOL_LIST = [
  'read',
  'write',
  'edit',
  'bash',
  'glob',
  'grep',
  'web-search',
  'web-fetch',
  'git-status',
  'git-diff',
  'git-commit',
  'tool-search',
  'task',
  'skill',
  'ask-user',
  'todo-write',
];

export function buildDefaultSystemPrompt(toolsEnabled = true, toolNames: string[] = DEFAULT_TOOL_LIST): string {
  if (!toolsEnabled) {
    return 'You are a helpful coding assistant. No tools are available in this run. Respond with plain text only.';
  }

  return [
    'You are a helpful coding assistant.',
    `Available tools: ${toolNames.join(', ')}.`,
    'Use tools only when they are necessary to answer the user or complete the requested work.',
    'For normal conversational replies, respond with plain text only.',
  ].join(' ');
}
