import { describe, expect, test } from 'bun:test';
import { homedir } from 'os';
import { resolve } from 'path';
import { getProjectHash, getProjectDir, getSessionDir } from '../project-hash.ts';

describe('project-hash', () => {
  test('getProjectHash returns 12-char hex string for any path', () => {
    const hash = getProjectHash('/Users/alice/myproject');
    expect(hash).toMatch(/^[0-9a-f]{12}$/);
  });

  test('getProjectHash is stable (same input → same output)', () => {
    const a = getProjectHash('/Users/alice/myproject');
    const b = getProjectHash('/Users/alice/myproject');
    expect(a).toBe(b);
  });

  test('getProjectHash differs for different paths', () => {
    const a = getProjectHash('/Users/alice/proj1');
    const b = getProjectHash('/Users/alice/proj2');
    expect(a).not.toBe(b);
  });

  test('getProjectHash resolves relative paths to absolute before hashing', () => {
    const a = getProjectHash(process.cwd());
    const b = getProjectHash('.');
    expect(a).toBe(b);
  });

  test('getProjectDir returns ~/.iris/projects/<hash>/', () => {
    const dir = getProjectDir('/some/project');
    const hash = getProjectHash('/some/project');
    const expected = resolve(process.env.HOME ?? homedir(), '.iris', 'projects', hash);
    expect(dir).toBe(expected);
  });

  test('getSessionDir returns ~/.iris/projects/<hash>/<sessionId>/', () => {
    const dir = getSessionDir('/some/project', 'abc12345');
    const hash = getProjectHash('/some/project');
    const expected = resolve(process.env.HOME ?? homedir(), '.iris', 'projects', hash, 'abc12345');
    expect(dir).toBe(expected);
  });
});
