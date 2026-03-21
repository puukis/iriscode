import type { Tool, ToolExecutionContext } from '../index.ts';
import type { ToolDefinitionSchema, ToolResult } from '../../shared/types.ts';
import { fail, ok } from '../result.ts';
import type { Orchestrator } from '../../agent/orchestrator.ts';

export class TaskTool implements Tool {
  constructor(private readonly orchestrator?: Orchestrator) {}

  readonly definition: ToolDefinitionSchema = {
    name: 'task',
    description: 'Spawn an isolated subagent, wait for it to finish, and return its final response.',
    inputSchema: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'Initial prompt for the subagent' },
        model: { type: 'string', description: 'Optional model override for the subagent' },
      },
      required: ['description'],
    },
  };

  async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
    const description = typeof input['description'] === 'string' ? input['description'].trim() : '';
    const model = input['model'];

    if (!description) {
      return fail('task', 'description must be a non-empty string');
    }
    if (model !== undefined && (typeof model !== 'string' || !model.trim())) {
      return fail('task', 'model must be a non-empty string when provided');
    }
    const orchestrator = this.orchestrator ?? context.orchestrator;

    if (!orchestrator && !context.runSubagent) {
      return fail('task', 'Subagent orchestration is not available in this runtime');
    }

    try {
      const trimmedModel = typeof model === 'string' ? model.trim() : undefined;
      const response = orchestrator
        ? await orchestrator.spawnSubagent({
            description,
            model: trimmedModel,
            parentId: context.agentId,
            depth: context.depth + 1,
          })
        : await context.runSubagent!(description, trimmedModel);
      return ok(response || '(no response)');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/Maximum subagent depth of 5 reached/i.test(message)) {
        return fail('task', 'Subagent depth limit reached (max 5). Break this task into smaller steps instead.');
      }
      return fail('task', message);
    }
  }
}
