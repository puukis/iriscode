import type { HookDefinition, HookEvent } from './types.ts';

interface RegisteredHook {
  hook: HookDefinition;
  scriptBaseDir: string;
}

export class HookRegistry {
  private readonly hooks: RegisteredHook[] = [];

  register(hook: HookDefinition, scriptBaseDir: string): void {
    const next: RegisteredHook = {
      hook: {
        ...hook,
        env: hook.env ? { ...hook.env } : undefined,
      },
      scriptBaseDir,
    };
    const index = this.hooks.findIndex((entry) =>
      entry.hook.name === hook.name
      && entry.hook.event === hook.event
      && entry.hook.timing === hook.timing
      && entry.scriptBaseDir === scriptBaseDir,
    );
    if (index >= 0) {
      this.hooks[index] = next;
      return;
    }
    this.hooks.push(next);
  }

  getPreHooks(event: HookEvent): RegisteredHook[] {
    return this.getHooks(event, 'pre');
  }

  getPostHooks(event: HookEvent): RegisteredHook[] {
    return this.getHooks(event, 'post');
  }

  list(): HookDefinition[] {
    return this.hooks.map(({ hook }) => ({
      ...hook,
      env: hook.env ? { ...hook.env } : undefined,
    }));
  }

  clear(): void {
    this.hooks.length = 0;
  }

  private getHooks(event: HookEvent, timing: HookDefinition['timing']): RegisteredHook[] {
    return this.hooks.filter(({ hook }) =>
      hook.timing === timing && matchesEvent(hook.event, event),
    );
  }
}

function matchesEvent(registered: HookEvent, actual: HookEvent): boolean {
  if (registered === actual) {
    return true;
  }

  return registered === 'tool:*' && actual.startsWith('tool:');
}
