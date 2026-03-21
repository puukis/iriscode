import { loadGlobalConfig } from '../../config/global.ts';
import { loadProjectConfig } from '../../config/project.ts';
import type { BuiltinHandler, CommandEntry } from '../types.ts';

const PROVIDER_ENV_VARS: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_API_KEY',
  groq: 'GROQ_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  xai: 'XAI_API_KEY',
  perplexity: 'PERPLEXITY_API_KEY',
  together: 'TOGETHER_API_KEY',
  fireworks: 'FIREWORKS_API_KEY',
  cohere: 'COHERE_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
};

export const DOCTOR_COMMAND: CommandEntry = {
  name: 'doctor',
  description: 'Run environment and configuration checks.',
  category: 'builtin',
};

export const handleDoctor: BuiltinHandler = async (ctx) => {
  try {
    const lines = ['IrisCode doctor', ''];

    for (const [provider, envVar] of Object.entries(PROVIDER_ENV_VARS)) {
      const hasKey = Boolean(ctx.config.providers[provider as keyof typeof ctx.config.providers]?.apiKey);
      lines.push(`${provider}: ${hasKey ? 'PASS' : 'FAIL'} (${hasKey ? `${envVar} configured` : `${envVar} missing`})`);
    }

    const ollamaOk = await probeOllama(ctx.config.providers.ollama.baseUrl ?? 'http://localhost:11434');
    lines.push(`ollama: ${ollamaOk ? 'PASS' : 'FAIL'}`);

    try {
      await loadProjectConfig(ctx.cwd);
      lines.push('IRIS.md: PASS');
    } catch (error) {
      lines.push(`IRIS.md: FAIL (${error instanceof Error ? error.message : String(error)})`);
    }

    try {
      await loadGlobalConfig();
      lines.push('~/.iris/config.toml: PASS');
    } catch (error) {
      lines.push(`~/.iris/config.toml: FAIL (${error instanceof Error ? error.message : String(error)})`);
    }

    lines.push(`bun: ${typeof Bun !== 'undefined' ? Bun.version : 'unknown'}`);
    lines.push(`node: ${process.version}`);
    ctx.session.writeInfo(lines.join('\n'));
    return { type: 'handled' };
  } catch (error) {
    return { type: 'error', message: error instanceof Error ? error.message : String(error) };
  }
};

async function probeOllama(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/tags`, {
      signal: AbortSignal.timeout(1500),
    });
    return response.ok;
  } catch {
    return false;
  }
}
