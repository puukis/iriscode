import type { ToolRegistry, Tool } from '../tools/index.ts';
import type { ToolResult } from '../shared/types.ts';
import type { McpRegistry } from './registry.ts';
import type { McpCallResult, McpTool } from './types.ts';

export function registerMcpTools(
  registry: ToolRegistry,
  mcpRegistry: McpRegistry,
  options: { allowedTools?: Set<string> | null } = {},
): void {
  for (const tool of mcpRegistry.getTools()) {
    const namespacedName = `${tool.serverName}:${tool.name}`;
    if (options.allowedTools && !options.allowedTools.has(namespacedName.toLowerCase())) {
      continue;
    }

    const wrapped: Tool = {
      definition: {
        name: namespacedName,
        description: `[MCP: ${tool.serverName}] ${tool.description}`,
        inputSchema: tool.inputSchema,
        risk: 'medium',
      },
      async execute(input): Promise<ToolResult> {
        const result = await mcpRegistry.callTool(tool.serverName, tool.name, input);
        return mapMcpResult(result);
      },
    };

    registry.register(wrapped);
  }
}

function mapMcpResult(result: McpCallResult): ToolResult {
  return {
    content: result.content.map((entry) => entry.text).join('\n').trim(),
    isError: result.isError,
  };
}
