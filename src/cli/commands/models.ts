import { loadConfig } from '../../config/loader.ts';
import { McpRegistry } from '../../mcp/registry.ts';
import { OllamaAdapter } from '../../models/providers/ollama.ts';
import { ProviderError } from '../../shared/errors.ts';

const PROVIDERS: Array<{
  name: string;
  envVar: string;
  models: string[];
  dynamic?: boolean;
}> = [
  { name: 'anthropic',   envVar: 'ANTHROPIC_API_KEY',  models: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5'] },
  { name: 'openai',      envVar: 'OPENAI_API_KEY',     models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o3-mini'] },
  { name: 'google',      envVar: 'GOOGLE_API_KEY',     models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'] },
  { name: 'groq',        envVar: 'GROQ_API_KEY',       models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'] },
  { name: 'mistral',     envVar: 'MISTRAL_API_KEY',    models: ['mistral-large-latest', 'mistral-small-latest', 'codestral-latest'] },
  { name: 'deepseek',    envVar: 'DEEPSEEK_API_KEY',   models: ['deepseek-chat', 'deepseek-reasoner'] },
  { name: 'xai',         envVar: 'XAI_API_KEY',        models: ['grok-3', 'grok-3-mini', 'grok-2'] },
  { name: 'perplexity',  envVar: 'PERPLEXITY_API_KEY', models: ['sonar-pro', 'sonar', 'sonar-reasoning'] },
  { name: 'together',    envVar: 'TOGETHER_API_KEY',   models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'mistralai/Mixtral-8x7B-Instruct-v0.1'] },
  { name: 'fireworks',   envVar: 'FIREWORKS_API_KEY',  models: ['accounts/fireworks/models/llama-v3p3-70b-instruct', 'accounts/fireworks/models/deepseek-r1'] },
  { name: 'cohere',      envVar: 'COHERE_API_KEY',     models: ['command-r-plus', 'command-r'] },
  { name: 'openrouter',  envVar: 'OPENROUTER_API_KEY', models: ['(any model string)', '(e.g. anthropic/claude-sonnet-4-6)'], dynamic: true },
];

export async function runModelsCommand(): Promise<void> {
  const config = await loadConfig();
  const mcpRegistry = new McpRegistry(config.mcp_servers);

  console.log('\nIrisCode — Available Models\n');

  // Cloud providers
  for (const provider of PROVIDERS) {
    const hasKey = Boolean(config.providers[provider.name as keyof typeof config.providers]?.apiKey);
    const status = hasKey ? '✓' : '–';
    const color = hasKey ? '\x1b[32m' : '\x1b[90m';
    const reset = '\x1b[0m';

    console.log(`${color}${status} ${provider.name.padEnd(14)}${reset}  (${provider.envVar})`);
    if (hasKey || provider.dynamic) {
      for (const model of provider.models) {
        console.log(`    ${provider.name}/${model}`);
      }
    }
  }

  // Ollama — fetch live models
  console.log(`\n  ollama            (local, no key required)`);
  try {
    const probe = new OllamaAdapter('__probe__', config.providers.ollama.baseUrl ?? undefined);
    const models = await probe.fetchModels();
    if (models.length === 0) {
      console.log('    (no models installed — run: ollama pull <model>)');
    } else {
      for (const m of models) {
        console.log(`    ollama/${m}`);
      }
    }
  } catch (err) {
    if (err instanceof ProviderError) {
      console.log('    (Ollama not running — start with: ollama serve)');
    } else {
      throw err;
    }
  }

  try {
    try {
      await mcpRegistry.initialize();
    } catch {
      // Non-required MCP server failures should not block model listing.
    }

    const connectedServers = mcpRegistry.getServerStates().filter((state) => state.status === 'connected');
    const mcpToolCount = connectedServers.reduce((sum, state) => sum + state.tools.length, 0);
    if (connectedServers.length > 0) {
      console.log(`\n+ ${mcpToolCount} MCP tools from ${connectedServers.length} server${connectedServers.length === 1 ? '' : 's'}`);
    }

    console.log('\nUsage: iriscode --model <provider>/<model>\n');
  } finally {
    await mcpRegistry.disconnectAll();
  }
}
