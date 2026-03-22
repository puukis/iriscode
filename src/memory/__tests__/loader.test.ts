import { describe, expect, test } from 'bun:test';
import { join } from 'path';
import { loadIrisHierarchy, estimateTokens } from '../loader.ts';
import { cleanupDir, makeTempDir, withEnv, writeFile } from '../../shared/test-helpers.ts';

describe('estimateTokens', () => {
  test('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  test('approximates 4 chars per token', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcdefgh')).toBe(2);
    expect(estimateTokens('abc')).toBe(1); // Math.ceil(3/4) = 1
  });
});

describe('loadIrisHierarchy', () => {
  test('returns empty result when no IRIS.md files exist', async () => {
    const cwd = makeTempDir('iris-loader-');
    const home = makeTempDir('iris-loader-home-');
    await withEnv({ HOME: home }, async () => {
      const result = await loadIrisHierarchy(cwd);
      expect(result.contextText).toBe('');
      expect(result.sources).toEqual([]);
      expect(result.totalTokens).toBe(0);
      expect(result.totalLines).toBe(0);
    });
    cleanupDir(cwd);
    cleanupDir(home);
  });

  test('loads global IRIS.md from ~/.iris/', async () => {
    const cwd = makeTempDir('iris-loader-');
    const home = makeTempDir('iris-loader-home-');
    writeFile(join(home, '.iris', 'IRIS.md'), 'Global context here.\n');
    await withEnv({ HOME: home }, async () => {
      const result = await loadIrisHierarchy(cwd);
      expect(result.contextText).toContain('Global context here.');
      expect(result.sources.length).toBeGreaterThanOrEqual(1);
    });
    cleanupDir(cwd);
    cleanupDir(home);
  });

  test('loads project IRIS.md and merges with global', async () => {
    const cwd = makeTempDir('iris-loader-');
    const home = makeTempDir('iris-loader-home-');
    writeFile(join(home, '.iris', 'IRIS.md'), 'Global.\n');
    writeFile(join(cwd, 'IRIS.md'), '# Project context\n');
    await withEnv({ HOME: home }, async () => {
      const result = await loadIrisHierarchy(cwd);
      expect(result.contextText).toContain('Global.');
      expect(result.contextText).toContain('Project context');
      expect(result.sources.length).toBeGreaterThanOrEqual(2);
    });
    cleanupDir(cwd);
    cleanupDir(home);
  });

  test('strips yaml config blocks from IRIS.md before inclusion', async () => {
    const cwd = makeTempDir('iris-loader-');
    const home = makeTempDir('iris-loader-home-');
    writeFile(join(cwd, 'IRIS.md'), [
      '# My Project',
      '',
      '## Config',
      '```yaml',
      'model: anthropic/claude-sonnet-4-6',
      '```',
      '',
      'Actual context text.',
    ].join('\n') + '\n');
    await withEnv({ HOME: home }, async () => {
      const result = await loadIrisHierarchy(cwd);
      expect(result.contextText).toContain('Actual context text.');
      expect(result.contextText).not.toContain('model: anthropic');
    });
    cleanupDir(cwd);
    cleanupDir(home);
  });

  test('files are separated by newline---newline', async () => {
    const cwd = makeTempDir('iris-loader-');
    const home = makeTempDir('iris-loader-home-');
    writeFile(join(home, '.iris', 'IRIS.md'), 'Global.\n');
    writeFile(join(cwd, 'IRIS.md'), 'Project.\n');
    await withEnv({ HOME: home }, async () => {
      const result = await loadIrisHierarchy(cwd);
      expect(result.contextText).toContain('\n---\n');
    });
    cleanupDir(cwd);
    cleanupDir(home);
  });

  test('totalTokens and totalLines aggregate across all files', async () => {
    const cwd = makeTempDir('iris-loader-');
    const home = makeTempDir('iris-loader-home-');
    writeFile(join(home, '.iris', 'IRIS.md'), 'Line one.\n');
    writeFile(join(cwd, 'IRIS.md'), 'Line two.\n');
    await withEnv({ HOME: home }, async () => {
      const result = await loadIrisHierarchy(cwd);
      expect(result.totalLines).toBeGreaterThan(0);
      expect(result.totalTokens).toBeGreaterThan(0);
    });
    cleanupDir(cwd);
    cleanupDir(home);
  });
});
