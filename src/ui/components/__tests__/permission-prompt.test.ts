import { describe, expect, test } from 'bun:test';
import {
  describePermissionRequest,
  formatPermissionInput,
  getPermissionRiskLevel,
} from '../permission-prompt.tsx';

describe('permission prompt', () => {
  test('derives human-readable descriptions from tool requests', () => {
    expect(
      describePermissionRequest({
        toolName: 'bash',
        input: { command: 'rm -rf dist' },
        sessionId: 's1',
      }),
    ).toContain('bash: rm -rf dist');

    expect(
      describePermissionRequest({
        toolName: 'todo-write',
        input: { todos: [{ id: '1', task: 'ship', status: 'pending' }] },
        sessionId: 's1',
      }),
    ).toBe('todo-write: 1 todos');
  });

  test('formats input and reports risk levels', () => {
    expect(formatPermissionInput({ path: 'src/index.ts', content: 'hello' })).toContain('"path": "src/index.ts"');
    expect(getPermissionRiskLevel('read')).toBe('low');
    expect(getPermissionRiskLevel('write')).toBe('medium');
    expect(getPermissionRiskLevel('bash')).toBe('high');
  });
});
