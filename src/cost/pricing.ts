export interface ModelPricing {
  inputPer1k: number;   // USD per 1k input tokens
  outputPer1k: number;  // USD per 1k output tokens
}

/** Pricing map keyed by "provider/model". Falls back to zero if not found. */
export const PRICING: Record<string, ModelPricing> = {
  // Anthropic
  'anthropic/claude-opus-4-6':    { inputPer1k: 0.005,    outputPer1k: 0.025 },
  'anthropic/claude-sonnet-4-6':  { inputPer1k: 0.003,    outputPer1k: 0.015 },
  'anthropic/claude-haiku-4-5':   { inputPer1k: 0.001,    outputPer1k: 0.005 },
  // OpenAI
  'openai/gpt-4o':                { inputPer1k: 0.0025,   outputPer1k: 0.01 },
  'openai/gpt-4o-mini':           { inputPer1k: 0.00015,  outputPer1k: 0.0006 },
  'openai/gpt-4-turbo':           { inputPer1k: 0.01,     outputPer1k: 0.03 },
  'openai/o1':                    { inputPer1k: 0.015,     outputPer1k: 0.06 },
  'openai/o3-mini':               { inputPer1k: 0.0011,   outputPer1k: 0.0044 },
  // Google
  'google/gemini-2.5-pro':        { inputPer1k: 0.00125,  outputPer1k: 0.01 },
  'google/gemini-2.5-flash':      { inputPer1k: 0.000075, outputPer1k: 0.0003 },
  'google/gemini-2.0-flash':      { inputPer1k: 0.0001,   outputPer1k: 0.0004 },
  // Groq
  'groq/llama-3.3-70b-versatile': { inputPer1k: 0.00059,  outputPer1k: 0.00079 },
  'groq/llama-3.1-8b-instant':    { inputPer1k: 0.00005,  outputPer1k: 0.00008 },
  'groq/mixtral-8x7b-32768':      { inputPer1k: 0.00024,  outputPer1k: 0.00024 },
  // Mistral
  'mistral/mistral-large-latest': { inputPer1k: 0.003,    outputPer1k: 0.009 },
  'mistral/mistral-small-latest': { inputPer1k: 0.0002,   outputPer1k: 0.0006 },
  'mistral/codestral-latest':     { inputPer1k: 0.0003,   outputPer1k: 0.0009 },
  // DeepSeek
  'deepseek/deepseek-chat':       { inputPer1k: 0.00027,  outputPer1k: 0.0011 },
  'deepseek/deepseek-reasoner':   { inputPer1k: 0.00055,  outputPer1k: 0.00219 },
  // xAI
  'xai/grok-3':                   { inputPer1k: 0.003,    outputPer1k: 0.015 },
  'xai/grok-3-mini':              { inputPer1k: 0.0003,   outputPer1k: 0.0005 },
  'xai/grok-2':                   { inputPer1k: 0.002,    outputPer1k: 0.01 },
  // Perplexity
  'perplexity/sonar-pro':         { inputPer1k: 0.003,    outputPer1k: 0.015 },
  'perplexity/sonar':             { inputPer1k: 0.001,    outputPer1k: 0.001 },
  'perplexity/sonar-reasoning':   { inputPer1k: 0.001,    outputPer1k: 0.005 },
  // Together
  'together/meta-llama/Llama-3.3-70B-Instruct-Turbo': { inputPer1k: 0.00088, outputPer1k: 0.00088 },
  'together/mistralai/Mixtral-8x7B-Instruct-v0.1':    { inputPer1k: 0.0006,  outputPer1k: 0.0006 },
  // Fireworks
  'fireworks/accounts/fireworks/models/llama-v3p3-70b-instruct': { inputPer1k: 0.0009, outputPer1k: 0.0009 },
  'fireworks/accounts/fireworks/models/deepseek-r1':             { inputPer1k: 0.003,  outputPer1k: 0.008 },
  // Cohere
  'cohere/command-r-plus':        { inputPer1k: 0.0025,   outputPer1k: 0.01 },
  'cohere/command-r':             { inputPer1k: 0.00015,  outputPer1k: 0.0006 },
  // OpenRouter — dynamic models, cost unknown at this layer
  // Ollama — free (local)
};

export function getPricing(provider: string, modelId: string): ModelPricing {
  return PRICING[`${provider}/${modelId}`] ?? { inputPer1k: 0, outputPer1k: 0 };
}
