import { describe, expect, test } from 'bun:test';
import { computeDiff } from '../engine.ts';
import { DiffStore } from '../store.ts';
import { DiffInterceptor } from '../interceptor.ts';
import { DiffViewerController } from '../controller.ts';
import { cleanupDir, makeTempDir, writeFile } from '../../shared/test-helpers.ts';

describe('diff system', () => {
  test('computeDiff returns structured hunks and stats', () => {
    const result = computeDiff(
      'alpha\nbeta\ngamma\n',
      'alpha\nbeta changed\ngamma\ndelta\n',
      'notes.txt',
    );

    expect(result.isEmpty).toBe(false);
    expect(result.hunks.length).toBeGreaterThan(0);
    expect(result.stats.added).toBe(2);
    expect(result.stats.removed).toBe(1);
    expect(result.hunks[0]?.lines.some((line) => line.type === 'added')).toBe(true);
    expect(result.hunks[0]?.lines.some((line) => line.type === 'removed')).toBe(true);
  });

  test('diff store records decisions and summarizes them', () => {
    const store = new DiffStore();
    const accepted = computeDiff('', 'hello\n', '/tmp/a.txt');
    const rejected = computeDiff('old\n', 'new\n', '/tmp/b.txt');

    store.add(accepted, 'accepted');
    store.add(rejected, 'rejected');

    expect(store.list()).toHaveLength(2);
    expect(store.getByFile('/tmp/a.txt')).toHaveLength(1);
    expect(store.summary()).toBe('1 edits accepted, 1 rejected across 2 files');
  });

  test('diff interceptor returns the queued viewer decision', async () => {
    const cwd = makeTempDir('iriscode-diff-interceptor-');
    const filePath = `${cwd}/notes.txt`;
    writeFile(filePath, 'alpha\n');

    const controller = new DiffViewerController((request) => {
      if (request.kind === 'interactive') {
        request.resolve('rejected');
      }
    });
    const store = new DiffStore();
    const interceptor = new DiffInterceptor(store, 'default', controller);

    const decision = await interceptor.intercept(filePath, 'beta\n');
    expect(decision).toBe('rejected');
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]?.decision).toBe('rejected');

    cleanupDir(cwd);
  });
});
