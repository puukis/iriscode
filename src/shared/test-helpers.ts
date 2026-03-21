import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { BaseAdapter, type TokenCost } from '../models/base-adapter.ts';
import { ModelRegistry } from '../models/registry.ts';
import { PermissionsEngine } from '../permissions/engine.ts';
import type { StreamEvent, StreamParams, ToolResult } from './types.ts';
import { ToolRegistry, type ToolExecutionContext } from '../tools/index.ts';

export class FakeAdapter extends BaseAdapter {
  readonly provider: string;
  readonly modelId: string;
  private readonly streamImpl: (params: StreamParams) => AsyncGenerator<StreamEvent>;

  constructor(
    provider: string,
    modelId: string,
    streamImpl: (params: StreamParams) => AsyncGenerator<StreamEvent>,
  ) {
    super();
    this.provider = provider;
    this.modelId = modelId;
    this.streamImpl = streamImpl;
  }

  stream(params: StreamParams): AsyncGenerator<StreamEvent> {
    return this.streamImpl(params);
  }

  async countTokens(_params: StreamParams): Promise<number> {
    return 0;
  }

  computeCost(_inputTokens: number, _outputTokens: number): TokenCost {
    return { inputCostUsd: 0, outputCostUsd: 0, totalCostUsd: 0 };
  }
}

export function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function cleanupDir(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

export async function withEnv(
  values: Record<string, string | undefined>,
  fn: () => Promise<void>,
): Promise<void> {
  const previous = new Map<string, string | undefined>();

  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    await fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

export async function withMockFetch(
  mock: typeof fetch,
  fn: () => Promise<void>,
): Promise<void> {
  const globalObject = globalThis as typeof globalThis & { fetch: typeof fetch };
  const originalFetch = globalObject.fetch;
  globalObject.fetch = mock;

  try {
    await fn();
  } finally {
    globalObject.fetch = originalFetch;
  }
}

export async function withCwd(path: string, fn: () => Promise<void>): Promise<void> {
  const originalCwd = process.cwd();
  process.chdir(path);

  try {
    await fn();
  } finally {
    process.chdir(originalCwd);
  }
}

export async function captureStdout(fn: () => Promise<void> | void): Promise<string> {
  return captureWrite('stdout', fn);
}

export async function captureStderr(fn: () => Promise<void> | void): Promise<string> {
  return captureWrite('stderr', fn);
}

export async function captureConsole(fn: () => Promise<void> | void): Promise<string> {
  const originalLog = console.log;
  let output = '';

  console.log = (...args: unknown[]) => {
    output += `${args.map(String).join(' ')}\n`;
  };

  try {
    await fn();
    return output;
  } finally {
    console.log = originalLog;
  }
}

function captureWrite(
  streamName: 'stdout' | 'stderr',
  fn: () => Promise<void> | void,
): Promise<string> {
  const stream = process[streamName];
  const originalWrite = stream.write;
  let output = '';

  (stream.write as unknown as typeof stream.write) = ((chunk: string | Uint8Array, ...args: unknown[]) => {
    output += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
    const callback = args.find((arg) => typeof arg === 'function');
    if (typeof callback === 'function') {
      callback();
    }
    return true;
  }) as typeof stream.write;

  return Promise.resolve()
    .then(() => fn())
    .then(() => output)
    .finally(() => {
      (stream.write as typeof originalWrite) = originalWrite;
    });
}

export function runGitSync(args: string[], cwd: string): string {
  const result = Bun.spawnSync(['git', ...args], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  if (result.exitCode !== 0) {
    const stderr = result.stderr ? new TextDecoder().decode(result.stderr).trim() : '';
    throw new Error(`git ${args.join(' ')} failed: ${stderr}`);
  }

  return result.stdout ? new TextDecoder().decode(result.stdout) : '';
}

export function makeToolContext(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
  const registry = overrides.registry ?? new ToolRegistry();
  const modelRegistry = overrides.modelRegistry ?? new ModelRegistry();
  const adapter =
    overrides.adapter ??
    new FakeAdapter('test', 'mock-model', async function* () {
      yield { type: 'done', stopReason: 'end_turn', inputTokens: 0, outputTokens: 0 };
    });

  if (!modelRegistry.has(`${adapter.provider}/${adapter.modelId}`)) {
    modelRegistry.register(`${adapter.provider}/${adapter.modelId}`, adapter);
  }

  return {
    history: overrides.history ?? [],
    cwd: overrides.cwd ?? process.cwd(),
    model: overrides.model ?? `${adapter.provider}/${adapter.modelId}`,
    adapter,
    modelRegistry,
    registry,
    permissions: overrides.permissions ?? new PermissionsEngine('acceptAll'),
    loadedSkills: overrides.loadedSkills ?? [],
    subagentDepth: overrides.subagentDepth ?? 0,
    baseSystemPrompt: overrides.baseSystemPrompt,
    askUser: overrides.askUser,
    runSubagent: overrides.runSubagent,
    costTracker: overrides.costTracker,
  };
}

export function expectOk(result: ToolResult): void {
  if (result.isError === true) {
    throw new Error(`Expected successful tool result, got error: ${result.content}`);
  }
}

export function expectError(result: ToolResult): void {
  if (result.isError !== true) {
    throw new Error(`Expected error tool result, got success: ${result.content}`);
  }
}

export function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}

export function readFile(path: string): string {
  return readFileSync(path, 'utf-8');
}

export function makeJsonStreamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
    { status: 200 },
  );
}
