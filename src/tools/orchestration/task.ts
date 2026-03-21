import type { Tool, ToolExecutionContext } from '../index.ts';
import type { ToolDefinitionSchema, ToolResult } from '../../shared/types.ts';
import { fail, ok } from '../result.ts';

export class TaskTool implements Tool {
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
    if (!context.runSubagent) {
      return fail('task', 'Subagent orchestration is not available in this runtime');
    }

    try {
      const response = await context.runSubagent(description, typeof model === 'string' ? model.trim() : undefined);
      return ok(response || '(no response)');
    } catch (err) {
      return fail('task', err instanceof Error ? err.message : String(err));
    }
  }
}
