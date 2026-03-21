import { describe, expect, test } from 'bun:test';
import { join } from 'path';
import { EditFileTool } from '../edit.ts';
import { ReadFileTool } from '../read.ts';
import { WriteFileTool } from '../write.ts';
import {
  cleanupDir,
  expectError,
  expectOk,
  makeTempDir,
  makeToolContext,
  readFile,
  writeFile as writeFixtureFile,
} from '../../../shared/test-helpers.ts';

describe('file tools', () => {
  test('write tool description directs assistant-managed state into .iris', () => {
    const tool = new WriteFileTool();

    expect(tool.definition.description).toContain('assistant-managed project state');
    expect(tool.definition.description).toContain('.iris/');
  });

  test('write, read, and edit operate on files', async () => {
    const cwd = makeTempDir('iriscode-file-tools-');
    const path = join(cwd, 'notes.txt');
    const context = makeToolContext({ cwd });

    const writeResult = await new WriteFileTool().execute({ path, content: 'alpha\nbeta\n' }, context);
    expectOk(writeResult);

    const readResult = await new ReadFileTool().execute({ path, start_line: 2, end_line: 2 }, context);
    expectOk(readResult);
    expect(readResult.content).toBe('beta');

    const editResult = await new EditFileTool().execute(
      { path, old_string: 'beta', new_string: 'gamma' },
      context,
    );
    expectOk(editResult);
    expect(readFile(path)).toContain('gamma');

    cleanupDir(cwd);
  });

  test('edit returns an error when the target string is missing', async () => {
    const cwd = makeTempDir('iriscode-file-tools-error-');
    const path = join(cwd, 'notes.txt');
    const context = makeToolContext({ cwd });

    await new WriteFileTool().execute({ path, content: 'alpha\nbeta\n' }, context);
    const result = await new EditFileTool().execute(
      { path, old_string: 'missing', new_string: 'gamma' },
      context,
    );

    expectError(result);
    expect(result.content).toContain('old_string not found');

    cleanupDir(cwd);
  });

  test('write and edit respect rejected diff decisions', async () => {
    const cwd = makeTempDir('iriscode-file-tools-reject-');
    const path = join(cwd, 'notes.txt');
    const context = makeToolContext({ cwd });
    const rejectingInterceptor = {
      async intercept() {
        return 'rejected' as const;
      },
    };

    const writeResult = await new WriteFileTool(rejectingInterceptor as never).execute(
      { path, content: 'alpha\n' },
      context,
    );
    expectOk(writeResult);
    expect(writeResult.content).toContain('rejected by user');

    writeFixtureFile(path, 'alpha\nbeta\n');
    const editResult = await new EditFileTool(rejectingInterceptor as never).execute(
      { path, old_string: 'beta', new_string: 'gamma' },
      context,
    );
    expectOk(editResult);
    expect(editResult.content).toContain('rejected by user');
    expect(readFile(path)).toContain('beta');

    cleanupDir(cwd);
  });

  test('project .iris paths resolve to the project root from nested directories', async () => {
    const cwd = makeTempDir('iriscode-file-tools-project-state-');
    const nestedCwd = join(cwd, 'src', 'feature');
    const context = makeToolContext({ cwd: nestedCwd });
    const path = '.iris/memory/fact.txt';

    writeFixtureFile(join(cwd, 'IRIS.md'), '# Test project\n');
    const result = await new WriteFileTool().execute(
      { path, content: 'Saved in the root .iris directory.\n' },
      context,
    );

    expectOk(result);
    expect(readFile(join(cwd, '.iris', 'memory', 'fact.txt'))).toContain('root .iris');

    cleanupDir(cwd);
  });

  test('duplicate .iris prefixes collapse to a single project state directory', async () => {
    const cwd = makeTempDir('iriscode-file-tools-double-iris-');
    const context = makeToolContext({ cwd });

    writeFixtureFile(join(cwd, 'IRIS.md'), '# Test project\n');
    const result = await new WriteFileTool().execute(
      { path: '.iris/.iris/scratch/note.txt', content: 'No nested project state.\n' },
      context,
    );

    expectOk(result);
    expect(readFile(join(cwd, '.iris', 'scratch', 'note.txt'))).toContain('No nested');

    cleanupDir(cwd);
  });
});
