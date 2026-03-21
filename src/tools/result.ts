import type { ToolResult } from '../shared/types.ts';

export function ok(content: string): ToolResult {
  return { content };
}

export function fail(toolName: string, message: string): ToolResult {
  return {
    content: `[${toolName}] ${message}`,
    isError: true,
  };
}

export function toJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
