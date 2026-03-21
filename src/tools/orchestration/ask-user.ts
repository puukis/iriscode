import type { Tool, ToolExecutionContext } from '../index.ts';
import type { ToolDefinitionSchema, ToolResult } from '../../shared/types.ts';
import { fail, ok } from '../result.ts';

export class AskUserTool implements Tool {
  readonly definition: ToolDefinitionSchema = {
    name: 'ask-user',
    description: 'Pause agent execution and ask the user a question in the terminal.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'Question to ask the user' },
      },
      required: ['question'],
    },
  };

  async execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
    const question = typeof input['question'] === 'string' ? input['question'].trim() : '';
    if (!question) {
      return fail('ask-user', 'question must be a non-empty string');
    }
    if (!context.askUser) {
      return fail('ask-user', 'Interactive user input is not available in this runtime');
    }

    try {
      const response = await context.askUser(question);
      return ok(response);
    } catch (err) {
      return fail('ask-user', err instanceof Error ? err.message : String(err));
    }
  }
}
