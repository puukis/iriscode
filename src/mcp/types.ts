export type McpServerType = 'stdio' | 'http';

export interface McpServerConfig {
  name: string;
  type: McpServerType;
  command?: string;
  args?: string[];
  url?: string;
  bearer_token_env_var?: string;
  http_headers?: Record<string, string>;
  env_http_headers?: Record<string, string>;
  startup_timeout_sec?: number;
  tool_timeout_sec?: number;
  enabled?: boolean;
  required?: boolean;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  } & Record<string, unknown>;
  serverName: string;
}

export type McpServerStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface McpServerState {
  config: McpServerConfig;
  status: McpServerStatus;
  tools: McpTool[];
  error?: string;
  connectedAt?: Date;
}

export type McpCallContent =
  | { type: 'text'; text: string }
  | { type: 'error'; text: string };

export interface McpCallResult {
  content: McpCallContent[];
  isError: boolean;
}
