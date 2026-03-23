import type { ResolvedConfig } from '../config/schema.ts';
import type { PermissionEngine } from '../permissions/engine.ts';
import type { McpRegistry } from '../mcp/registry.ts';
import { Session } from './session.ts';

export function createHeadlessSession(options: {
  cwd: string;
  config: ResolvedConfig;
  permissionEngine: PermissionEngine;
  model: string;
  mcpRegistry?: McpRegistry;
}) {
  return new Session({
    cwd: options.cwd,
    config: options.config,
    permissionEngine: options.permissionEngine,
    model: options.model,
    autosave: false,
    mcpRegistry: options.mcpRegistry,
  });
}
