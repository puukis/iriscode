import { describe, expect, test } from 'bun:test';
import { join } from 'path';
import { readFileSync } from 'fs';
import { runAgentLoop } from '../loop.ts';
import { runSubagentTask } from '../orchestrator.ts';
import { buildDefaultSystemPrompt } from '../system-prompt.ts';
import { bus } from '../../shared/events.ts';
import { PermissionEngine } from '../../permissions/engine.ts';
import { ModelRegistry } from '../../models/registry.ts';
import type { Message } from '../../shared/types.ts';
import { FakeAdapter, cleanupDir, makeTempDir, withEnv } from '../../shared/test-helpers.ts';
import { ToolRegistry, type Tool } from '../../tools/index.ts';
import { PROJECT_SETTINGS_FILE, PROJECT_STATE_DIR } from '../../config/project.ts';

describe('agent', () => {
  test('runAgentLoop executes tool calls and returns final text', async () => {
    const home = makeTempDir('iriscode-agent-home-');
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
    const result = await withEnv({ HOME: home }, async () => {
      const permissions = new PermissionEngine('default');
      permissions.addAllowed('echo', 'user');
      return runAgentLoop(history, {
        adapter,
        tools,
        permissions,
        modelRegistry,
        systemPrompt: 'test',
      });
    });

    expect(result.finalText).toBe('loop complete');
    expect(streamCalls).toBe(2);
    cleanupDir(home);
  });

  test('runAgentLoop falls back to the latest tool result when the follow-up assistant turn is empty', async () => {
    const home = makeTempDir('iriscode-agent-home-');
    let streamCalls = 0;
    const adapter = new FakeAdapter('test', 'fallback-model', async function* () {
      streamCalls += 1;
      if (streamCalls === 1) {
        yield {
          type: 'tool_call',
          toolCall: { id: 'tool-1', name: 'echo', input: { value: 'saved todo list' } },
        };
        yield { type: 'done', stopReason: 'tool_use', inputTokens: 1, outputTokens: 1 };
        return;
      }

      yield { type: 'done', stopReason: 'end_turn', inputTokens: 1, outputTokens: 1 };
    });

    const modelRegistry = new ModelRegistry();
    modelRegistry.register('test/fallback-model', adapter);

    const tools = new ToolRegistry();
    tools.register({
      definition: {
        name: 'echo',
        description: 'Echo a value',
        inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },
      },
      async execute(input) {
        return { content: String(input.value) };
      },
    });

    const result = await withEnv({ HOME: home }, async () => {
      const permissions = new PermissionEngine('default');
      permissions.addAllowed('echo', 'user');
      return runAgentLoop([{ role: 'user', content: 'Do the thing' }], {
        adapter,
        tools,
        permissions,
        modelRegistry,
      });
    });

    expect(result.finalText).toBe('saved todo list');
    cleanupDir(home);
  });

  test('runSubagentTask emits events and enforces depth limit', async () => {
    const home = makeTempDir('iriscode-agent-home-');
    const adapter = new FakeAdapter('test', 'subagent-model', async function* () {
      yield { type: 'text', text: 'subagent ok' };
      yield { type: 'done', stopReason: 'end_turn', inputTokens: 2, outputTokens: 1 };
    });
    const modelRegistry = new ModelRegistry();
    modelRegistry.register('test/subagent-model', adapter);

    const events: string[] = [];
    const offStart = bus.on('agent:start', ({ description }) => events.push(`start:${description}`));
    const offDone = bus.on('agent:done', ({ response }) => events.push(`done:${response}`));

    const response = await withEnv({ HOME: home }, async () => runSubagentTask('do work', {
      currentModel: 'test/subagent-model',
      modelRegistry,
      permissionMode: 'default',
      cwd: process.cwd(),
    }));

    offStart();
    offDone();

    expect(response).toBe('subagent ok');
    expect(events).toContain('start:do work');
    expect(events).toContain('done:subagent ok');

    await withEnv({ HOME: home }, async () => {
      await expect(
        runSubagentTask('too deep', {
          currentModel: 'test/subagent-model',
          modelRegistry,
          subagentDepth: 5,
        }),
      ).rejects.toThrow('Subagent depth limit exceeded');
    });
    cleanupDir(home);
  });

  test('buildDefaultSystemPrompt lists available tools', () => {
    const prompt = buildDefaultSystemPrompt(true, ['read', 'write', 'git-status']);
    expect(prompt).toContain('read, write, git-status');
    expect(prompt).toContain('Decide autonomously whether a tool will help');
    expect(prompt).toContain('Use tools proactively when they are useful');
  });

  test('runAgentLoop denies blocked tools and lets the model continue', async () => {
    const home = makeTempDir('iriscode-agent-home-');
    let streamCalls = 0;
    const adapter = new FakeAdapter('test', 'denied-model', async function* (params) {
      streamCalls += 1;
      if (streamCalls === 1) {
        yield {
          type: 'tool_call',
          toolCall: { id: 'tool-1', name: 'bash', input: { command: 'rm -rf dist' } },
        };
        yield { type: 'done', stopReason: 'tool_use', inputTokens: 1, outputTokens: 1 };
        return;
      }

      const toolResultMessage = params.messages.at(-1);
      const toolResultText =
        typeof toolResultMessage?.content === 'string'
          ? toolResultMessage.content
          : toolResultMessage?.content
              .filter((block) => block.type === 'tool_result')
              .map((block) => (block.type === 'tool_result' ? block.content : ''))
              .join('\n') ?? '';

      expect(toolResultText).toContain("Tool 'bash' was denied.");
      yield { type: 'text', text: 'I will avoid that command.' };
      yield { type: 'done', stopReason: 'end_turn', inputTokens: 1, outputTokens: 2 };
    });

    const modelRegistry = new ModelRegistry();
    modelRegistry.register('test/denied-model', adapter);
    const tools = new ToolRegistry();
    tools.register({
      definition: {
        name: 'bash',
        description: 'Run a shell command',
        inputSchema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
      },
      async execute() {
        return { content: 'should not run' };
      },
    });

    const result = await withEnv({ HOME: home }, async () => {
      const permissions = new PermissionEngine('default');
      permissions.addBlocked('bash:rm', 'user');
      return runAgentLoop([{ role: 'user', content: 'Delete dist' }], {
        adapter,
        tools,
        permissions,
        modelRegistry,
      });
    });

    expect(result.finalText).toBe('I will avoid that command.');
    cleanupDir(home);
  });

  test('runAgentLoop plan mode intercepts tools and records the planned calls', async () => {
    const home = makeTempDir('iriscode-agent-home-');
    let streamCalls = 0;
    const adapter = new FakeAdapter('test', 'plan-model', async function* (params) {
      streamCalls += 1;
      if (streamCalls === 1) {
        yield {
          type: 'tool_call',
          toolCall: { id: 'tool-1', name: 'write', input: { path: 'todo.md', content: 'draft' } },
        };
        yield { type: 'done', stopReason: 'tool_use', inputTokens: 1, outputTokens: 1 };
        return;
      }

      const toolResultMessage = params.messages.at(-1);
      const toolResultText =
        typeof toolResultMessage?.content === 'string'
          ? toolResultMessage.content
          : toolResultMessage?.content
              .filter((block) => block.type === 'tool_result')
              .map((block) => (block.type === 'tool_result' ? block.content : ''))
              .join('\n') ?? '';

      expect(toolResultText).toContain('[PLAN MODE] Would execute write');
      yield { type: 'text', text: 'Plan drafted.' };
      yield { type: 'done', stopReason: 'end_turn', inputTokens: 1, outputTokens: 1 };
    });

    const modelRegistry = new ModelRegistry();
    modelRegistry.register('test/plan-model', adapter);
    const tools = new ToolRegistry();
    tools.register({
      definition: {
        name: 'write',
        description: 'Write a file',
        inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
      },
      async execute() {
        return { content: 'should not run in plan mode' };
      },
    });

    const infoMessages: string[] = [];
    const result = await withEnv({ HOME: home }, async () => {
      const permissions = new PermissionEngine('plan');
      return runAgentLoop([{ role: 'user', content: 'Create a plan' }], {
        adapter,
        tools,
        permissions,
        modelRegistry,
        askUser: async () => 'n',
        onInfo: (text) => {
          infoMessages.push(text);
        },
      });
    });

    expect(result.finalText).toBe('Plan drafted.');
    expect(result.plannedToolCalls).toEqual([{ name: 'write', input: { path: 'todo.md', content: 'draft' } }]);
    expect(infoMessages.some((message) => message.includes('[PLAN MODE] Planned tool calls:'))).toBe(true);
    cleanupDir(home);
  });

  test('runAgentLoop persists scoped bash rules when the user allows a command always', async () => {
    const cwd = makeTempDir('iriscode-agent-project-');
    const home = makeTempDir('iriscode-agent-home-');
    let streamCalls = 0;
    const adapter = new FakeAdapter('test', 'persist-bash-model', async function* () {
      streamCalls += 1;
      if (streamCalls === 1) {
        yield {
          type: 'tool_call',
          toolCall: { id: 'tool-1', name: 'bash', input: { command: 'echo hello > note.txt' } },
        };
        yield { type: 'done', stopReason: 'tool_use', inputTokens: 1, outputTokens: 1 };
        return;
      }

      yield { type: 'text', text: 'done' };
      yield { type: 'done', stopReason: 'end_turn', inputTokens: 1, outputTokens: 1 };
    });

    const modelRegistry = new ModelRegistry();
    modelRegistry.register('test/persist-bash-model', adapter);
    const tools = new ToolRegistry();
    tools.register({
      definition: {
        name: 'bash',
        description: 'Run a shell command',
        inputSchema: {
          type: 'object',
          properties: { command: { type: 'string' } },
          required: ['command'],
        },
      },
      async execute(input) {
        return { content: `ran:${String(input.command)}` };
      },
    });

    await withEnv({ HOME: home }, async () => {
      const permissions = new PermissionEngine('default', cwd);
      const result = await runAgentLoop([{ role: 'user', content: 'Write a note' }], {
        adapter,
        tools,
        permissions,
        modelRegistry,
        cwd,
        onPermissionPrompt: async () => 'allow-always',
      });

      expect(result.finalText).toBe('done');

      const settings = JSON.parse(
        readFileSync(join(cwd, PROJECT_STATE_DIR, PROJECT_SETTINGS_FILE), 'utf-8'),
      ) as { permissions?: { allow?: string[] } };

      expect(settings.permissions?.allow).toContain('Bash(echo hello > note.txt)');
      await expect(
        permissions.check({
          toolName: 'bash',
          input: { command: 'pwd' },
          sessionId: 'session-2',
        }),
      ).resolves.toMatchObject({ decision: 'prompt' });
      await expect(
        permissions.check({
          toolName: 'bash',
          input: { command: 'echo hello > note.txt' },
          sessionId: 'session-3',
        }),
      ).resolves.toMatchObject({ decision: 'allow' });
    });

    cleanupDir(cwd);
    cleanupDir(home);
  });
});
