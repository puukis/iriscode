import type { CommandContext, CommandResult } from '../commands/types.ts';
import type { CommandRegistry } from '../commands/registry.ts';
import { runCustomCommand } from '../commands/custom/runner.ts';
import { runSkillCommand } from '../commands/skill-bridge.ts';

export interface InputHandlerContext extends CommandContext {
  registry: CommandRegistry;
}

export async function handleInput(
  input: string,
  ctx: InputHandlerContext,
): Promise<'handled' | 'passthrough'> {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) {
    return 'passthrough';
  }

  const { name, args } = parseSlashCommand(trimmed);
  if (!name) {
    ctx.session.writeError('Type a slash command or use /help to list commands.');
    return 'handled';
  }

  const command = ctx.registry.get(name);
  if (!command) {
    const suggestions = ctx.registry.search(name).map((entry) => `/${entry.name}`);
    const suggestionText = suggestions.length > 0
      ? `Unknown command "/${name}". Did you mean: ${suggestions.join(', ')}?`
      : `Unknown command "/${name}".`;
    ctx.session.writeError(suggestionText);
    return 'handled';
  }

  if (command.handler) {
    const result = await command.handler({
      args,
      session: ctx.session,
      config: ctx.config,
      engine: ctx.engine,
      cwd: ctx.cwd,
      registry: ctx.registry,
      compactionManager: ctx.compactionManager,
      modelRegistry: ctx.modelRegistry,
      mcpRegistry: ctx.mcpRegistry,
      skillResult: ctx.skillResult,
      hookRegistry: ctx.hookRegistry,
      pluginResult: ctx.pluginResult,
    });
    return handleCommandResult(result, ctx);
  }

  const result = command.entry.category === 'skill'
    ? runSkillCommand(command.entry.name, args, ctx)
    : await runCustomCommand(command.entry, args, ctx.cwd);
  return handleCommandResult(result, ctx);
}

function parseSlashCommand(input: string): { name: string; args: string[] } {
  const body = input.replace(/^\/+/, '').trim();
  if (!body) {
    return { name: '', args: [] };
  }

  const parts = body.split(/\s+/);
  return {
    name: parts[0].toLowerCase(),
    args: parts.slice(1),
  };
}

async function handleCommandResult(
  result: CommandResult,
  ctx: InputHandlerContext,
): Promise<'handled'> {
  if (result.type === 'error') {
    ctx.session.writeError(result.message);
    return 'handled';
  }

  if (result.type === 'prompt') {
    await ctx.session.runPrompt({
      text: result.text,
      allowedTools: result.allowedTools,
      model: result.model,
    });
    return 'handled';
  }

  return 'handled';
}
