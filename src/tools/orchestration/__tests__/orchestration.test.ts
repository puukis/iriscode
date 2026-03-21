import { describe, expect, test } from 'bun:test';
import { join } from 'path';
import {
  cleanupDir,
  expectOk,
  makeTempDir,
  makeToolContext,
  readFile,
  withEnv,
  writeFile,
} from '../../../shared/test-helpers.ts';
import { AskUserTool } from '../ask-user.ts';
import { SkillTool } from '../skill.ts';
import { TaskTool } from '../task.ts';
import { TodoWriteTool } from '../todo-write.ts';

describe('orchestration tools', () => {
  test('skill, ask-user, task, and todo-write use runtime callbacks and filesystem state', async () => {
    const cwd = makeTempDir('iriscode-orchestration-tools-');
    writeFile(join(cwd, '.iris', 'skills', 'demo.skill.md'), 'Demo skill instructions');

    const loadedSkills: ReturnType<typeof makeToolContext>['loadedSkills'] = [];
    const context = makeToolContext({
      cwd,
      loadedSkills,
      askUser: async (question) => `answer:${question}`,
      runSubagent: async (description) => `done:${description}`,
    });

    const skillResult = await new SkillTool().execute({ name: 'demo' }, context);
    expectOk(skillResult);
    expect(loadedSkills).toHaveLength(1);

    const askResult = await new AskUserTool().execute({ question: 'Need input?' }, context);
    expectOk(askResult);
    expect(askResult.content).toBe('answer:Need input?');

    const taskResult = await new TaskTool().execute({ description: 'delegate this' }, context);
    expectOk(taskResult);
    expect(taskResult.content).toBe('done:delegate this');

    const todoResult = await new TodoWriteTool().execute(
      { todos: [{ id: '1', task: 'Ship tests', status: 'done', notes: 'validated' }] },
      context,
    );
    expectOk(todoResult);
    expect(readFile(join(cwd, '.iris', 'todos.md'))).toContain('Ship tests');

    cleanupDir(cwd);
  });

  test('todo-write normalizes common natural-language statuses', async () => {
    const cwd = makeTempDir('iriscode-orchestration-status-');
    const context = makeToolContext({ cwd });

    const result = await new TodoWriteTool().execute(
      {
        todos: [
          { id: '1', task: 'Define scope', status: 'not started' },
          { id: '2', task: 'Build UI', status: 'in progress' },
          { id: '3', task: 'Ship', status: 'completed' },
        ],
      },
      context,
    );

    expectOk(result);
    const content = readFile(join(cwd, '.iris', 'todos.md'));
    expect(content).toContain('| 1 | pending | Define scope |  |');
    expect(content).toContain('| 2 | in-progress | Build UI |  |');
    expect(content).toContain('| 3 | done | Ship |  |');

    cleanupDir(cwd);
  });

  test('task delegates through the orchestrator with parent agent metadata', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const orchestrator = {
      async spawnSubagent(input: Record<string, unknown>) {
        calls.push(input);
        return 'orchestrated result';
      },
    };
    const context = makeToolContext({
      agentId: 'root',
      depth: 0,
      orchestrator: orchestrator as never,
    });

    const result = await new TaskTool(orchestrator as never).execute(
      { description: 'inspect auth module', model: 'test/subagent-model' },
      context,
    );

    expectOk(result);
    expect(result.content).toBe('orchestrated result');
    expect(calls).toEqual([
      {
        description: 'inspect auth module',
        model: 'test/subagent-model',
        parentId: 'root',
        depth: 1,
      },
    ]);
  });

  test('skill loads from the global ~/.iris/skills directory', async () => {
    const cwd = makeTempDir('iriscode-orchestration-project-');
    const home = makeTempDir('iriscode-orchestration-home-');
    writeFile(join(home, '.iris', 'skills', 'global-demo.skill.md'), 'Global skill instructions');

    await withEnv({ HOME: home }, async () => {
      const loadedSkills: ReturnType<typeof makeToolContext>['loadedSkills'] = [];
      const context = makeToolContext({
        cwd,
        loadedSkills,
      });

      const result = await new SkillTool().execute({ name: 'global-demo' }, context);
      expectOk(result);
      expect(loadedSkills).toHaveLength(1);
      expect(loadedSkills[0]?.instructions).toContain('Global skill instructions');
    });

    cleanupDir(cwd);
    cleanupDir(home);
  });
});
