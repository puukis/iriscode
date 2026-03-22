import { describe, expect, test } from 'bun:test';
import { join } from 'path';
import { readFileSync } from 'fs';
import {
  loadMemory,
  appendToMemory,
  writeMemory,
  clearMemory,
} from '../store.ts';
import { getProjectDir } from '../project-hash.ts';
import { cleanupDir, makeTempDir, withEnv, writeFile } from '../../shared/test-helpers.ts';

describe('loadMemory', () => {
  test('returns empty content when no MEMORY.md files exist', async () => {
    const cwd = makeTempDir('memory-store-');
    const home = makeTempDir('memory-store-home-');
    await withEnv({ HOME: home }, async () => {
      const result = await loadMemory(cwd);
      expect(result.globalText).toBe('');
      expect(result.projectText).toBe('');
      expect(result.combined).toBe('');
      expect(result.totalLines).toBe(0);
    });
    cleanupDir(cwd);
    cleanupDir(home);
  });

  test('loads global MEMORY.md from ~/.iris/', async () => {
    const cwd = makeTempDir('memory-store-');
    const home = makeTempDir('memory-store-home-');
    writeFile(join(home, '.iris', 'MEMORY.md'), '- global fact\n');
    await withEnv({ HOME: home }, async () => {
      const result = await loadMemory(cwd);
      expect(result.globalText).toContain('global fact');
    });
    cleanupDir(cwd);
    cleanupDir(home);
  });

  test('loads project MEMORY.md from ~/.iris/projects/<hash>/', async () => {
    const cwd = makeTempDir('memory-store-');
    const home = makeTempDir('memory-store-home-');
    await withEnv({ HOME: home }, async () => {
      const projectDir = getProjectDir(cwd);
      writeFile(join(projectDir, 'MEMORY.md'), '- project fact\n');
      const result = await loadMemory(cwd);
      expect(result.projectText).toContain('project fact');
    });
    cleanupDir(cwd);
    cleanupDir(home);
  });

  test('caps each source at 100 lines', async () => {
    const cwd = makeTempDir('memory-store-');
    const home = makeTempDir('memory-store-home-');
    const manyLines = Array.from({ length: 200 }, (_, i) => `- line ${i}`).join('\n') + '\n';
    writeFile(join(home, '.iris', 'MEMORY.md'), manyLines);
    await withEnv({ HOME: home }, async () => {
      const result = await loadMemory(cwd);
      expect(result.globalText.split('\n').filter(Boolean).length).toBe(100);
    });
    cleanupDir(cwd);
    cleanupDir(home);
  });

  test('combined totalLines is capped at 200', async () => {
    const cwd = makeTempDir('memory-store-');
    const home = makeTempDir('memory-store-home-');
    const manyLines = Array.from({ length: 150 }, (_, i) => `- line ${i}`).join('\n') + '\n';
    writeFile(join(home, '.iris', 'MEMORY.md'), manyLines);
    await withEnv({ HOME: home }, async () => {
      const projectDir = getProjectDir(cwd);
      writeFile(join(projectDir, 'MEMORY.md'), manyLines);
      const result = await loadMemory(cwd);
      expect(result.totalLines).toBeLessThanOrEqual(200);
    });
    cleanupDir(cwd);
    cleanupDir(home);
  });
});

describe('appendToMemory', () => {
  test('creates file if it does not exist', async () => {
    const cwd = makeTempDir('memory-store-');
    const home = makeTempDir('memory-store-home-');
    await withEnv({ HOME: home }, async () => {
      await appendToMemory(cwd, '- new entry\n', 'global');
      const result = await loadMemory(cwd);
      expect(result.globalText).toContain('new entry');
    });
    cleanupDir(cwd);
    cleanupDir(home);
  });

  test('appends to existing file', async () => {
    const cwd = makeTempDir('memory-store-');
    const home = makeTempDir('memory-store-home-');
    writeFile(join(home, '.iris', 'MEMORY.md'), '- existing\n');
    await withEnv({ HOME: home }, async () => {
      await appendToMemory(cwd, '- appended\n', 'global');
      const result = await loadMemory(cwd);
      expect(result.globalText).toContain('existing');
      expect(result.globalText).toContain('appended');
    });
    cleanupDir(cwd);
    cleanupDir(home);
  });

  test('trims file to 500 lines when limit exceeded', async () => {
    const cwd = makeTempDir('memory-store-');
    const home = makeTempDir('memory-store-home-');
    const existing = Array.from({ length: 500 }, (_, i) => `- old ${i}`).join('\n') + '\n';
    writeFile(join(home, '.iris', 'MEMORY.md'), existing);
    await withEnv({ HOME: home }, async () => {
      await appendToMemory(cwd, '- new entry\n', 'global');
      const content = readFileSync(join(home, '.iris', 'MEMORY.md'), 'utf-8');
      const lines = content.split('\n').filter(Boolean);
      expect(lines.length).toBeLessThanOrEqual(500);
      expect(content).toContain('new entry');
      // Oldest entry removed
      expect(content).not.toContain('- old 0');
    });
    cleanupDir(cwd);
    cleanupDir(home);
  });
});

describe('clearMemory', () => {
  test('clears global memory', async () => {
    const cwd = makeTempDir('memory-store-');
    const home = makeTempDir('memory-store-home-');
    writeFile(join(home, '.iris', 'MEMORY.md'), '- data\n');
    await withEnv({ HOME: home }, async () => {
      await clearMemory(cwd, 'global');
      const result = await loadMemory(cwd);
      expect(result.globalText).toBe('');
    });
    cleanupDir(cwd);
    cleanupDir(home);
  });

  test('clears project memory', async () => {
    const cwd = makeTempDir('memory-store-');
    const home = makeTempDir('memory-store-home-');
    await withEnv({ HOME: home }, async () => {
      const projectDir = getProjectDir(cwd);
      writeFile(join(projectDir, 'MEMORY.md'), '- project data\n');
      await clearMemory(cwd, 'project');
      const result = await loadMemory(cwd);
      expect(result.projectText).toBe('');
    });
    cleanupDir(cwd);
    cleanupDir(home);
  });
});
