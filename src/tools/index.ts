import type { ToolDefinitionSchema } from '../shared/types.ts';

export interface Tool {
  readonly definition: ToolDefinitionSchema;
  execute(input: Record<string, unknown>): Promise<string>;
}

export type { ToolDefinitionSchema };

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.definition.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getDefinitions(): ToolDefinitionSchema[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }
}
