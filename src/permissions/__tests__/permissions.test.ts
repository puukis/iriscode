import { describe, expect, test } from 'bun:test';
import { PermissionsEngine } from '../engine.ts';
import { PermissionDeniedError } from '../../shared/errors.ts';

describe('permissions', () => {
  test('default mode auto-approves safe tools and prompts on risky tools', () => {
    const engine = new PermissionsEngine('default');
    expect(engine.check('read')).toBe(true);
    expect(engine.check('web-search')).toBe(true);
    expect(engine.check('bash')).toBe(false);
    expect(engine.check('git-commit')).toBe(false);
  });

  test('acceptAll allows everything and rejectAll denies everything', () => {
    const engine = new PermissionsEngine('acceptAll');
    expect(engine.check('ask-user')).toBe(true);

    engine.setMode('rejectAll');
    expect(() => engine.check('read')).toThrow(PermissionDeniedError);
  });
});
