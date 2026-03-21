import { describe, expect, test } from 'bun:test';
import { runAgentLoop } from '../loop.ts';
import { runSubagentTask } from '../orchestrator.ts';
import { buildDefaultSystemPrompt } from '../system-prompt.ts';
import { bus } from '../../shared/events.ts';
import { PermissionsEngine } from '../../permissions/engine.ts';
import { ModelRegistry } from '../../models/registry.ts';
import type { Message } from '../../shared/types.ts';
import { FakeAdapter } from '../../shared/test-helpers.ts';
import { ToolRegistry, type Tool } from '../../tools/index.ts';

describe('agent', () => {
  test('runAgentLoop executes tool calls and returns final text', async () => {
    let streamCalls = 0;
    const adapter = new FakeAdapter('test', 'loop-model', async function* () {
      streamCalls += 1;
      if (streamCalls === 1) {
        yield {
          type: 'tool_call',
          toolCall: { id: 'tool-1', name: 'echo', input: { value: 'pong' } },
        };
        yield { type: 'done', stopReason: 'tool_use', inputTokens: 1, outputTokens: 1 };
        return;
      }
      yield { type: 'text', text: 'loop complete' };
      yield { type: 'done', stopReason: 'end_turn', inputTokens: 1, outputTokens: 2 };
    });

    const modelRegistry = new ModelRegistry();
    modelRegistry.register('test/loop-model', adapter);

    const tools = new ToolRegistry();
    const echoTool: Tool = {
      definition: {
        name: 'echo',
        description: 'Echo a value',
        inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },
      },
      async execute(input) {
        return { content: `echo:${String(input.value)}` };
      },
    };
    tools.register(echoTool);

    const history: Message[] = [{ role: 'user', content: 'Run the tool' }];
    const result = await runAgentLoop(history, {
      adapter,
      tools,
      permissions: new PermissionsEngine('acceptAll'),
      modelRegistry,
      systemPrompt: 'test',
    });

    expect(result.finalText).toBe('loop complete');
    expect(streamCalls).toBe(2);
  });

  test('runSubagentTask emits events and enforces depth limit', async () => {
    const adapter = new FakeAdapter('test', 'subagent-model', async function* () {
      yield { type: 'text', text: 'subagent ok' };
      yield { type: 'done', stopReason: 'end_turn', inputTokens: 2, outputTokens: 1 };
    });
    const modelRegistry = new ModelRegistry();
    modelRegistry.register('test/subagent-model', adapter);

    const events: string[] = [];
    const offStart = bus.on('agent:start', ({ description }) => events.push(`start:${description}`));
    const offDone = bus.on('agent:done', ({ response }) => events.push(`done:${response}`));

    const response = await runSubagentTask('do work', {
      currentModel: 'test/subagent-model',
      modelRegistry,
      permissionMode: 'acceptAll',
      cwd: process.cwd(),
    });

    offStart();
    offDone();

    expect(response).toBe('subagent ok');
    expect(events).toContain('start:do work');
    expect(events).toContain('done:subagent ok');

    await expect(
      runSubagentTask('too deep', {
        currentModel: 'test/subagent-model',
        modelRegistry,
        subagentDepth: 5,
      }),
    ).rejects.toThrow('Subagent depth limit exceeded');
  });

  test('buildDefaultSystemPrompt lists available tools', () => {
    const prompt = buildDefaultSystemPrompt(true, ['read', 'write', 'git-status']);
    expect(prompt).toContain('read, write, git-status');
  });
});
