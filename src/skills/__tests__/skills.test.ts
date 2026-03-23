import { describe, expect, test } from 'bun:test';
import { join } from 'path';
import { createHeadlessSession } from '../../agent/headless-session.ts';
import type { ResolvedConfig } from '../../config/schema.ts';
import { PermissionEngine } from '../../permissions/engine.ts';
import { cleanupDir, makeTempDir, withEnv, writeFile } from '../../shared/test-helpers.ts';
import { loadSkills } from '../loader.ts';
import { clearSkillContext } from '../injector.ts';
import { buildSkillTool, buildSkillToolDefinition } from '../meta-tool.ts';

describe('skills', () => {
  test('loadSkills applies project overrides and plugin namespaces', async () => {
    const cwd = makeTempDir('iriscode-skills-project-');
    const home = makeTempDir('iriscode-skills-home-');

    writeFile(join(home, '.iris', 'skills', 'review', 'SKILL.md'), [
      '---',
      'name: review',
      'description: Global review',
      '---',
      '',
      'Global instructions.',
    ].join('\n'));
    writeFile(join(cwd, '.iris', 'skills', 'review', 'SKILL.md'), [
      '---',
      'name: review',
      'description: Project review',
      '---',
      '',
      'Project instructions.',
    ].join('\n'));
    writeFile(join(cwd, '.iris', 'skills', 'hidden', 'SKILL.md'), [
      '---',
      'name: hidden',
      'description: Hidden skill',
      'disable_model_invocation: true',
      '---',
      '',
      'Hidden instructions.',
    ].join('\n'));
    writeFile(join(cwd, '.iris', 'plugins', 'docs', '.iris-plugin', 'plugin.json'), JSON.stringify({
      name: 'docs',
      version: '1.0.0',
      description: 'Documentation helpers',
    }, null, 2));
    writeFile(join(cwd, '.iris', 'plugins', 'docs', 'skills', 'pdf', 'SKILL.md'), [
      '---',
      'name: pdf',
      'description: PDF analysis',
      '---',
      '',
      'Plugin instructions.',
    ].join('\n'));

    await withEnv({ HOME: home }, async () => {
      const result = await loadSkills(cwd);
      expect(result.skills.map((skill) => skill.frontmatter.name)).toEqual([
        'hidden',
        'review',
        'docs:pdf',
      ]);
      expect(result.skills.find((skill) => skill.frontmatter.name === 'review')?.frontmatter.description).toBe('Project review');
      expect(result.availableSkills.map((skill) => skill.frontmatter.name)).toEqual([
        'review',
        'docs:pdf',
      ]);

      const definition = buildSkillToolDefinition(result.availableSkills);
      expect(definition.description).toContain('"docs:pdf": PDF analysis');
      expect(definition.description).not.toContain('"hidden": Hidden skill');
    });

    cleanupDir(cwd);
    cleanupDir(home);
  });

  test('buildSkillTool injects messages and scoped permissions', async () => {
    const cwd = makeTempDir('iriscode-skills-session-');
    const home = makeTempDir('iriscode-skills-home-');

    await withEnv({ HOME: home }, async () => {
      const permissions = new PermissionEngine('default', cwd);
      const session = createHeadlessSession({
        cwd,
        config: makeResolvedConfig(),
        permissionEngine: permissions,
        model: 'anthropic/claude-sonnet-4-6',
      });

      const tool = buildSkillTool([{
        frontmatter: {
          name: 'pdf',
          description: 'PDF skill',
          allowed_tools: 'Bash(pdftotext:*), Read',
          model: 'openai/gpt-4o-mini',
        },
        instructions: 'Use pdftotext before answering.',
        source: join(cwd, '.iris', 'skills', 'pdf', 'SKILL.md'),
        baseDir: join(cwd, '.iris', 'skills', 'pdf'),
      }], session, permissions);

      const result = await tool.execute({ command: 'pdf' }, {} as never);
      expect(result.isError).toBeUndefined();
      expect(session.messages).toHaveLength(2);
      expect(session.messages[0]).toMatchObject({ commandName: 'pdf', role: 'user' });
      expect(session.messages[1]).toMatchObject({ isMeta: true });
      expect(permissions.checkSync({
        toolName: 'bash',
        input: { command: 'pdftotext file.pdf -' },
        sessionId: 'session',
      }).decision).toBe('allow');

      clearSkillContext(session, permissions);

      expect(permissions.checkSync({
        toolName: 'bash',
        input: { command: 'pdftotext file.pdf -' },
        sessionId: 'session',
      }).decision).toBe('prompt');
    });

    cleanupDir(cwd);
    cleanupDir(home);
  });
});

function makeResolvedConfig(): ResolvedConfig {
  return {
    model: 'anthropic/claude-sonnet-4-6',
    default_model: 'anthropic/claude-sonnet-4-6',
    providers: {
      anthropic: { apiKey: null, baseUrl: null },
      openai: { apiKey: null, baseUrl: null },
      google: { apiKey: null, baseUrl: null },
      groq: { apiKey: null, baseUrl: null },
      mistral: { apiKey: null, baseUrl: null },
      deepseek: { apiKey: null, baseUrl: null },
      xai: { apiKey: null, baseUrl: null },
      perplexity: { apiKey: null, baseUrl: null },
      together: { apiKey: null, baseUrl: null },
      fireworks: { apiKey: null, baseUrl: null },
      cohere: { apiKey: null, baseUrl: null },
      openrouter: { apiKey: null, baseUrl: null },
      ollama: { apiKey: null, baseUrl: 'http://localhost:11434' },
    },
    permissions: {
      mode: 'default',
      allowed_tools: [],
      disallowed_tools: [],
    },
    memory: {
      max_tokens: 10000,
      max_lines: 200,
      warn_at: 8000,
    },
    mcp_servers: [],
    mcp_oauth_callback_port: 5555,
    context_text: '',
    log_level: 'warn',
    vim_mode: false,
    notifications: 'off',
    shown_splash: true,
  };
}
