import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';
import { z } from 'zod';
import { HookRegistry } from './registry.ts';
import type { HookDefinition } from './types.ts';

const HookDefinitionSchema = z.object({
  name: z.string().min(1),
  event: z.string().min(1),
  timing: z.enum(['pre', 'post']),
  description: z.string().min(1).optional(),
  command: z.string().min(1),
  timeout_sec: z.number().int().positive().optional(),
  env: z.record(z.string(), z.string()).optional(),
}).strict();

const HookFileSchema = z.object({
  hooks: z.array(HookDefinitionSchema).default([]),
}).strict();

export async function loadHooks(
  cwd: string,
  registry: HookRegistry,
): Promise<{ loaded: number; errors: string[] }> {
  const errors: string[] = [];
  let loaded = 0;
  const files = [
    resolve(process.env.HOME ?? homedir(), '.iris', 'hooks', 'hooks.json'),
    resolve(cwd, '.iris', 'hooks', 'hooks.json'),
  ];

  for (const filePath of files) {
    const result = registerHooksFromFile(filePath, registry);
    loaded += result.loaded;
    errors.push(...result.errors);
  }

  return { loaded, errors };
}

export function registerHooksFromFile(
  filePath: string,
  registry: HookRegistry,
): { loaded: number; errors: string[] } {
  if (!existsSync(filePath)) {
    return { loaded: 0, errors: [] };
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown;
    const validation = HookFileSchema.safeParse(parsed);
    if (!validation.success) {
      return {
        loaded: 0,
        errors: validation.error.issues.map((issue) => `${filePath}: ${issue.path.join('.') || '(root)'} ${issue.message}`),
      };
    }

    const scriptBaseDir = resolve(dirname(filePath), 'scripts');
    validation.data.hooks.forEach((hook) => {
      registry.register(hook as HookDefinition, scriptBaseDir);
    });

    return {
      loaded: validation.data.hooks.length,
      errors: [],
    };
  } catch (error) {
    return {
      loaded: 0,
      errors: [`${filePath}: ${error instanceof Error ? error.message : String(error)}`],
    };
  }
}
