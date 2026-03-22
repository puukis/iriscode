import { describe, expect, test } from 'bun:test';
import { join } from 'path';
import { buildSystemPrompt } from '../retrieval.ts';
import { cleanupDir, makeTempDir, withEnv, writeFile } from '../../shared/test-helpers.ts';
import { getProjectDir } from '../project-hash.ts';

describe('buildSystemPrompt', () => {
  test('returns a SystemPromptResult with budget', async () => {
    const cwd = makeTempDir('retrieval-');
    const home = makeTempDir('retrieval-home-');
    await withEnv({ HOME: home }, async () => {
      const result = await buildSystemPrompt(cwd, 'Base prompt.');
      expect(result.systemPrompt).toContain('Base prompt.');
      expect(result.budget).toBeDefined();
      expect(result.budget.status).toBe('ok');
      expect(result.sources).toBeInstanceOf(Array);
    });
    cleanupDir(cwd);
    cleanupDir(home);
  });

  test('injects IRIS context header when IRIS.md exists', async () => {
    const cwd = makeTempDir('retrieval-');
    const home = makeTempDir('retrieval-home-');
    writeFile(join(cwd, 'IRIS.md'), '# My project\n');
    await withEnv({ HOME: home }, async () => {
      const result = await buildSystemPrompt(cwd, 'Base.');
      expect(result.systemPrompt).toContain('--- IRIS CONTEXT ---');
      expect(result.systemPrompt).toContain('My project');
    });
    cleanupDir(cwd);
    cleanupDir(home);
  });

  test('injects MEMORY header when MEMORY.md exists', async () => {
    const cwd = makeTempDir('retrieval-');
    const home = makeTempDir('retrieval-home-');
    await withEnv({ HOME: home }, async () => {
      const projectDir = getProjectDir(cwd);
      writeFile(join(projectDir, 'MEMORY.md'), '- stored fact\n');
      const result = await buildSystemPrompt(cwd, 'Base.');
      expect(result.systemPrompt).toContain('--- MEMORY ---');
      expect(result.systemPrompt).toContain('stored fact');
      expect(result.systemPrompt).toContain('--- END MEMORY ---');
    });
    cleanupDir(cwd);
    cleanupDir(home);
  });

  test('does not inject IRIS header when no IRIS.md files exist', async () => {
    const cwd = makeTempDir('retrieval-');
    const home = makeTempDir('retrieval-home-');
    await withEnv({ HOME: home }, async () => {
      const result = await buildSystemPrompt(cwd, 'Base only.');
      expect(result.systemPrompt).not.toContain('--- IRIS CONTEXT ---');
    });
    cleanupDir(cwd);
    cleanupDir(home);
  });

  test('does not inject MEMORY header when no MEMORY.md content', async () => {
    const cwd = makeTempDir('retrieval-');
    const home = makeTempDir('retrieval-home-');
    await withEnv({ HOME: home }, async () => {
      const result = await buildSystemPrompt(cwd, 'Base.');
      expect(result.systemPrompt).not.toContain('--- MEMORY ---');
    });
    cleanupDir(cwd);
    cleanupDir(home);
  });

  test('sources reflects loaded IRIS.md files', async () => {
    const cwd = makeTempDir('retrieval-');
    const home = makeTempDir('retrieval-home-');
    writeFile(join(home, '.iris', 'IRIS.md'), 'Global.\n');
    writeFile(join(cwd, 'IRIS.md'), 'Project.\n');
    await withEnv({ HOME: home }, async () => {
      const result = await buildSystemPrompt(cwd, 'Base.');
      expect(result.sources).toHaveLength(2);
    });
    cleanupDir(cwd);
    cleanupDir(home);
  });
});
