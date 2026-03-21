import { type BaseAdapter } from './base-adapter.ts';
import { AnthropicAdapter } from './providers/anthropic.ts';
import { OllamaAdapter } from './providers/ollama.ts';
import { ProviderError } from '../shared/errors.ts';

export class ModelRegistry {
  private adapters = new Map<string, BaseAdapter>();

  register(key: string, adapter: BaseAdapter): void {
    this.adapters.set(key, adapter);
  }

  get(key: string): BaseAdapter {
    const adapter = this.adapters.get(key);
    if (!adapter) {
      throw new ProviderError(`Unknown model: "${key}"`, 'registry');
    }
    return adapter;
  }

  has(key: string): boolean {
    return this.adapters.has(key);
  }

  keys(): string[] {
    return Array.from(this.adapters.keys());
  }
}

/**
 * Parse a model string like "anthropic/claude-opus-4-6" or "ollama/llama3"
 * into { provider, modelId }.
 * If no slash is present, defaults to anthropic.
 */
export function parseModelString(modelString: string): { provider: string; modelId: string } {
  const slashIndex = modelString.indexOf('/');
  if (slashIndex === -1) {
    return { provider: 'anthropic', modelId: modelString };
  }
  const provider = modelString.slice(0, slashIndex);
  const modelId = modelString.slice(slashIndex + 1);
  return { provider, modelId };
}

/**
 * Create a default registry with:
 * - anthropic/claude-opus-4-6
 * - anthropic/claude-sonnet-4-6
 * - anthropic/claude-haiku-4-5
 * - ollama/auto (first available model) — resolved lazily via fetchModels()
 *
 * The registry keys are the full "provider/model" strings.
 * For Ollama models discovered via fetchModels(), they are registered as "ollama/<modelName>".
 */
export async function createDefaultRegistry(): Promise<ModelRegistry> {
  const registry = new ModelRegistry();

  // Register Anthropic models
  const anthropicModels = ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5'];
  for (const modelId of anthropicModels) {
    try {
      registry.register(`anthropic/${modelId}`, new AnthropicAdapter(modelId));
    } catch {
      // AnthropicAdapter throws ProviderError if API key missing — skip gracefully
    }
  }

  // Register Ollama models (best-effort — skip if Ollama is not running)
  try {
    const probe = new OllamaAdapter('probe');
    const ollamaModels = await probe.fetchModels();
    for (const modelId of ollamaModels) {
      registry.register(`ollama/${modelId}`, new OllamaAdapter(modelId));
    }
  } catch {
    // Ollama not running — skip silently
  }

  return registry;
}
