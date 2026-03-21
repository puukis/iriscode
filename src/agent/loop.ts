import type { BaseAdapter } from '../models/base-adapter.ts';
import type { ToolRegistry } from '../tools/index.ts';
import type { PermissionsEngine } from '../permissions/engine.ts';
import type { Message, ContentBlock } from '../shared/types.ts';
import { ToolError } from '../shared/errors.ts';
import { bus } from '../shared/events.ts';
import { logger } from '../shared/logger.ts';

export interface AgentLoopOptions {
  adapter: BaseAdapter;
  tools: ToolRegistry;
  permissions: PermissionsEngine;
  systemPrompt?: string;
  maxTokens?: number;
  maxIterations?: number;
  /** Called when the agent produces text output */
  onText?: (text: string) => void;
  /** Called before a tool executes — return false to deny */
  onToolRequest?: (toolName: string, input: Record<string, unknown>) => Promise<boolean>;
}

export interface AgentLoopResult {
  finalText: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  iterations: number;
}

/**
 * Run the agentic loop: stream from the model, handle tool calls,
 * and continue until the model stops requesting tools or maxIterations is hit.
 *
 * @param history - Mutable message history; this function appends to it in place.
 */
export async function runAgentLoop(
  history: Message[],
  options: AgentLoopOptions,
): Promise<AgentLoopResult> {
  const {
    adapter,
    tools,
    permissions,
    systemPrompt,
    maxTokens,
    maxIterations = 10,
    onText,
    onToolRequest,
  } = options;

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let iterations = 0;
  let finalText = '';

  bus.emit('session:start', { model: `${adapter.provider}/${adapter.modelId}` });

  try {
    while (iterations < maxIterations) {
      iterations++;

      const toolDefs = tools.getDefinitions();
      const streamParams = {
        messages: history,
        tools: toolDefs,
        systemPrompt,
        maxTokens,
      };

      let assistantText = '';
      const toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];

      // Stream the model response
      for await (const event of adapter.stream(streamParams)) {
        if (event.type === 'text') {
          assistantText += event.text ?? '';
          onText?.(event.text ?? '');
        } else if (event.type === 'tool_call' && event.toolCall) {
          toolCalls.push(event.toolCall);
        } else if (event.type === 'done') {
          totalInputTokens += event.inputTokens ?? 0;
          totalOutputTokens += event.outputTokens ?? 0;
          if (event.stopReason !== 'tool_use') {
            finalText = assistantText;
          }
        }
      }

      // Build assistant message content
      const assistantContent: ContentBlock[] = [];
      if (assistantText) {
        assistantContent.push({ type: 'text', text: assistantText });
      }
      for (const tc of toolCalls) {
        assistantContent.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
      }
      history.push({ role: 'assistant', content: assistantContent });

      // If no tool calls, we're done
      if (toolCalls.length === 0) {
        break;
      }

      // Execute tool calls
      const toolResults: ContentBlock[] = [];
      for (const tc of toolCalls) {
        bus.emit('tool:start', { name: tc.name });
        const startMs = Date.now();

        let resultContent: string;
        let isError = false;

        try {
          // Check permissions
          const autoApproved = permissions.check(tc.name);
          if (!autoApproved) {
            const approved = onToolRequest
              ? await onToolRequest(tc.name, tc.input)
              : false;
            if (!approved) {
              throw new ToolError(`User denied permission for tool "${tc.name}"`, tc.name);
            }
          }

          const tool = tools.get(tc.name);
          if (!tool) {
            throw new ToolError(`Unknown tool: "${tc.name}"`, tc.name);
          }

          logger.debug(`Executing tool: ${tc.name}`, JSON.stringify(tc.input));
          resultContent = await tool.execute(tc.input);
          bus.emit('tool:end', { name: tc.name, durationMs: Date.now() - startMs });
        } catch (err) {
          isError = true;
          resultContent = err instanceof Error ? err.message : String(err);
          bus.emit('tool:error', { name: tc.name, error: resultContent });
          logger.warn(`Tool error (${tc.name}):`, resultContent);
        }

        const toolResult: Extract<ContentBlock, { type: 'tool_result' }> = {
          type: 'tool_result',
          tool_use_id: tc.id,
          content: resultContent!,
        };
        if (isError) toolResult.is_error = true;
        toolResults.push(toolResult);
      }

      // Add tool results as a user message
      history.push({ role: 'user', content: toolResults });
    }

    if (iterations >= maxIterations) {
      logger.warn(`Agent loop hit maxIterations (${maxIterations})`);
    }
  } finally {
    bus.emit('session:end', { totalInputTokens, totalOutputTokens });
  }

  return { finalText, totalInputTokens, totalOutputTokens, iterations };
}
