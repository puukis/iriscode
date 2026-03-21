import type { Tool, ToolExecutionContext } from '../index.ts';
import type { ToolDefinitionSchema, ToolResult } from '../../shared/types.ts';
import { fail, ok } from '../result.ts';

export class ToolSearchTool implements Tool {
  readonly definition: ToolDefinitionSchema = {
    name: 'tool-search',
    description: 'Search the registered tool registry by tool name and description.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Substring query to search for' },
      },
      required: ['query'],
    },
  };

  async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
    const query = typeof input['query'] === 'string' ? input['query'].trim().toLowerCase() : '';
    if (!query) {
      return fail('tool-search', 'query must be a non-empty string');
    }

    const matches = context.registry
      .getDefinitions()
      .filter((tool) => {
        const haystack = `${tool.name} ${tool.description}`.toLowerCase();
        return haystack.includes(query);
      });

    if (matches.length === 0) {
      return ok('No matching tools found.');
    }

    return ok(matches.map((tool) => `- ${tool.name}: ${tool.description}`).join('\n'));
  }
}
