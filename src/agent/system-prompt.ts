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
    'Decide autonomously whether a tool will help you answer the user or complete the requested work more effectively.',
    'Use tools proactively when they are useful, and rely on the tool descriptions to choose the right one.',
    'If you persist project-local assistant memory, preferences, or notes for later reuse, store them under .iris/ with a descriptive path such as .iris/memory/assistant-name.txt instead of inventing dotfiles in the project root.',
    'If the user already gives a path under .iris/, use that path exactly. Do not prepend another .iris/ segment.',
    'When saving a user or assistant fact to .iris/memory, write the fact in clear natural language so it can be reused later.',
    'Only create project-root files when the user explicitly asks for a user-facing project file there.',
    'If no tool is needed, respond directly in plain text.',
  ].join(' ');
}

export function buildSubagentSystemPrompt(
  toolsEnabled = true,
  toolNames: string[] = DEFAULT_TOOL_LIST,
): string {
  return [
    buildDefaultSystemPrompt(toolsEnabled, toolNames),
    'You are running as an isolated subagent for a parent agent.',
    'Focus only on the delegated task.',
    'Use the task tool only if the subtask truly requires deeper delegation.',
    'You must end with a concrete plain-text report for the parent agent.',
    'Do not finish with an empty response, and do not expect the parent to infer your answer from raw tool output alone.',
  ].join(' ');
}

export function appendContextText(basePrompt: string, contextText: string): string {
  if (!contextText.trim()) {
    return basePrompt;
  }

  return `${basePrompt}\n\nProject and user context:\n${contextText}`;
}
