import React, { useMemo, useState } from 'react';
import { Box, Text, render } from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import { stringify as stringifyToml } from 'smol-toml';
import { loadConfig, reloadConfig } from '../../config/loader.ts';
import {
  loadGlobalConfig,
  getGlobalConfigPath,
  writeGlobalConfig,
} from '../../config/global.ts';
import { setApiKey } from '../../config/secrets.ts';
import type { GlobalConfig, ProviderName, ResolvedConfig } from '../../config/schema.ts';
import { redactSecrets } from '../../config/utils.ts';
import { createDefaultRegistry as createModelRegistry } from '../../models/registry.ts';

type MenuValue =
  | 'view'
  | 'model'
  | 'api'
  | 'allow'
  | 'block'
  | 'edit-project'
  | 'edit-global'
  | 'exit';

type Screen =
  | 'menu'
  | 'view'
  | 'model'
  | 'api-list'
  | 'api-input'
  | 'allowed'
  | 'blocked';

const PROVIDERS: ProviderName[] = [
  'anthropic',
  'openai',
  'google',
  'groq',
  'mistral',
  'deepseek',
  'xai',
  'perplexity',
  'together',
  'fireworks',
  'cohere',
  'openrouter',
] as const;

export async function runConfigCommand(
  cwd: string = process.cwd(),
  args: string[] = [],
): Promise<void> {
  const absoluteCwd = cwd;

  if (args.includes('--show')) {
    const config = await reloadConfig(absoluteCwd);
    process.stdout.write(`${formatResolvedConfig(config)}\n`);
    return;
  }

  const setIndex = args.indexOf('--set');
  if (setIndex !== -1 && args[setIndex + 1]) {
    await setGlobalConfigValue(args[setIndex + 1]);
    await reloadConfig(absoluteCwd);
    return;
  }

  const initialConfig = await reloadConfig(absoluteCwd);
  const modelRegistry = await createModelRegistry(initialConfig);
  const availableModels = Array.from(new Set([
    initialConfig.model,
    ...modelRegistry.keys(),
  ])).sort();

  await new Promise<void>((resolvePromise) => {
    let app: ReturnType<typeof render>;
    app = render(
      <ConfigApp
        cwd={absoluteCwd}
        initialConfig={initialConfig}
        availableModels={availableModels}
        onExit={() => {
          app.unmount();
          resolvePromise();
        }}
      />,
    );
  });
}

function ConfigApp({
  cwd,
  initialConfig,
  availableModels,
  onExit,
}: {
  cwd: string;
  initialConfig: ResolvedConfig;
  availableModels: string[];
  onExit: () => void;
}) {
  const [screen, setScreen] = useState<Screen>('menu');
  const [resolvedConfig, setResolvedConfig] = useState(initialConfig);
  const [globalConfig, setGlobalConfig] = useState<GlobalConfig>(() => ({
    default_model: initialConfig.default_model,
    permissions: {
      mode: initialConfig.permissions.mode,
      allowed_tools: [...initialConfig.permissions.allowed_tools],
      disallowed_tools: [...initialConfig.permissions.disallowed_tools],
    },
    providers: Object.fromEntries(
      PROVIDERS.map((provider) => [
        provider,
        {
          apiKey: resolvedConfigProviderApiKey(initialConfig, provider),
          baseUrl: initialConfig.providers[provider].baseUrl ?? undefined,
        },
      ]),
    ),
    memory: { ...initialConfig.memory },
    mcp_servers: [...initialConfig.mcp_servers],
    mcp_oauth_callback_port: initialConfig.mcp_oauth_callback_port,
    mcp_oauth_callback_url: initialConfig.mcp_oauth_callback_url,
    log_level: initialConfig.log_level,
  }));
  const [status, setStatus] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<ProviderName | null>(null);

  const menuItems = useMemo(() => [
    { label: 'View current config', value: 'view' as const },
    { label: 'Set default model', value: 'model' as const },
    { label: 'Manage API keys', value: 'api' as const },
    { label: 'Edit allowed tools', value: 'allow' as const },
    { label: 'Edit blocked tools', value: 'block' as const },
    { label: 'Edit IRIS.md', value: 'edit-project' as const },
    { label: 'Edit global config', value: 'edit-global' as const },
    { label: 'Exit', value: 'exit' as const },
  ], []);

  async function refreshStatus(nextStatus: string): Promise<void> {
    setStatus(nextStatus);
    const config = await reloadConfig(cwd);
    setResolvedConfig(config);
  }

  async function saveGlobalConfig(nextConfig: GlobalConfig, nextStatus: string): Promise<void> {
    writeGlobalConfig(nextConfig);
    setGlobalConfig(nextConfig);
    await refreshStatus(nextStatus);
  }

  async function handleMenuSelect(item: { value: MenuValue }): Promise<void> {
    switch (item.value) {
      case 'view':
        setScreen('view');
        return;
      case 'model':
        setScreen('model');
        return;
      case 'api':
        setScreen('api-list');
        return;
      case 'allow':
        setEditingValue(resolvedConfig.permissions.allowed_tools.join(', '));
        setScreen('allowed');
        return;
      case 'block':
        setEditingValue(resolvedConfig.permissions.disallowed_tools.join(', '));
        setScreen('blocked');
        return;
      case 'edit-project':
        await openEditor(resolveProjectContextPath(cwd));
        await refreshStatus('Updated IRIS.md');
        return;
      case 'edit-global':
        await openEditor(getGlobalConfigPath());
        await refreshStatus('Updated ~/.iris/config.toml');
        return;
      case 'exit':
        onExit();
        return;
    }
  }

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>IrisCode config</Text>
      {status ? <Text color="green">{status}</Text> : null}

      {screen === 'menu' ? (
        <SelectInput items={menuItems} onSelect={(item) => void handleMenuSelect(item)} />
      ) : null}

      {screen === 'view' ? (
        <Box flexDirection="column" marginTop={1}>
          {formatResolvedConfig(resolvedConfig).split('\n').map((line, index) => (
            <Text key={index} color="gray">{line}</Text>
          ))}
          <Text color="cyan">Press Enter on Exit to return.</Text>
          <SelectInput
            items={[{ label: 'Back', value: 'back' as const }]}
            onSelect={() => setScreen('menu')}
          />
        </Box>
      ) : null}

      {screen === 'model' ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Select default model</Text>
          <SelectInput
            items={availableModels.map((model) => ({ label: model, value: model }))}
            onSelect={(item) => {
              void saveGlobalConfig(
                { ...globalConfig, default_model: item.value },
                `Saved default model: ${item.value}`,
              );
              setScreen('menu');
            }}
          />
        </Box>
      ) : null}

      {screen === 'api-list' ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Manage API keys</Text>
          <SelectInput
            items={[
              ...PROVIDERS.map((provider) => ({
                label: `${resolvedConfigProviderApiKey(resolvedConfig, provider) ? '✓' : '–'} ${provider}`,
                value: provider,
              })),
              { label: 'Back', value: 'back' as const },
            ]}
            onSelect={(item) => {
              if (item.value === 'back') {
                setScreen('menu');
                return;
              }
              setSelectedProvider(item.value);
              setEditingValue('');
              setScreen('api-input');
            }}
          />
        </Box>
      ) : null}

      {screen === 'api-input' && selectedProvider ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>{`Set ${selectedProvider} API key`}</Text>
          <Text color="gray">Press enter to save. Leave blank to clear.</Text>
          <TextInput
            value={editingValue}
            onChange={setEditingValue}
            onSubmit={(value) => {
              void setApiKey(selectedProvider, value)
                .then(() => refreshStatus(`Updated API key for ${selectedProvider}`))
                .then(() => setScreen('api-list'));
            }}
          />
        </Box>
      ) : null}

      {screen === 'allowed' ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Edit allowed tools</Text>
          <Text color="gray">Comma-separated patterns</Text>
          <TextInput
            value={editingValue}
            onChange={setEditingValue}
            onSubmit={(value) => {
              void saveGlobalConfig(
                {
                  ...globalConfig,
                  permissions: {
                    ...(globalConfig.permissions ?? {}),
                    allowed_tools: splitCsv(value),
                    disallowed_tools: globalConfig.permissions?.disallowed_tools,
                    mode: globalConfig.permissions?.mode,
                  },
                },
                'Updated allowed tools',
              );
              setScreen('menu');
            }}
          />
        </Box>
      ) : null}

      {screen === 'blocked' ? (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Edit blocked tools</Text>
          <Text color="gray">Comma-separated patterns</Text>
          <TextInput
            value={editingValue}
            onChange={setEditingValue}
            onSubmit={(value) => {
              void saveGlobalConfig(
                {
                  ...globalConfig,
                  permissions: {
                    ...(globalConfig.permissions ?? {}),
                    allowed_tools: globalConfig.permissions?.allowed_tools,
                    disallowed_tools: splitCsv(value),
                    mode: globalConfig.permissions?.mode,
                  },
                },
                'Updated blocked tools',
              );
              setScreen('menu');
            }}
          />
        </Box>
      ) : null}
    </Box>
  );
}

function formatResolvedConfig(config: ResolvedConfig): string {
  return stringifyToml(redactSecrets(config) as Record<string, unknown>);
}

async function setGlobalConfigValue(expression: string): Promise<void> {
  const separatorIndex = expression.indexOf('=');
  if (separatorIndex === -1) {
    throw new Error('Expected --set key=value');
  }

  const key = expression.slice(0, separatorIndex).trim();
  const rawValue = expression.slice(separatorIndex + 1).trim();
  if (!key) {
    throw new Error('Expected a non-empty config key');
  }

  const config = await loadGlobalConfig();
  const nextConfig = structuredClone(config.config);
  assignNestedValue(nextConfig as Record<string, unknown>, key.split('.'), parseScalarValue(rawValue));
  writeGlobalConfig(nextConfig);
}

function assignNestedValue(target: Record<string, unknown>, path: string[], value: unknown): void {
  const [head, ...tail] = path;
  if (!head) {
    return;
  }

  if (tail.length === 0) {
    target[head] = value;
    return;
  }

  const next = typeof target[head] === 'object' && target[head] !== null
    ? target[head] as Record<string, unknown>
    : {};
  target[head] = next;
  assignNestedValue(next, tail, value);
}

function parseScalarValue(value: string): unknown {
  if (value.includes(',')) {
    return splitCsv(value);
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return value;
}

function splitCsv(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function resolvedConfigProviderApiKey(config: ResolvedConfig, provider: ProviderName): string | null {
  return provider === 'ollama' ? null : config.providers[provider].apiKey;
}

function resolveProjectContextPath(cwd: string): string {
  return `${cwd}/IRIS.md`;
}

async function openEditor(filePath: string): Promise<void> {
  const editor = process.env.EDITOR || 'nano';
  const result = Bun.spawnSync([editor, filePath], {
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });

  if (result.exitCode !== 0) {
    throw new Error(`Editor exited with code ${result.exitCode}`);
  }
}
