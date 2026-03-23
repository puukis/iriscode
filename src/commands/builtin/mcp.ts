import { loadGlobalConfigSync, writeGlobalConfig } from '../../config/global.ts';
import { mcpLogin } from '../../mcp/oauth.ts';
import type { McpServerConfig, McpServerState, McpTool } from '../../mcp/types.ts';
import type { BuiltinHandler, CommandEntry, PickerOption } from '../types.ts';

export const MCP_COMMAND: CommandEntry = {
  name: 'mcp',
  description: 'Manage MCP servers, tools, and authentication.',
  category: 'builtin',
};

export const handleMcp: BuiltinHandler = async (ctx) => {
  try {
    if (!ctx.mcpRegistry) {
      ctx.session.writeInfo('MCP registry is unavailable in this session.');
      return { type: 'handled' };
    }

    const action = await ctx.session.openMcpMenu();
    if (!action) {
      return { type: 'handled' };
    }

    switch (action) {
      case 'list-servers':
        ctx.session.writeInfo(renderServerTable(ctx.mcpRegistry.getServerStates()));
        return { type: 'handled' };
      case 'show-tools':
        ctx.session.writeInfo(renderToolList(ctx.mcpRegistry.getTools()));
        return { type: 'handled' };
      case 'reconnect':
        await reconnectServer(ctx);
        return { type: 'handled' };
      case 'login':
        await loginServer(ctx);
        return { type: 'handled' };
      case 'add-server':
        await addServer(ctx);
        return { type: 'handled' };
      case 'remove-server':
        await removeServer(ctx);
        return { type: 'handled' };
    }

    return { type: 'handled' };
  } catch (error) {
    return { type: 'error', message: error instanceof Error ? error.message : String(error) };
  }
};

async function reconnectServer(ctx: Parameters<BuiltinHandler>[0]): Promise<void> {
  const states = ctx.mcpRegistry!.getServerStates();
  if (states.length === 0) {
    ctx.session.writeInfo('No MCP servers configured.');
    return;
  }

  const selected = await pickServer(ctx, states, 'Reconnect MCP server');
  if (!selected) {
    ctx.session.writeInfo('Reconnect cancelled.');
    return;
  }

  await ctx.mcpRegistry!.reconnect(selected);
  ctx.session.writeInfo(`Reconnected MCP server: ${selected}`);
}

async function loginServer(ctx: Parameters<BuiltinHandler>[0]): Promise<void> {
  const eligible = ctx.mcpRegistry!.getServerStates().filter((state) => state.config.type === 'http' && state.config.url);
  if (eligible.length === 0) {
    ctx.session.writeInfo('No HTTP MCP servers with OAuth-capable URLs are configured.');
    return;
  }

  const selected = await pickServer(ctx, eligible, 'Login to MCP server');
  if (!selected) {
    ctx.session.writeInfo('Login cancelled.');
    return;
  }

  const server = ctx.mcpRegistry!.getServer(selected);
  if (!server?.config.url) {
    ctx.session.writeInfo(`MCP server "${selected}" does not have an HTTP URL.`);
    return;
  }

  await mcpLogin(server.config.name, server.config.url);
  await ctx.mcpRegistry!.reconnect(server.config.name);
  await ctx.session.refreshContext();
  ctx.session.writeInfo(`OAuth login completed for MCP server: ${server.config.name}`);
}

async function addServer(ctx: Parameters<BuiltinHandler>[0]): Promise<void> {
  const name = (await ctx.session.ask('MCP server name:')).trim();
  if (!name) {
    ctx.session.writeInfo('Add server cancelled.');
    return;
  }

  const typeAnswer = (await ctx.session.ask('Connection type [stdio/http]:')).trim().toLowerCase();
  const type = typeAnswer === 'http' ? 'http' : typeAnswer === 'stdio' ? 'stdio' : '';
  if (!type) {
    ctx.session.writeInfo('Invalid server type. Use "stdio" or "http".');
    return;
  }

  const config: McpServerConfig = {
    name,
    type,
    enabled: true,
    required: false,
  };

  if (type === 'stdio') {
    const command = (await ctx.session.ask('Command:')).trim();
    if (!command) {
      ctx.session.writeInfo('A stdio server requires a command.');
      return;
    }
    const argsInput = (await ctx.session.ask('Arguments (optional, shell-style):')).trim();
    config.command = command;
    config.args = argsInput ? parseCommandArgs(argsInput) : [];
  } else {
    const url = (await ctx.session.ask('Server URL:')).trim();
    if (!url) {
      ctx.session.writeInfo('An HTTP server requires a URL.');
      return;
    }
    config.url = url;
    const tokenEnvVar = (await ctx.session.ask('Bearer token env var (optional):')).trim();
    if (tokenEnvVar) {
      config.bearer_token_env_var = tokenEnvVar;
    }
  }

  persistServerConfig((servers) => upsertServer(servers, config));
  await ctx.mcpRegistry!.addServer(config);
  await ctx.session.refreshContext();
  ctx.session.writeInfo(`Added MCP server: ${config.name}`);
}

async function removeServer(ctx: Parameters<BuiltinHandler>[0]): Promise<void> {
  const states = ctx.mcpRegistry!.getServerStates();
  if (states.length === 0) {
    ctx.session.writeInfo('No MCP servers configured.');
    return;
  }

  const selected = await pickServer(ctx, states, 'Remove MCP server');
  if (!selected) {
    ctx.session.writeInfo('Remove server cancelled.');
    return;
  }

  const confirmation = (await ctx.session.ask(`Remove MCP server "${selected}"? [y/N]`)).trim().toLowerCase();
  if (!['y', 'yes'].includes(confirmation)) {
    ctx.session.writeInfo('Remove server cancelled.');
    return;
  }

  persistServerConfig((servers) => servers.filter((server) => server.name !== selected));
  await ctx.mcpRegistry!.removeServer(selected);
  await ctx.session.refreshContext();
  ctx.session.writeInfo(`Removed MCP server: ${selected}`);
}

async function pickServer(
  ctx: Parameters<BuiltinHandler>[0],
  states: McpServerState[],
  title: string,
): Promise<string | undefined> {
  const options: PickerOption[] = states.map((state) => ({
    label: `${state.config.name} (${state.config.type})`,
    value: state.config.name,
    description: state.status === 'connected'
      ? `${state.tools.length} tools`
      : state.error ?? state.status,
  }));
  return ctx.session.openPicker(options, title);
}

function renderServerTable(states: McpServerState[]): string {
  if (states.length === 0) {
    return 'No MCP servers configured.';
  }

  const rows = states.map((state) => ({
    name: state.config.name,
    type: state.config.type,
    status: state.status,
    tools: String(state.tools.length),
    target: state.config.type === 'http'
      ? (state.config.url ?? '(missing url)')
      : [state.config.command ?? '(missing command)', ...(state.config.args ?? [])].join(' '),
  }));

  const widths = {
    name: Math.max('name'.length, ...rows.map((row) => row.name.length)),
    type: Math.max('type'.length, ...rows.map((row) => row.type.length)),
    status: Math.max('status'.length, ...rows.map((row) => row.status.length)),
    tools: Math.max('tools'.length, ...rows.map((row) => row.tools.length)),
  };

  return [
    `${'name'.padEnd(widths.name)}  ${'type'.padEnd(widths.type)}  ${'status'.padEnd(widths.status)}  ${'tools'.padEnd(widths.tools)}  target`,
    ...rows.map((row) =>
      `${row.name.padEnd(widths.name)}  ${row.type.padEnd(widths.type)}  ${row.status.padEnd(widths.status)}  ${row.tools.padEnd(widths.tools)}  ${row.target}`,
    ),
  ].join('\n');
}

function renderToolList(tools: McpTool[]): string {
  if (tools.length === 0) {
    return 'No MCP tools available.';
  }

  const grouped = new Map<string, McpTool[]>();
  for (const tool of tools) {
    grouped.set(tool.serverName, [...(grouped.get(tool.serverName) ?? []), tool]);
  }

  const lines: string[] = [];
  for (const [serverName, serverTools] of grouped) {
    lines.push(`${serverName}:`);
    for (const tool of serverTools.sort((left, right) => left.name.localeCompare(right.name))) {
      lines.push(`  ${tool.name} - ${tool.description || '(no description)'}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

function persistServerConfig(
  update: (servers: McpServerConfig[]) => McpServerConfig[],
): void {
  const current = loadGlobalConfigSync().config;
  writeGlobalConfig({
    ...current,
    mcp_servers: update([...(current.mcp_servers ?? [])]),
  });
}

function upsertServer(servers: McpServerConfig[], next: McpServerConfig): McpServerConfig[] {
  const filtered = servers.filter((server) => server.name !== next.name);
  filtered.push(next);
  return filtered;
}

function parseCommandArgs(value: string): string[] {
  const matches = value.match(/"([^"]*)"|'([^']*)'|\S+/g) ?? [];
  return matches.map((part) => part.replace(/^['"]|['"]$/g, ''));
}
