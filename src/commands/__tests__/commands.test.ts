import { describe, expect, test } from 'bun:test';
import { join } from 'path';
import { CostTracker } from '../../cost/tracker.ts';
import { DiffStore } from '../../diff/store.ts';
import { PermissionEngine } from '../../permissions/engine.ts';
import { createDefaultRegistry as createCommandRegistry, CommandRegistry } from '../registry.ts';
import { loadCustomCommands } from '../custom/loader.ts';
import { runCustomCommand } from '../custom/runner.ts';
import { registerSkillCommands } from '../skill-bridge.ts';
import { handleInput } from '../../cli/input-handler.ts';
import type {
  CommandContext,
  LoadedMemoryFile,
  SessionSnapshot,
  SessionSnapshotSummary,
  SessionState,
} from '../types.ts';
import {
  cleanupDir,
  makeTempDir,
  withEnv,
  writeFile,
} from '../../shared/test-helpers.ts';

describe('commands', () => {
  test('registry search ranks typo matches such as /mdoels', async () => {
    const cwd = makeTempDir('iriscode-commands-project-');
    const home = makeTempDir('iriscode-commands-home-');

    await withEnv({ HOME: home }, async () => {
      const ctx = makeCommandContext(cwd);
      const registry = createCommandRegistry(ctx);
      expect(registry.search('mdoels')[0]?.name).toBe('models');
    });

    cleanupDir(cwd);
    cleanupDir(home);
  });

  test('loadCustomCommands lets project commands override global ones', async () => {
    const cwd = makeTempDir('iriscode-commands-project-');
    const home = makeTempDir('iriscode-commands-home-');

    writeFile(join(home, '.iris', 'commands', 'review.md'), 'Global review');
    writeFile(join(cwd, '.iris', 'commands', 'review.md'), 'Project review');
    writeFile(join(home, '.iris', 'commands', 'summarize.md'), 'Global summarize');

    await withEnv({ HOME: home }, async () => {
      const commands = await loadCustomCommands(cwd);
      expect(commands.find((entry) => entry.name === 'review')?.source).toBe(
        join(cwd, '.iris', 'commands', 'review.md'),
      );
      expect(commands.find((entry) => entry.name === 'summarize')?.source).toBe(
        join(home, '.iris', 'commands', 'summarize.md'),
      );
    });

    cleanupDir(cwd);
    cleanupDir(home);
  });

  test('runCustomCommand expands arguments, inline files, and bash blocks', async () => {
    const cwd = makeTempDir('iriscode-commands-project-');
    const commandPath = join(cwd, '.iris', 'commands', 'review.md');
    writeFile(join(cwd, 'notes.txt'), 'remember this');
    writeFile(
      commandPath,
      [
        '---',
        'description: Review a file',
        'allowed-tools: [read, grep]',
        'model: openai/gpt-4o-mini',
        'argument-hint: <path>',
        '---',
        'Review $1 and $ARGUMENTS.',
        '',
        'Context:',
        '@notes.txt',
        '',
        'Shell:',
        '!`printf ok`',
      ].join('\n'),
    );

    const result = await runCustomCommand(
      {
        name: 'review',
        description: 'Review a file',
        category: 'custom',
        source: commandPath,
        allowedTools: ['read', 'grep'],
        model: 'openai/gpt-4o-mini',
      },
      ['src/index.ts', '--verbose'],
      cwd,
    );

    expect(result.type).toBe('prompt');
    if (result.type !== 'prompt') {
      throw new Error('expected prompt result');
    }
    expect(result.text).toContain('Review src/index.ts and src/index.ts --verbose.');
    expect(result.text).toContain('remember this');
    expect(result.text).toContain('ok');
    expect(result.allowedTools).toEqual(['read', 'grep']);
    expect(result.model).toBe('openai/gpt-4o-mini');

    cleanupDir(cwd);
  });

  test('registerSkillCommands gives project skill commands priority over custom commands', async () => {
    const cwd = makeTempDir('iriscode-commands-project-');
    const home = makeTempDir('iriscode-commands-home-');
    writeFile(join(cwd, '.iris', 'skills', 'review.skill.md'), 'Project skill');
    writeFile(join(home, '.iris', 'skills', 'review.skill.md'), 'Global skill');

    await withEnv({ HOME: home }, async () => {
      const registry = new CommandRegistry();
      registry.registerCustom({
        name: 'review',
        description: 'Custom review',
        category: 'custom',
        source: join(cwd, '.iris', 'commands', 'review.md'),
      });

      await registerSkillCommands(registry, cwd);
      const resolved = registry.get('review');
      expect(resolved?.entry.category).toBe('skill');
      expect(resolved?.entry.source).toBe(join(cwd, '.iris', 'skills', 'review.skill.md'));
    });

    cleanupDir(cwd);
    cleanupDir(home);
  });

  test('handleInput expands slash custom commands before sending them to the session', async () => {
    const cwd = makeTempDir('iriscode-commands-project-');
    const home = makeTempDir('iriscode-commands-home-');
    const commandPath = join(cwd, '.iris', 'commands', 'review.md');
    writeFile(commandPath, 'Review $ARGUMENTS.');

    await withEnv({ HOME: home }, async () => {
      const ctx = makeCommandContext(cwd);
      const registry = createCommandRegistry(ctx);
      registry.registerCustom({
        name: 'review',
        description: 'Review files',
        category: 'custom',
        source: commandPath,
      });

      const result = await handleInput('/review src/auth.ts', {
        ...ctx,
        registry,
      });

      expect(result).toBe('handled');
      expect(ctx.__runPromptCalls).toEqual([
        {
          text: 'Review src/auth.ts.',
          allowedTools: undefined,
          model: undefined,
        },
      ]);
    });

    cleanupDir(cwd);
    cleanupDir(home);
  });

  test('handleInput suggests similar commands for unknown slash inputs', async () => {
    const cwd = makeTempDir('iriscode-commands-project-');
    const home = makeTempDir('iriscode-commands-home-');

    await withEnv({ HOME: home }, async () => {
      const ctx = makeCommandContext(cwd);
      const registry = createCommandRegistry(ctx);
      const result = await handleInput('/mdoels', { ...ctx, registry });

      expect(result).toBe('handled');
      expect(ctx.__systemMessages.some((message) => message.includes('/models'))).toBe(true);
    });

    cleanupDir(cwd);
    cleanupDir(home);
  });

  test('handleInput renders diff summaries for /diff', async () => {
    const cwd = makeTempDir('iriscode-commands-project-');
    const home = makeTempDir('iriscode-commands-home-');

    await withEnv({ HOME: home }, async () => {
      const ctx = makeCommandContext(cwd);
      ctx.session.diffStore.add(
        {
          filePath: join(cwd, 'src', 'index.ts'),
          before: 'old\n',
          after: 'new\n',
          hunks: [],
          stats: { added: 1, removed: 1, unchanged: 0 },
          isEmpty: false,
        },
        'accepted',
      );

      const registry = createCommandRegistry(ctx);
      const result = await handleInput('/diff', { ...ctx, registry });

      expect(result).toBe('handled');
      expect(ctx.__systemMessages.some((message) => message.includes('Session diffs'))).toBe(true);
    });

    cleanupDir(cwd);
    cleanupDir(home);
  });
});

function makeCommandContext(cwd: string): CommandContext & {
  __systemMessages: string[];
  __runPromptCalls: Array<{ text: string; allowedTools?: string[]; model?: string }>;
} {
  const systemMessages: string[] = [];
  const runPromptCalls: Array<{ text: string; allowedTools?: string[]; model?: string }> = [];
  const session = createMockSession(systemMessages, runPromptCalls);

  return {
    args: [],
    session,
    config: {
      model: 'openai/gpt-4o-mini',
      default_model: 'openai/gpt-4o-mini',
      permissions: { mode: 'default', allowed_tools: [], disallowed_tools: [] },
      providers: {
        anthropic: { apiKey: null, baseUrl: null },
        openai: { apiKey: null, baseUrl: null },
        google: { apiKey: null, baseUrl: null },
        groq: { apiKey: null, baseUrl: null },
        mistral: { apiKey: null, baseUrl: null },
        deepseek: { apiKey: null, baseUrl: null },
        xai: { apiKey: null, baseUrl: null },
        perplexity: { apiKey: null, baseUrl: null },
        together: { apiKey: null, baseUrl: null },
        fireworks: { apiKey: null, baseUrl: null },
        cohere: { apiKey: null, baseUrl: null },
        openrouter: { apiKey: null, baseUrl: null },
        ollama: { apiKey: null, baseUrl: 'http://localhost:11434' },
      },
      memory: { max_tokens: 10000, max_lines: 200, warn_at: 8000 },
      mcp_servers: [],
      context_text: '',
      log_level: 'warn',
    },
    engine: new PermissionEngine('default', cwd),
    cwd,
    __systemMessages: systemMessages,
    __runPromptCalls: runPromptCalls,
  };
}

function createMockSession(
  systemMessages: string[],
  runPromptCalls: Array<{ text: string; allowedTools?: string[]; model?: string }>,
): SessionState {
  const displayMessages: Array<{ role: 'user' | 'assistant' | 'system'; text: string }> = [];
  const memoryFiles: LoadedMemoryFile[] = [];
  const costTracker = new CostTracker();
  const diffStore = new DiffStore();

  return {
    id: 'session-test',
    startedAt: Date.now(),
    messages: [],
    displayMessages,
    model: 'openai/gpt-4o-mini',
    permissionMode: 'default',
    totalInputTokens: 0,
    totalOutputTokens: 0,
    contextText: '',
    memoryFiles,
    memoryMaxTokens: 10000,
    costTracker,
    diffStore,
    clear() {
      displayMessages.length = 0;
    },
    compact(summary: string) {
      systemMessages.push(summary);
    },
    async setModel() {},
    setMode() {},
    async runPrompt(request) {
      runPromptCalls.push({
        text: request.text,
        allowedTools: request.allowedTools,
        model: request.model,
      });
    },
    async executePrompt(request) {
      return request.text;
    },
    writeInfo(text: string) {
      systemMessages.push(text);
    },
    writeError(text: string) {
      systemMessages.push(text);
    },
    async ask() {
      return 'y';
    },
    getToolDefinitions() {
      return [];
    },
    async openModelPicker() {
      return undefined;
    },
    async openSessionPicker(_sessions: SessionSnapshotSummary[]) {
      return undefined;
    },
    async viewDiff() {
      return undefined;
    },
    restoreSession(_snapshot: SessionSnapshot) {},
    async refreshContext() {},
  };
}
