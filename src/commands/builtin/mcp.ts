import type { BuiltinHandler, CommandEntry } from '../types.ts';

export const MCP_COMMAND: CommandEntry = {
  name: 'mcp',
  description: 'List configured MCP servers and their connection status.',
  category: 'builtin',
};

export const handleMcp: BuiltinHandler = async (ctx) => {
  try {
    if (ctx.config.mcp_servers.length === 0) {
      ctx.session.writeInfo('No MCP servers configured. Add them in IRIS.md or ~/.iris/config.toml');
      return { type: 'handled' };
    }

    const lines: string[] = [];
    for (const server of ctx.config.mcp_servers) {
      const status = await probeServer(server.url);
      lines.push(`${server.name} | ${server.url} | ${status ? 'connected' : 'disconnected'}`);
      if (status) {
        lines.push('  tools: unavailable (server introspection not implemented)');
      }
    }

    ctx.session.writeInfo(lines.join('\n'));
    return { type: 'handled' };
  } catch (error) {
    return { type: 'error', message: error instanceof Error ? error.message : String(error) };
  }
};

async function probeServer(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return response.ok;
  } catch {
    return false;
  }
}
