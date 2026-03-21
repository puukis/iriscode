import { describe, expect, test } from 'bun:test';
import { createDefaultRegistry, ModelRegistry, parseModelString } from '../registry.ts';
import { FakeAdapter, withEnv } from '../../shared/test-helpers.ts';

describe('models', () => {
  test('parseModelString supports explicit and implicit providers', () => {
    expect(parseModelString('openai/gpt-4o-mini')).toEqual({
      provider: 'openai',
      modelId: 'gpt-4o-mini',
    });
    expect(parseModelString('claude-haiku-4-5')).toEqual({
      provider: 'anthropic',
      modelId: 'claude-haiku-4-5',
    });
  });

  test('ModelRegistry resolves registered and factory-backed adapters', () => {
    const registry = new ModelRegistry();
    registry.register(
      'custom/manual',
      new FakeAdapter('custom', 'manual', async function* () {
        yield { type: 'done', stopReason: 'end_turn', inputTokens: 0, outputTokens: 0 };
      }),
    );
    registry.registerFactory(
      'dynamic',
      (modelId) =>
        new FakeAdapter('dynamic', modelId, async function* () {
          yield { type: 'done', stopReason: 'end_turn', inputTokens: 0, outputTokens: 0 };
        }),
    );

    expect(registry.get('custom/manual').modelId).toBe('manual');
    expect(registry.get('dynamic/example').modelId).toBe('example');
  });

  test('createDefaultRegistry registers configured providers', async () => {
    await withEnv(
      {
        ANTHROPIC_API_KEY: 'anthropic-key',
        OPENAI_API_KEY: 'openai-key',
        OPENROUTER_API_KEY: 'openrouter-key',
      },
      async () => {
        const registry = await createDefaultRegistry();
        expect(registry.has('anthropic/claude-sonnet-4-6')).toBe(true);
        expect(registry.has('openai/gpt-4o-mini')).toBe(true);
        expect(registry.has('openrouter/any-model')).toBe(true);
      },
    );
  });
});
