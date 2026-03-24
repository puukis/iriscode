import type { BaseAdapter } from '../models/base-adapter.ts';
import { parseModelString, type ModelRegistry } from '../models/registry.ts';
import type { PermissionsEngine } from '../permissions/engine.ts';
import { derivePersistentToolPattern } from '../permissions/matcher.ts';
import { canExecuteInPlanMode } from '../permissions/modes.ts';
import type { PermissionRequest, PermissionResult } from '../permissions/types.ts';
import type { CostTracker } from '../cost/tracker.ts';
import type { Message, ContentBlock, ToolDefinitionSchema, ToolResult } from '../shared/types.ts';
import { ToolError, isAbortError } from '../shared/errors.ts';
import { bus } from '../shared/events.ts';
import { logger } from '../shared/logger.ts';
import type { LoadedSkill, ToolExecutionContext, ToolRegistry } from '../tools/index.ts';
import type { HookRegistry } from '../hooks/registry.ts';
import { runEventHooks, runPostHooks, runPreHooks } from '../hooks/runner.ts';
import { clearSkillContext } from '../skills/injector.ts';
import type { SkillContextModifier } from '../skills/types.ts';
import type { Orchestrator } from './orchestrator.ts';
import type { GraphTracker } from '../graph/tracker.ts';
import type { Session } from './session.ts';
import { Planner } from './planner.ts';

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
  orchestrator?: Orchestrator;
  tracker?: GraphTracker;
  agentId?: string;
  parentAgentId?: string | null;
  depth?: number;
  description?: string;
  onText?: (text: string) => void;
  onInfo?: (text: string) => void;
  onPermissionPrompt?: (
    request: PermissionRequest,
    result: PermissionResult,
    tool?: ToolDefinitionSchema,
  ) => Promise<ToolPermissionChoice>;
  abortSignal?: AbortSignal;
  hookRegistry?: HookRegistry;
  session?: Session;
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
    orchestrator,
    tracker,
    agentId = 'root',
    parentAgentId = null,
    depth = subagentDepth,
    description = getLastUserMessageText(history) ?? 'root agent',
    onText,
    onInfo,
    onPermissionPrompt,
    abortSignal,
    hookRegistry,
    session,
  } = options;

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let iterations = 0;
  let finalText = '';
  let pendingModelOverride: string | null = null;
  const plannedToolCalls: Array<{ name: string; input: Record<string, unknown> }> = [];

  if (session) {
    session.messages = history;
  }

  bus.emit('session:start', { model: `${adapter.provider}/${adapter.modelId}` });
  bus.emit('agent:start', {
    depth,
    model: `${adapter.provider}/${adapter.modelId}`,
    description,
  });
  tracker?.agentStarted(agentId, parentAgentId, description, `${adapter.provider}/${adapter.modelId}`, depth);

  try {
    if (hookRegistry) {
      await runEventHooks('agent:start', {
        event: 'agent:start',
        timing: 'pre',
        sessionId,
      }, hookRegistry);
    }

    while (iterations < maxIterations) {
      iterations++;

      const activeAdapter = resolveAdapterForTurn(adapter, modelRegistry, pendingModelOverride);
      pendingModelOverride = null;
      const messageId = `${agentId}:assistant:${iterations}`;
      const toolDefs = tools.getDefinitions();
      const streamParams = {
        messages: history,
        tools: toolDefs,
        systemPrompt,
        maxTokens,
        abortSignal,
      };

      let assistantText = '';
      const toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];

      for await (const event of activeAdapter.stream(streamParams)) {
        if (event.type === 'text') {
          assistantText += event.text ?? '';
          bus.emit('token:stream', {
            messageId,
            text: event.text ?? '',
          });
          onText?.(event.text ?? '');
        } else if (event.type === 'tool_call' && event.toolCall) {
          toolCalls.push(event.toolCall);
        } else if (event.type === 'done') {
          totalInputTokens += event.inputTokens ?? 0;
          totalOutputTokens += event.outputTokens ?? 0;
          bus.emit('token:done', {
            messageId,
            inputTokens: event.inputTokens ?? 0,
            outputTokens: event.outputTokens ?? 0,
          });
          if (event.stopReason !== 'tool_use') {
            finalText = assistantText;
          }
          if (event.inputTokens) {
            bus.emit('context:usage', {
              inputTokens: event.inputTokens,
              model: `${activeAdapter.provider}/${activeAdapter.modelId}`,
            });
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
        if (session) {
          clearSkillContext(session, permissions);
        }
        if (!assistantText) {
          finalText = finalText || getMostRecentToolResultFallback(history) || '';
        }
        break;
      }

      const toolResults: ContentBlock[] = [];
      for (const tc of toolCalls) {
        const toolDefinition = toolDefs.find((definition) => definition.name === tc.name);
        bus.emit('tool:start', { name: tc.name });
        bus.emit('tool:call', {
          id: tc.id,
          name: tc.name,
          input: tc.input,
          agentId,
          startedAt: Date.now(),
          risk: resolveToolRisk(tc.name, toolDefinition?.risk),
        });
        const startMs = Date.now();

        let resultContent = '';
        let isError = false;
        let contextModifier: SkillContextModifier | undefined;
        let executedInput = tc.input;

        try {
          const request: PermissionRequest = {
            toolName: tc.name,
            input: tc.input,
            sessionId,
          };
          const permission = await permissions.check(request);
          const tool = tools.get(tc.name);

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
              ({ resultContent, isError, contextModifier, executedInput } = await executeWithHooks(
                tc,
                tool,
                permissions,
                history,
                cwd,
                activeAdapter,
                modelRegistry,
                tools,
                loadedSkills,
                subagentDepth,
                depth,
                agentId,
                systemPrompt,
                askUser,
                runSubagent,
                costTracker,
                plannedToolCalls,
                orchestrator,
                tracker,
                hookRegistry,
                sessionId,
              ));
            }
          } else {
            ({ resultContent, isError, contextModifier, executedInput } = await executeWithHooks(
              tc,
              tool,
              permissions,
              history,
              cwd,
              activeAdapter,
              modelRegistry,
              tools,
              loadedSkills,
              subagentDepth,
              depth,
              agentId,
              systemPrompt,
              askUser,
              runSubagent,
              costTracker,
              plannedToolCalls,
              orchestrator,
              tracker,
              hookRegistry,
              sessionId,
            ));
          }

          if (contextModifier?.modelOverride) {
            pendingModelOverride = contextModifier.modelOverride;
          }

          if (isError) {
            bus.emit('tool:error', { name: tc.name, error: resultContent });
          } else {
            bus.emit('tool:end', { name: tc.name, durationMs: Date.now() - startMs });
          }
          bus.emit('tool:result', {
            id: tc.id,
            name: tc.name,
            input: executedInput,
            output: resultContent,
            isError,
            durationMs: Date.now() - startMs,
            agentId,
          });
        } catch (err) {
          isError = true;
          resultContent = err instanceof Error ? err.message : String(err);
          bus.emit('tool:error', { name: tc.name, error: resultContent });
          bus.emit('tool:result', {
            id: tc.id,
            name: tc.name,
            input: executedInput,
            output: resultContent,
            isError,
            durationMs: Date.now() - startMs,
            agentId,
          });
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
  } catch (error) {
    const errorMessage =
      isAbortError(error) ? 'Cancelled.' : error instanceof Error ? error.message : String(error);
    tracker?.agentFailed(agentId, errorMessage);
    bus.emit('agent:error', {
      depth,
      model: `${adapter.provider}/${adapter.modelId}`,
      description,
      error: errorMessage,
    });
    if (hookRegistry) {
      await runEventHooks('agent:error', {
        event: 'agent:error',
        timing: 'post',
        sessionId,
      }, hookRegistry);
    }
    throw error;
  } finally {
    if (session) {
      clearSkillContext(session, permissions);
    }
    bus.emit('session:end', { totalInputTokens, totalOutputTokens });
  }

  if (permissions.getMode() === 'plan' && plannedToolCalls.length > 0) {
    const planner = new Planner({ askUser, onInfo });
    const decision = await planner.reviewAndDecide(plannedToolCalls);
    if (decision === 'run') {
      onInfo?.('Plan approved. Switching to default mode and executing the last user request.');
      permissions.setMode('default');

      const lastUserMessage = getLastUserMessageText(history);
      if (lastUserMessage) {
        const rerunHistory: Message[] = [{ role: 'user', content: lastUserMessage }];
        const rerunResult = await runAgentLoop(rerunHistory, {
          ...options,
          permissions,
          sessionId,
          agentId,
          parentAgentId,
          depth,
          description,
        });

        history.splice(0, history.length, ...rerunHistory);
        tracker?.agentFinished(agentId, rerunResult.finalText);
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

  tracker?.agentFinished(agentId, finalText);
  bus.emit('agent:done', {
    depth,
    model: `${adapter.provider}/${adapter.modelId}`,
    description,
    response: finalText,
  });
  if (hookRegistry) {
    await runEventHooks('agent:done', {
      event: 'agent:done',
      timing: 'post',
      sessionId,
    }, hookRegistry);
  }
  return { finalText, totalInputTokens, totalOutputTokens, iterations, plannedToolCalls };
}

async function executeWithHooks(
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
  depth: number,
  agentId: string,
  systemPrompt: string | undefined,
  askUser: AgentLoopOptions['askUser'],
  runSubagent: AgentLoopOptions['runSubagent'],
  costTracker: AgentLoopOptions['costTracker'],
  plannedToolCalls: AgentLoopResult['plannedToolCalls'],
  orchestrator: AgentLoopOptions['orchestrator'],
  tracker: AgentLoopOptions['tracker'],
  hookRegistry: HookRegistry | undefined,
  sessionId: string,
): Promise<{ resultContent: string; isError: boolean; contextModifier?: SkillContextModifier; executedInput: Record<string, unknown> }> {
  let executedInput = toolCall.input;

  if (hookRegistry) {
    const preHookResult = await runPreHooks(`tool:${toolCall.name}`, {
      event: `tool:${toolCall.name}`,
      timing: 'pre',
      toolName: toolCall.name,
      input: toolCall.input,
      sessionId,
    }, hookRegistry);

    if (preHookResult.action === 'block') {
      return {
        resultContent: `🔒 ${preHookResult.blockReason ?? `Hook blocked ${toolCall.name}`}`,
        isError: true,
        executedInput,
      };
    }

    if (preHookResult.modifiedInput) {
      executedInput = preHookResult.modifiedInput;
    }
  }

  const toolResult = await executeToolOrDryRun(
    { ...toolCall, input: executedInput },
    tool,
    permissions,
    history,
    cwd,
    adapter,
    modelRegistry,
    tools,
    loadedSkills,
    subagentDepth,
    depth,
    agentId,
    systemPrompt,
    askUser,
    runSubagent,
    costTracker,
    plannedToolCalls,
    orchestrator,
    tracker,
  );

  if (hookRegistry) {
    const postHookResult = await runPostHooks(`tool:${toolCall.name}`, {
      event: `tool:${toolCall.name}`,
      timing: 'post',
      toolName: toolCall.name,
      input: executedInput,
      result: toolResult,
      sessionId,
    }, hookRegistry);

    return {
      resultContent: postHookResult.content,
      isError: postHookResult.isError === true,
      contextModifier: 'contextModifier' in toolResult
        ? (toolResult as ToolResult & { contextModifier?: SkillContextModifier }).contextModifier
        : undefined,
      executedInput,
    };
  }

  return {
    resultContent: toolResult.content,
    isError: toolResult.isError === true,
    contextModifier: 'contextModifier' in toolResult
      ? (toolResult as ToolResult & { contextModifier?: SkillContextModifier }).contextModifier
      : undefined,
    executedInput,
  };
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
  depth: number,
  agentId: string,
  systemPrompt: string | undefined,
  askUser: AgentLoopOptions['askUser'],
  runSubagent: AgentLoopOptions['runSubagent'],
  costTracker: AgentLoopOptions['costTracker'],
  plannedToolCalls: AgentLoopResult['plannedToolCalls'],
  orchestrator: AgentLoopOptions['orchestrator'],
  tracker: AgentLoopOptions['tracker'],
): Promise<ToolResult & { contextModifier?: SkillContextModifier }> {
  if (permissions.getMode() === 'plan' && !canExecuteInPlanMode(toolCall.name)) {
    plannedToolCalls.push({ name: toolCall.name, input: toolCall.input });
    return {
      content: formatPlanModeToolResult(toolCall.name, toolCall.input),
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
    depth,
    agentId,
    orchestrator,
    tracker,
    baseSystemPrompt: systemPrompt,
    askUser,
    runSubagent,
    costTracker,
  };

  const toolResult = await tool.execute(toolCall.input, toolContext);
  return toolResult as ToolResult & { contextModifier?: SkillContextModifier };
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

function resolveToolRisk(
  toolName: string,
  riskOverride?: 'low' | 'medium' | 'high',
): 'low' | 'medium' | 'high' {
  if (riskOverride) {
    return riskOverride;
  }

  if (toolName.includes(':')) {
    return 'medium';
  }

  if (['read', 'glob', 'grep', 'git-status', 'git-diff', 'tool-search', 'ask-user'].includes(toolName)) {
    return 'low';
  }

  if (['write', 'edit', 'web-search', 'web-fetch', 'todo-write', 'Skill', 'skill'].includes(toolName)) {
    return 'medium';
  }

  return 'high';
}

function formatPlanSummary(plannedToolCalls: AgentLoopResult['plannedToolCalls']): string {
  const lines = ['[PLAN MODE] Planned tool calls:'];

  plannedToolCalls.forEach((plannedCall, index) => {
    lines.push(`${index + 1}. ${plannedCall.name}`);
    lines.push(JSON.stringify(plannedCall.input, null, 2));
  });

  return lines.join('\n');
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

function resolveAdapterForTurn(
  baseAdapter: BaseAdapter,
  modelRegistry: ModelRegistry,
  modelOverride: string | null,
): BaseAdapter {
  if (!modelOverride) {
    return baseAdapter;
  }

  const normalizedModel = normalizeModelKey(modelOverride);
  if (!modelRegistry.has(normalizedModel)) {
    logger.warn(`Ignoring unknown skill model override "${modelOverride}".`);
    return baseAdapter;
  }

  return modelRegistry.get(normalizedModel);
}

function normalizeModelKey(model: string): string {
  const { provider, modelId } = parseModelString(model);
  return `${provider}/${modelId}`;
}
