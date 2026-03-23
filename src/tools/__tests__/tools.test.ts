import { describe, expect, test } from 'bun:test';
import { createDefaultRegistry } from '../index.ts';
import { fail, ok, toJson } from '../result.ts';
import type { McpRegistry } from '../../mcp/registry.ts';

describe('tools', () => {
  test('createDefaultRegistry registers aliases and provider-aware web-search visibility', () => {
    const anthropicRegistry = createDefaultRegistry({ currentModel: 'anthropic/claude-sonnet-4-6' });
    expect(anthropicRegistry.has('read')).toBe(true);
    expect(anthropicRegistry.has('read_file')).toBe(true);
    expect(anthropicRegistry.has('web-search')).toBe(true);

    const bedrockRegistry = createDefaultRegistry({ currentModel: 'bedrock/anthropic.claude-sonnet-4' });
    expect(bedrockRegistry.has('web-search')).toBe(false);
  });

  test('allowedTools filtering applies to MCP tools', () => {
    const mcpRegistry = {
      getTools() {
        return [
          {
            name: 'read_text_file',
            description: 'Read a file',
            inputSchema: { type: 'object', properties: {} },
            serverName: 'filesystem',
          },
        ];
      },
    } as Pick<McpRegistry, 'getTools'> as McpRegistry;

    const unrestricted = createDefaultRegistry({
      currentModel: 'anthropic/claude-sonnet-4-6',
      mcpRegistry,
    });
    expect(unrestricted.has('filesystem:read_text_file')).toBe(true);

    const blocked = createDefaultRegistry({
      currentModel: 'anthropic/claude-sonnet-4-6',
      mcpRegistry,
      allowedTools: [],
    });
    expect(blocked.has('filesystem:read_text_file')).toBe(false);

    const allowed = createDefaultRegistry({
      currentModel: 'anthropic/claude-sonnet-4-6',
      mcpRegistry,
      allowedTools: ['filesystem:read_text_file'],
    });
    expect(allowed.has('filesystem:read_text_file')).toBe(true);
  });

  test('result helpers format success, error, and json payloads', () => {
    expect(ok('done')).toEqual({ content: 'done' });
    expect(fail('tool', 'bad input')).toEqual({ content: '[tool] bad input', isError: true });
    expect(toJson({ ok: true })).toBe('{\n  "ok": true\n}');
  });
});
