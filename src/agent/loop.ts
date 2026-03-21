import type { BaseAdapter } from '../models/base-adapter.ts';
import type { ModelRegistry } from '../models/registry.ts';
import type { PermissionsEngine } from '../permissions/engine.ts';
import { derivePersistentToolPattern } from '../permissions/matcher.ts';
import { canExecuteInPlanMode } from '../permissions/modes.ts';
import type { PermissionRequest, PermissionResult } from '../permissions/types.ts';
import type { CostTracker } from '../cost/tracker.ts';
import type { Message, ContentBlock, ToolDefinitionSchema } from '../shared/types.ts';
import { ToolError } from '../shared/errors.ts';
import { bus } from '../shared/events.ts';
import { logger } from '../shared/logger.ts';
import type { LoadedSkill, ToolExecutionContext, ToolRegistry } from '../tools/index.ts';

export type ToolPermissionChoice = 'allow-once' | 'allow-always' | 'deny-once' | 'deny-always';

export interface AgentLoopOptions {
  adapter: BaseAdapter;
  tools: ToolRegistry;
  permissions: PermissionsEngine;
  modelRegistry: ModelRegistry;
  systemPrompt?: string;
  maxTokens?: number;
  maxIterations?: number;
  cwd?: string;
  askUser?: (question: string) => Promise<string>;
  runSubagent?: (description: string, model?: string) => Promise<string>;
  costTracker?: CostTracker;
  loadedSkills?: LoadedSkill[];
  subagentDepth?: number;
  sessionId?: string;
  onText?: (text: string) => void;
  onInfo?: (text: string) => void;
  onPermissionPrompt?: (
    request: PermissionRequest,
    result: PermissionResult,
    tool?: ToolDefinitionSchema,
  ) => Promise<ToolPermissionChoice>;
}

export interface AgentLoopResult {
  finalText: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  iterations: number;
  plannedToolCalls: Array<{ name: string; input: Record<string, unknown> }>;
}

export async function runAgentLoop(
  history: Message[],
  options: AgentLoopOptions,
): Promise<AgentLoopResult> {
  const {
    adapter,
    tools,
    permissions,
    modelRegistry,
    systemPrompt,
    maxTokens,
    maxIterations = 10,
    cwd = process.cwd(),
    askUser,
    runSubagent,
    costTracker,
    loadedSkills = [],
    subagentDepth = 0,
    sessionId = globalThis.crypto?.randomUUID?.() ?? `session-${Date.now()}`,
    onText,
    onInfo,
    onPermissionPrompt,
  } = options;

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let iterations = 0;
  let finalText = '';
  const plannedToolCalls: Array<{ name: string; input: Record<string, unknown> }> = [];

  bus.emit('session:start', { model: `${adapter.provider}/${adapter.modelId}` });

  try {
    while (iterations < maxIterations) {
      iterations++;

      const toolDefs = tools.getDefinitions();
      const effectiveSystemPrompt = composeSystemPrompt(systemPrompt, loadedSkills);
      const streamParams = {
        messages: history,
        tools: toolDefs,
        systemPrompt: effectiveSystemPrompt,
        maxTokens,
      };

      let assistantText = '';
      const toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];

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

      const assistantContent: ContentBlock[] = [];
      if (assistantText) {
        assistantContent.push({ type: 'text', text: assistantText });
      }
      for (const tc of toolCalls) {
        assistantContent.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
      }
      history.push({ role: 'assistant', content: assistantContent });

      if (toolCalls.length === 0) {
        if (!assistantText) {
          finalText = finalText || getMostRecentToolResultFallback(history) || '';
        }
        break;
      }

      const toolResults: ContentBlock[] = [];
      for (const tc of toolCalls) {
        bus.emit('tool:start', { name: tc.name });
        const startMs = Date.now();

        let resultContent = '';
        let isError = false;

        try {
          const request: PermissionRequest = {
            toolName: tc.name,
            input: tc.input,
            sessionId,
          };
          const permission = await permissions.check(request);
          const tool = tools.get(tc.name);
          const toolDefinition = toolDefs.find((definition) => definition.name === tc.name);

          if (permission.decision === 'deny') {
            isError = true;
            resultContent = formatDeniedToolResult(tc.name, permission.reason);
          } else if (permission.decision === 'prompt') {
            const choice = onPermissionPrompt
              ? await onPermissionPrompt(request, permission, toolDefinition)
              : 'deny-once';
            const persistedPattern = derivePersistentToolPattern(request);

            if (choice === 'allow-always') {
              permissions.addAllowed(persistedPattern, 'project');
            } else if (choice === 'deny-always') {
              permissions.addBlocked(persistedPattern, 'project');
            }

            if (choice === 'deny-once' || choice === 'deny-always') {
              isError = true;
              resultContent = formatDeniedToolResult(
                tc.name,
                'The user denied this tool request.',
              );
            } else {
              ({ resultContent, isError } = await executeToolOrDryRun(
                tc,
                tool,
                permissions,
                history,
                cwd,
                adapter,
                modelRegistry,
                tools,
                loadedSkills,
                subagentDepth,
                systemPrompt,
                askUser,
                runSubagent,
                costTracker,
                plannedToolCalls,
              ));
            }
          } else {
            ({ resultContent, isError } = await executeToolOrDryRun(
              tc,
              tool,
              permissions,
              history,
              cwd,
              adapter,
              modelRegistry,
              tools,
              loadedSkills,
              subagentDepth,
              systemPrompt,
              askUser,
              runSubagent,
              costTracker,
              plannedToolCalls,
            ));
          }

          if (isError) {
            bus.emit('tool:error', { name: tc.name, error: resultContent });
          } else {
            bus.emit('tool:end', { name: tc.name, durationMs: Date.now() - startMs });
          }
        } catch (err) {
          isError = true;
          resultContent = err instanceof Error ? err.message : String(err);
          bus.emit('tool:error', { name: tc.name, error: resultContent });
          logger.warn(`Tool error (${tc.name}):`, resultContent);
        }

        const toolResult: Extract<ContentBlock, { type: 'tool_result' }> = {
          type: 'tool_result',
          tool_use_id: tc.id,
          content: resultContent,
        };
        if (isError) {
          toolResult.is_error = true;
        }
        toolResults.push(toolResult);
      }

      history.push({ role: 'user', content: toolResults });
    }

    if (iterations >= maxIterations) {
      logger.warn(`Agent loop hit maxIterations (${maxIterations})`);
    }
  } finally {
    bus.emit('session:end', { totalInputTokens, totalOutputTokens });
  }

  if (permissions.getMode() === 'plan' && plannedToolCalls.length > 0) {
    const summary = formatPlanSummary(plannedToolCalls);
    onInfo?.(summary);

    if (askUser) {
      const answer = await askUser('Switch to default mode and execute this plan? (y/n)');
      if (isAffirmative(answer)) {
        onInfo?.('Plan approved. Switching to default mode and executing the last user request.');
        permissions.setMode('default');

        const lastUserMessage = getLastUserMessageText(history);
        if (lastUserMessage) {
          const rerunHistory: Message[] = [{ role: 'user', content: lastUserMessage }];
          const rerunResult = await runAgentLoop(rerunHistory, {
            ...options,
            permissions,
            sessionId,
          });

          history.splice(0, history.length, ...rerunHistory);
          return {
            finalText: rerunResult.finalText,
            totalInputTokens: totalInputTokens + rerunResult.totalInputTokens,
            totalOutputTokens: totalOutputTokens + rerunResult.totalOutputTokens,
            iterations: iterations + rerunResult.iterations,
            plannedToolCalls,
          };
        }
      }
    }
  }

  return { finalText, totalInputTokens, totalOutputTokens, iterations, plannedToolCalls };
}

async function executeToolOrDryRun(
  toolCall: { id: string; name: string; input: Record<string, unknown> },
  tool: ReturnType<ToolRegistry['get']>,
  permissions: PermissionsEngine,
  history: Message[],
  cwd: string,
  adapter: BaseAdapter,
  modelRegistry: ModelRegistry,
  tools: ToolRegistry,
  loadedSkills: LoadedSkill[],
  subagentDepth: number,
  systemPrompt: string | undefined,
  askUser: AgentLoopOptions['askUser'],
  runSubagent: AgentLoopOptions['runSubagent'],
  costTracker: AgentLoopOptions['costTracker'],
  plannedToolCalls: AgentLoopResult['plannedToolCalls'],
): Promise<{ resultContent: string; isError: boolean }> {
  if (permissions.getMode() === 'plan' && !canExecuteInPlanMode(toolCall.name)) {
    plannedToolCalls.push({ name: toolCall.name, input: toolCall.input });
    return {
      resultContent: formatPlanModeToolResult(toolCall.name, toolCall.input),
      isError: false,
    };
  }

  if (!tool) {
    throw new ToolError(`Unknown tool: "${toolCall.name}"`, toolCall.name);
  }

  logger.debug(`Executing tool: ${toolCall.name}`, JSON.stringify(toolCall.input));
  const toolContext: ToolExecutionContext = {
    history,
    cwd,
    model: `${adapter.provider}/${adapter.modelId}`,
    adapter,
    modelRegistry,
    registry: tools,
    permissions,
    loadedSkills,
    subagentDepth,
    baseSystemPrompt: systemPrompt,
    askUser,
    runSubagent,
    costTracker,
  };

  const toolResult = await tool.execute(toolCall.input, toolContext);
  return {
    resultContent: toolResult.content,
    isError: toolResult.isError === true,
  };
}

function composeSystemPrompt(basePrompt: string | undefined, loadedSkills: LoadedSkill[]): string | undefined {
  if (loadedSkills.length === 0) {
    return basePrompt;
  }

  const skillPrompt = loadedSkills
    .map((skill) => `Loaded skill "${skill.name}" from ${skill.path}:\n${skill.instructions}`)
    .join('\n\n');

  return [basePrompt, skillPrompt].filter(Boolean).join('\n\n');
}

function getMostRecentToolResultFallback(history: Message[]): string | undefined {
  for (let index = history.length - 1; index >= 0; index--) {
    const message = history[index];
    if (typeof message.content === 'string') {
      continue;
    }

    const toolResults = message.content.filter((block) => block.type === 'tool_result');
    if (toolResults.length === 0) {
      continue;
    }

    const content = toolResults
      .map((block) => block.content.trim())
      .filter(Boolean)
      .join('\n');

    if (content) {
      return content;
    }
  }

  return undefined;
}

function formatDeniedToolResult(toolName: string, reason: string): string {
  return `Tool '${toolName}' was denied. Reason: ${reason}. Please find an alternative approach.`;
}

function formatPlanModeToolResult(toolName: string, input: Record<string, unknown>): string {
  return `[PLAN MODE] Would execute ${toolName} with:\n${JSON.stringify(input, null, 2)}`;
}

function formatPlanSummary(plannedToolCalls: AgentLoopResult['plannedToolCalls']): string {
  const lines = ['[PLAN MODE] Planned tool calls:'];

  plannedToolCalls.forEach((plannedCall, index) => {
    lines.push(`${index + 1}. ${plannedCall.name}`);
    lines.push(JSON.stringify(plannedCall.input, null, 2));
  });

  return lines.join('\n');
}

function isAffirmative(value: string): boolean {
  return /^(y|yes)$/i.test(value.trim());
}

function getLastUserMessageText(history: Message[]): string | undefined {
  for (let index = history.length - 1; index >= 0; index--) {
    const message = history[index];
    if (message.role !== 'user') {
      continue;
    }

    if (typeof message.content === 'string') {
      return message.content;
    }

    const text = message.content
      .filter((block) => block.type === 'text')
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('');

    if (text) {
      return text;
    }
  }

  return undefined;
}
