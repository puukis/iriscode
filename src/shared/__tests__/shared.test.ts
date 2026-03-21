import { describe, expect, test } from 'bun:test';
import { IrisCodeError, PermissionDeniedError, ProviderError, ToolError } from '../errors.ts';
import { EventBus } from '../events.ts';
import { logger } from '../logger.ts';
import { captureStderr } from '../test-helpers.ts';

describe('shared', () => {
  test('EventBus emits and unsubscribes handlers', () => {
    const bus = new EventBus<{ ping: { value: string } }>();
    const values: string[] = [];
    const off = bus.on('ping', ({ value }) => values.push(value));

    bus.emit('ping', { value: 'one' });
    off();
    bus.emit('ping', { value: 'two' });

    expect(values).toEqual(['one']);
  });

  test('error types preserve metadata and prefixes', () => {
    expect(new IrisCodeError('base').message).toBe('base');
    expect(new PermissionDeniedError('bash').toolName).toBe('bash');
    expect(new ProviderError('oops', 'openai').message).toBe('[openai] oops');
    expect(new ToolError('bad input', 'grep').message).toBe('[grep] bad input');
  });

  test('logger respects configured level', async () => {
    logger.setLevel('warn');
    const suppressed = await captureStderr(() => logger.info('hidden'));
    expect(suppressed).toBe('');

    const visible = await captureStderr(() => logger.error('shown'));
    expect(visible).toContain('[iriscode:error] shown');
  });
});
