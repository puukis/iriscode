import type { BuiltinHandler, CommandEntry } from '../types.ts';
import { getPermissionRiskLevel } from '../../ui/components/permission-prompt.tsx';

const TOOL_GROUPS: Record<string, string> = {
  read: 'file',
  write: 'file',
  edit: 'file',
  bash: 'shell',
  glob: 'search',
  grep: 'search',
  'web-search': 'search',
  'web-fetch': 'search',
  'git-status': 'git',
  'git-diff': 'git',
  'git-commit': 'git',
  'tool-search': 'discovery',
  task: 'orchestration',
  skill: 'orchestration',
  'ask-user': 'orchestration',
  'todo-write': 'orchestration',
};

export const TOOLS_COMMAND: CommandEntry = {
  name: 'tools',
  description: 'List registered tools with permissions and risk levels.',
  category: 'builtin',
};

export const handleTools: BuiltinHandler = async (ctx) => {
  try {
    const grouped = new Map<string, string[]>();
    for (const definition of ctx.session.getToolDefinitions()) {
      const decision = ctx.engine.checkSync({
        toolName: definition.name,
        input: sampleInputForTool(definition.name),
        sessionId: ctx.session.id,
      }).decision;
      const status = decision === 'allow' ? 'AUTO-ALLOW' : decision === 'deny' ? 'AUTO-DENY' : 'PROMPT';
      const risk = getPermissionRiskLevel(definition.name).toUpperCase();
      const line = `${definition.name.padEnd(12)} ${status.padEnd(10)} ${risk.padEnd(6)} ${definition.description}`;
      const group = TOOL_GROUPS[definition.name] ?? 'other';
      grouped.set(group, [...(grouped.get(group) ?? []), line]);
    }

    const lines: string[] = [];
    for (const [group, items] of grouped) {
      lines.push(`${group}:`, ...items.map((item) => `  ${item}`), '');
    }

    ctx.session.writeInfo(lines.join('\n').trimEnd());
    return { type: 'handled' };
  } catch (error) {
    return { type: 'error', message: error instanceof Error ? error.message : String(error) };
  }
};

function sampleInputForTool(toolName: string): Record<string, unknown> {
  switch (toolName) {
    case 'read':
    case 'write':
    case 'edit':
      return { path: 'src/index.ts' };
    case 'bash':
      return { command: 'echo test' };
    case 'glob':
    case 'grep':
      return { pattern: '*.ts' };
    case 'web-search':
      return { query: 'iriscode' };
    case 'web-fetch':
      return { url: 'https://example.com', question: 'What is this?' };
    case 'git-commit':
      return { message: 'test commit' };
    case 'task':
      return { description: 'Investigate a bug' };
    case 'skill':
      return { name: 'review' };
    case 'ask-user':
      return { question: 'Continue?' };
    case 'todo-write':
      return { todos: [] };
    default:
      return {};
  }
}
