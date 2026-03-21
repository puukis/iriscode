import { describe, expect, test } from 'bun:test';
import { join } from 'path';
import {
  cleanupDir,
  expectOk,
  makeTempDir,
  makeToolContext,
  readFile,
  writeFile,
} from '../../../shared/test-helpers.ts';
import { AskUserTool } from '../ask-user.ts';
import { SkillTool } from '../skill.ts';
import { TaskTool } from '../task.ts';
import { TodoWriteTool } from '../todo-write.ts';

describe('orchestration tools', () => {
  test('skill, ask-user, task, and todo-write use runtime callbacks and filesystem state', async () => {
    const cwd = makeTempDir('iriscode-orchestration-tools-');
    writeFile(join(cwd, '.iriscode', 'skills', 'demo.skill.md'), 'Demo skill instructions');

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
    expect(readFile(join(cwd, '.iriscode', 'todos.md'))).toContain('Ship tests');

    cleanupDir(cwd);
  });
});
