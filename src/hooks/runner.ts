import { resolve, sep } from 'path';
import { logger } from '../shared/logger.ts';
import type { ToolResult } from '../shared/types.ts';
import { ok } from '../tools/result.ts';
import { HookRegistry } from './registry.ts';
import type { HookContext, HookDefinition, HookEvent, HookResult } from './types.ts';

const DEFAULT_TIMEOUT_SEC = 5;

export async function runPreHooks(
  event: HookEvent,
  ctx: HookContext,
  registry: HookRegistry,
): Promise<{ action: 'continue' | 'block'; modifiedInput?: Record<string, unknown>; blockReason?: string }> {
  const hooks = registry.getPreHooks(event);
  let currentInput = ctx.input ? { ...ctx.input } : undefined;

  for (const { hook, scriptBaseDir } of hooks) {
    const result = await executeHook(hook, scriptBaseDir, {
      ...ctx,
      event,
      timing: 'pre',
      input: currentInput,
    });

    if (result.action === 'block') {
      return {
        action: 'block',
        modifiedInput: currentInput,
        blockReason: result.blockReason ?? `Hook "${hook.name}" blocked the action.`,
      };
    }

    if (result.action === 'modify' && result.modifiedInput) {
      currentInput = result.modifiedInput;
    }
  }

  return {
    action: 'continue',
    modifiedInput: currentInput,
  };
}

export async function runPostHooks(
  event: HookEvent,
  ctx: HookContext,
  registry: HookRegistry,
): Promise<ToolResult> {
  let currentResult: ToolResult = ctx.result ? { ...ctx.result } : ok('');

  for (const { hook, scriptBaseDir } of registry.getPostHooks(event)) {
    const hookResult = await executeHook(hook, scriptBaseDir, {
      ...ctx,
      event,
      timing: 'post',
      result: currentResult,
    });

    if (hookResult.action === 'modify') {
      currentResult = {
        ...currentResult,
        ...(hookResult.output !== undefined ? { content: hookResult.output } : {}),
      };
      continue;
    }

    if (hookResult.action === 'block') {
      currentResult = {
        content: hookResult.blockReason ?? `Hook "${hook.name}" blocked the result.`,
        isError: true,
      };
    }
  }

  return currentResult;
}

export async function runEventHooks(
  event: 'agent:start' | 'agent:done' | 'agent:error' | 'session:start' | 'session:end',
  ctx: HookContext,
  registry: HookRegistry,
): Promise<void> {
  const timing = event.endsWith(':start') || event === 'session:start' ? 'pre' : 'post';
  const hooks = timing === 'pre' ? registry.getPreHooks(event) : registry.getPostHooks(event);

  await Promise.allSettled(
    hooks.map(({ hook, scriptBaseDir }) =>
      executeHook(hook, scriptBaseDir, {
        ...ctx,
        event,
        timing,
      }),
    ),
  );
}

async function executeHook(
  hook: HookDefinition,
  scriptBaseDir: string,
  ctx: HookContext,
): Promise<HookResult> {
  const timeoutMs = (hook.timeout_sec ?? DEFAULT_TIMEOUT_SEC) * 1000;
  const pluginRoot = resolvePluginRoot(scriptBaseDir);
  const proc = Bun.spawn(['sh', '-lc', hook.command], {
    cwd: scriptBaseDir,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      ...process.env,
      ...(hook.env ?? {}),
      IRIS_HOOK_CONTEXT: JSON.stringify({
        ...ctx,
        ...(pluginRoot ? { pluginRoot } : {}),
      }),
      ...(pluginRoot ? { IRIS_PLUGIN_ROOT: pluginRoot } : {}),
    },
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutMs);
  timer.unref?.();

  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    if (timedOut) {
      logger.warn(`Hook "${hook.name}" timed out after ${hook.timeout_sec ?? DEFAULT_TIMEOUT_SEC}s`);
      return { action: 'continue' };
    }

    if (exitCode !== 0) {
      logger.warn(`Hook "${hook.name}" exited with code ${exitCode}: ${stderr.trim() || stdout.trim()}`);
      return { action: 'continue' };
    }

    const trimmed = stdout.trim();
    if (!trimmed) {
      return { action: 'continue' };
    }

    try {
      return JSON.parse(trimmed) as HookResult;
    } catch (error) {
      logger.warn(
        `Hook "${hook.name}" returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { action: 'continue' };
    }
  } catch (error) {
    logger.warn(`Hook "${hook.name}" failed: ${error instanceof Error ? error.message : String(error)}`);
    return { action: 'continue' };
  } finally {
    clearTimeout(timer);
    try {
      proc.kill();
    } catch {
      // process already exited
    }
  }
}

function resolvePluginRoot(scriptBaseDir: string): string | undefined {
  const normalized = resolve(scriptBaseDir);
  const marker = `${sep}.iris${sep}plugins${sep}`;
  if (!normalized.includes(marker)) {
    return undefined;
  }

  return resolve(normalized, '..', '..');
}
