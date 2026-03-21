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
} from '../../../shared/test-helpers.ts';

describe('file tools', () => {
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
});
