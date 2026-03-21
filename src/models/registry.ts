import { type BaseAdapter } from './base-adapter.ts';
import { AnthropicAdapter } from './providers/anthropic.ts';
import { OllamaAdapter } from './providers/ollama.ts';
import { OpenAIAdapter } from './providers/openai.ts';
import { GoogleAdapter } from './providers/google.ts';
import { GroqAdapter } from './providers/groq.ts';
import { MistralAdapter } from './providers/mistral.ts';
import { DeepSeekAdapter } from './providers/deepseek.ts';
import { XAIAdapter } from './providers/xai.ts';
import { PerplexityAdapter } from './providers/perplexity.ts';
import { TogetherAdapter } from './providers/together.ts';
import { FireworksAdapter } from './providers/fireworks.ts';
import { CohereAdapter } from './providers/cohere.ts';
import { OpenRouterAdapter } from './providers/openrouter.ts';
import { ProviderError } from '../shared/errors.ts';

export class ModelRegistry {
  private adapters = new Map<string, BaseAdapter>();
  private factories = new Map<string, (modelId: string) => BaseAdapter>();

  register(key: string, adapter: BaseAdapter): void {
    this.adapters.set(key, adapter);
  }

  /** Register a factory that creates adapters on-demand for a given provider prefix. */
  registerFactory(provider: string, factory: (modelId: string) => BaseAdapter): void {
    this.factories.set(provider, factory);
  }

  get(key: string): BaseAdapter {
    const adapter = this.adapters.get(key);
    if (adapter) return adapter;

    // Try dynamic factory (e.g. openrouter/* accepts any model string)
    const slashIdx = key.indexOf('/');
    if (slashIdx !== -1) {
      const provider = key.slice(0, slashIdx);
      const modelId = key.slice(slashIdx + 1);
      const factory = this.factories.get(provider);
      if (factory) return factory(modelId);
    }

    throw new ProviderError(`Unknown model: "${key}"`, 'registry');
  }

  has(key: string): boolean {
    if (this.adapters.has(key)) return true;
    const slashIdx = key.indexOf('/');
    if (slashIdx !== -1) {
      return this.factories.has(key.slice(0, slashIdx));
    }
    return false;
  }

  keys(): string[] {
    return Array.from(this.adapters.keys());
  }
}

export function parseModelString(modelString: string): { provider: string; modelId: string } {
  const slashIndex = modelString.indexOf('/');
  if (slashIndex === -1) {
    return { provider: 'anthropic', modelId: modelString };
  }
  const provider = modelString.slice(0, slashIndex);
  const modelId = modelString.slice(slashIndex + 1);
  return { provider, modelId };
}

export async function createDefaultRegistry(): Promise<ModelRegistry> {
  const registry = new ModelRegistry();

  // ── Anthropic ──────────────────────────────────────────────────────────────
  if (process.env.ANTHROPIC_API_KEY) {
    for (const modelId of ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5']) {
      try {
        registry.register(`anthropic/${modelId}`, new AnthropicAdapter(modelId));
      } catch (err) {
        if (!(err instanceof ProviderError)) throw err;
      }
    }
  }

  // ── OpenAI ─────────────────────────────────────────────────────────────────
  if (process.env.OPENAI_API_KEY) {
    for (const modelId of ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o3-mini']) {
      try {
        registry.register(`openai/${modelId}`, new OpenAIAdapter(modelId));
      } catch (err) {
        if (!(err instanceof ProviderError)) throw err;
      }
    }
  }

  // ── Google ─────────────────────────────────────────────────────────────────
  if (process.env.GOOGLE_API_KEY) {
    for (const modelId of ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash']) {
      try {
        registry.register(`google/${modelId}`, new GoogleAdapter(modelId));
      } catch (err) {
        if (!(err instanceof ProviderError)) throw err;
      }
    }
  }

  // ── Groq ───────────────────────────────────────────────────────────────────
  if (process.env.GROQ_API_KEY) {
    for (const modelId of ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768']) {
      try {
        registry.register(`groq/${modelId}`, new GroqAdapter(modelId));
      } catch (err) {
        if (!(err instanceof ProviderError)) throw err;
      }
    }
  }

  // ── Mistral ────────────────────────────────────────────────────────────────
  if (process.env.MISTRAL_API_KEY) {
    for (const modelId of ['mistral-large-latest', 'mistral-small-latest', 'codestral-latest']) {
      try {
        registry.register(`mistral/${modelId}`, new MistralAdapter(modelId));
      } catch (err) {
        if (!(err instanceof ProviderError)) throw err;
      }
    }
  }

  // ── DeepSeek ───────────────────────────────────────────────────────────────
  if (process.env.DEEPSEEK_API_KEY) {
    for (const modelId of ['deepseek-chat', 'deepseek-reasoner']) {
      try {
        registry.register(`deepseek/${modelId}`, new DeepSeekAdapter(modelId));
      } catch (err) {
        if (!(err instanceof ProviderError)) throw err;
      }
    }
  }

  // ── xAI ────────────────────────────────────────────────────────────────────
  if (process.env.XAI_API_KEY) {
    for (const modelId of ['grok-3', 'grok-3-mini', 'grok-2']) {
      try {
        registry.register(`xai/${modelId}`, new XAIAdapter(modelId));
      } catch (err) {
        if (!(err instanceof ProviderError)) throw err;
      }
    }
  }

  // ── Perplexity ─────────────────────────────────────────────────────────────
  if (process.env.PERPLEXITY_API_KEY) {
    for (const modelId of ['sonar-pro', 'sonar', 'sonar-reasoning']) {
      try {
        registry.register(`perplexity/${modelId}`, new PerplexityAdapter(modelId));
      } catch (err) {
        if (!(err instanceof ProviderError)) throw err;
      }
    }
  }

  // ── Together ───────────────────────────────────────────────────────────────
  if (process.env.TOGETHER_API_KEY) {
    for (const modelId of [
      'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      'mistralai/Mixtral-8x7B-Instruct-v0.1',
    ]) {
      try {
        registry.register(`together/${modelId}`, new TogetherAdapter(modelId));
      } catch (err) {
        if (!(err instanceof ProviderError)) throw err;
      }
    }
  }

  // ── Fireworks ──────────────────────────────────────────────────────────────
  if (process.env.FIREWORKS_API_KEY) {
    for (const modelId of [
      'accounts/fireworks/models/llama-v3p3-70b-instruct',
      'accounts/fireworks/models/deepseek-r1',
    ]) {
      try {
        registry.register(`fireworks/${modelId}`, new FireworksAdapter(modelId));
      } catch (err) {
        if (!(err instanceof ProviderError)) throw err;
      }
    }
  }

  // ── Cohere ─────────────────────────────────────────────────────────────────
  if (process.env.COHERE_API_KEY) {
    for (const modelId of ['command-r-plus', 'command-r']) {
      try {
        registry.register(`cohere/${modelId}`, new CohereAdapter(modelId));
      } catch (err) {
        if (!(err instanceof ProviderError)) throw err;
      }
    }
  }

  // ── OpenRouter (dynamic — any model string) ────────────────────────────────
  if (process.env.OPENROUTER_API_KEY) {
    registry.registerFactory('openrouter', (modelId) => new OpenRouterAdapter(modelId));
  }

  // ── Ollama (local, no key needed) ──────────────────────────────────────────
  try {
    const probe = new OllamaAdapter('__probe__');
    const ollamaModels = await probe.fetchModels();
    for (const modelId of ollamaModels) {
      registry.register(`ollama/${modelId}`, new OllamaAdapter(modelId));
    }
  } catch (err) {
    if (!(err instanceof ProviderError)) throw err;
  }

  return registry;
}
